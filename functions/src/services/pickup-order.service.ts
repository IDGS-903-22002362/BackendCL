import crypto from "crypto";
import { Timestamp } from "firebase-admin/firestore";
import { firestoreTienda } from "../config/firebase";
import {
  EstadoOrden,
  FulfillmentMethod,
  FulfillmentStatus,
  Orden,
  PreparationStatus,
} from "../models/orden.model";
import orderEventService from "./order-event.service";

const ORDENES_COLLECTION = "ordenes";
const PICKUP_EXPIRATION_DAYS = 7;

type Actor = {
  uid?: string;
  actorType: "system" | "webhook" | "admin" | "staff";
};

export class PickupOrderService {
  private getSecret(): string {
    return (
      process.env.PICKUP_QR_SECRET ||
      process.env.JWT_SECRET ||
      "local-pickup-secret"
    );
  }

  private hashCode(code: string): string {
    return crypto.createHmac("sha256", this.getSecret()).update(code).digest("hex");
  }

  private verifyHash(code: string, hash?: string): boolean {
    if (!hash) {
      return false;
    }
    const expected = Buffer.from(hash, "hex");
    const actual = Buffer.from(this.hashCode(code), "hex");
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  }

  private generatePickupCode(): string {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const bytes = crypto.randomBytes(8);
    const raw = [...bytes].map((byte) => alphabet[byte % alphabet.length]).join("");
    return `${raw.slice(0, 4)}-${raw.slice(4, 8)}`;
  }

  private buildQrPayload(orderId: string, code: string): string {
    const nonce = crypto.randomBytes(8).toString("base64url");
    const signature = crypto
      .createHmac("sha256", this.getSecret())
      .update(`${orderId}|${code}|${nonce}`)
      .digest("base64url");
    return Buffer.from(
      JSON.stringify({
        type: "pickup_order",
        orderId,
        code,
        nonce,
        signature,
      }),
    ).toString("base64url");
  }

  private isPickupOrder(order: Orden): boolean {
    return order.fulfillmentMethod === FulfillmentMethod.PICKUP;
  }

  async finalizePaidPickupOrder(input: {
    orderId: string;
    source: "stripe" | "aplazo";
    sourceEventId?: string;
    paymentAttemptId?: string;
  }): Promise<{ pickupCode?: string; generated: boolean }> {
    const ref = firestoreTienda.collection(ORDENES_COLLECTION).doc(input.orderId);
    const snapshot = await ref.get();
    if (!snapshot.exists) {
      throw new Error(`Orden ${input.orderId} no encontrada`);
    }

    const order = { id: snapshot.id, ...(snapshot.data() as Orden) };
    if (!this.isPickupOrder(order)) {
      return { generated: false };
    }

    let pickupCode: string | undefined;
    let generated = false;
    const now = Timestamp.now();
    const patch: Partial<Orden> = {
      fulfillmentStatus: FulfillmentStatus.PAID,
      updatedAt: now,
    };

    if (!order.pickupCodeHash) {
      pickupCode = this.generatePickupCode();
      generated = true;
      patch.pickupCodeHash = this.hashCode(pickupCode);
      patch.pickupCodeLast4 = pickupCode.replace("-", "").slice(-4);
      patch.pickupQrPayload = this.buildQrPayload(input.orderId, pickupCode);
      const expires = new Date(now.toDate().getTime() + PICKUP_EXPIRATION_DAYS * 24 * 60 * 60 * 1000);
      patch.pickupExpiresAt = Timestamp.fromDate(expires);
    }

    await ref.set(patch, { merge: true });

    await orderEventService.createEvent({
      orderId: input.orderId,
      eventType: "PAYMENT_CONFIRMED",
      actorType: "webhook",
      actorId: input.source,
      pickupLocationId: order.pickupLocationId,
      sourceEventId: input.sourceEventId || input.paymentAttemptId,
      metadata: {
        source: input.source,
        paymentAttemptId: input.paymentAttemptId,
      },
    });
    await orderEventService.createEvent({
      orderId: input.orderId,
      eventType: "PICKUP_CREATED",
      actorType: "webhook",
      actorId: input.source,
      pickupLocationId: order.pickupLocationId,
      sourceEventId: input.sourceEventId || input.paymentAttemptId,
      metadata: {
        generatedPickupCode: generated,
      },
    });

    await this.enqueuePickupNotification(order, "pickup_paid_pending_preparation", {
      pickupLocationId: order.pickupLocationId,
      source: input.source,
    });

    return { pickupCode, generated };
  }

  async listPickupOrders(filters: {
    status?: FulfillmentStatus;
    locationId?: string;
    fechaDesde?: string;
    fechaHasta?: string;
  }): Promise<Orden[]> {
    let query: FirebaseFirestore.Query = firestoreTienda
      .collection(ORDENES_COLLECTION)
      .where("fulfillmentMethod", "==", FulfillmentMethod.PICKUP);

    if (filters.status) {
      query = query.where("fulfillmentStatus", "==", filters.status);
    }
    if (filters.locationId) {
      query = query.where("pickupLocationId", "==", filters.locationId);
    }
    if (filters.fechaDesde) {
      query = query.where("createdAt", ">=", Timestamp.fromDate(new Date(filters.fechaDesde)));
    }
    if (filters.fechaHasta) {
      query = query.where("createdAt", "<=", Timestamp.fromDate(new Date(filters.fechaHasta)));
    }

    query = query.orderBy("createdAt", "desc").limit(100);
    const snapshot = await query.get();
    return snapshot.docs.map((doc) => ({
      id: doc.id,
      ...(doc.data() as Orden),
    }));
  }

  async getPickupOrder(orderId: string): Promise<Orden> {
    const snapshot = await firestoreTienda.collection(ORDENES_COLLECTION).doc(orderId).get();
    if (!snapshot.exists) {
      throw new Error(`Orden con ID "${orderId}" no encontrada`);
    }
    const order = { id: snapshot.id, ...(snapshot.data() as Orden) };
    if (!this.isPickupOrder(order)) {
      throw new Error("La orden no es de tipo PICKUP");
    }
    return order;
  }

  async markPreparing(orderId: string, actor: Actor): Promise<Orden> {
    const order = await this.getPickupOrder(orderId);
    if (order.fulfillmentStatus !== FulfillmentStatus.PAID) {
      throw new Error("Solo pedidos pickup pagados pueden marcarse en preparación");
    }
    return this.updatePickupState(order, FulfillmentStatus.PREPARING, actor, {
      estado: EstadoOrden.EN_PROCESO,
      eventType: "PICKUP_PREPARING",
    });
  }

  async markReady(orderId: string, actor: Actor): Promise<Orden> {
    const order = await this.getPickupOrder(orderId);
    if (
      order.fulfillmentStatus !== FulfillmentStatus.PAID &&
      order.fulfillmentStatus !== FulfillmentStatus.PREPARING
    ) {
      throw new Error("Solo pedidos pagados o en preparación pueden marcarse listos");
    }
    const readyAt = Timestamp.now();
    const expiresAt = Timestamp.fromDate(
      new Date(readyAt.toDate().getTime() + PICKUP_EXPIRATION_DAYS * 24 * 60 * 60 * 1000),
    );
    const updated = await this.updatePickupState(
      order,
      FulfillmentStatus.READY_FOR_PICKUP,
      actor,
      {
        estado: EstadoOrden.EN_PROCESO,
        eventType: "PICKUP_READY",
        extraPatch: {
          readyForPickupAt: readyAt,
          pickupExpiresAt: order.pickupExpiresAt || expiresAt,
        },
      },
    );
    await this.enqueuePickupNotification(updated, "pickup_ready_for_pickup", {
      readyForPickupAt: readyAt,
      pickupExpiresAt: updated.pickupExpiresAt,
      pickupCodeLast4: updated.pickupCodeLast4,
    });
    return updated;
  }

  async verifyCode(
    orderId: string,
    code: string,
    actor: Actor,
    pickupLocationId?: string,
  ): Promise<{ valid: boolean; orderId: string; pickupCodeLast4?: string }> {
    const order = await this.getPickupOrder(orderId);
    this.assertReadyForCodeValidation(order, pickupLocationId);
    const valid = this.verifyHash(code, order.pickupCodeHash);
    await orderEventService.createEvent({
      orderId,
      eventType: "PICKUP_CODE_VERIFIED",
      actorType: actor.actorType,
      actorId: actor.uid,
      pickupLocationId: order.pickupLocationId,
      metadata: { valid, pickupCodeLast4: order.pickupCodeLast4 },
    });
    return { valid, orderId, pickupCodeLast4: order.pickupCodeLast4 };
  }

  async completePickup(input: {
    orderId: string;
    code: string;
    actor: Actor;
    pickupLocationId?: string;
    pickedUpBy?: string;
  }): Promise<Orden> {
    const order = await this.getPickupOrder(input.orderId);
    this.assertReadyForCodeValidation(order, input.pickupLocationId);
    if (!this.verifyHash(input.code, order.pickupCodeHash)) {
      throw new Error("Código de recolección inválido");
    }
    const pickedUpAt = Timestamp.now();
    const updated = await this.updatePickupState(
      order,
      FulfillmentStatus.PICKED_UP,
      input.actor,
      {
        estado: EstadoOrden.ENTREGADA,
        eventType: "PICKUP_COMPLETED",
        extraPatch: {
          pickedUpAt,
          deliveredAt: pickedUpAt,
          deliveredByStaffUid: input.actor.uid,
          pickedUpBy: input.pickedUpBy,
        },
      },
    );
    await this.enqueuePickupNotification(updated, "pickup_picked_up", {
      pickedUpAt,
      deliveredByStaffUid: input.actor.uid,
    });
    return updated;
  }

  async expirePickup(orderId: string, actor: Actor): Promise<Orden> {
    const order = await this.getPickupOrder(orderId);
    if (
      order.fulfillmentStatus === FulfillmentStatus.PICKED_UP ||
      order.fulfillmentStatus === FulfillmentStatus.CANCELED ||
      order.fulfillmentStatus === FulfillmentStatus.EXPIRED
    ) {
      throw new Error("No se puede expirar un pedido pickup ya cerrado");
    }
    const updated = await this.updatePickupState(order, FulfillmentStatus.EXPIRED, actor, {
      estado: EstadoOrden.CANCELADA,
      eventType: "PICKUP_EXPIRED",
    });
    await this.enqueuePickupNotification(updated, "pickup_expired", {
      pickupExpiresAt: updated.pickupExpiresAt,
    });
    return updated;
  }

  async expireOverduePickups(): Promise<{ expired: number }> {
    const now = Timestamp.now();
    const snapshot = await firestoreTienda
      .collection(ORDENES_COLLECTION)
      .where("fulfillmentMethod", "==", FulfillmentMethod.PICKUP)
      .where("fulfillmentStatus", "in", [
        FulfillmentStatus.PAID,
        FulfillmentStatus.PREPARING,
        FulfillmentStatus.READY_FOR_PICKUP,
      ])
      .where("pickupExpiresAt", "<=", now)
      .limit(100)
      .get();

    let expired = 0;
    for (const doc of snapshot.docs) {
      try {
        await this.expirePickup(doc.id, { actorType: "system", uid: "pickup-cron" });
        expired += 1;
      } catch (error) {
        console.warn("pickup_expiration_failed", {
          orderId: doc.id,
          message: error instanceof Error ? error.message : error,
        });
      }
    }
    return { expired };
  }

  private assertReadyForCodeValidation(order: Orden, pickupLocationId?: string): void {
    if (!this.isPickupOrder(order)) {
      throw new Error("La orden no es de tipo PICKUP");
    }
    if (order.fulfillmentStatus !== FulfillmentStatus.READY_FOR_PICKUP) {
      throw new Error("El pedido no está listo para recoger");
    }
    if (order.pickedUpAt) {
      throw new Error("El pedido ya fue recogido");
    }
    if (pickupLocationId && pickupLocationId !== order.pickupLocationId) {
      throw new Error("El pedido pertenece a otra sucursal");
    }
  }

  private async updatePickupState(
    order: Orden,
    fulfillmentStatus: FulfillmentStatus,
    actor: Actor,
    options: {
      estado: EstadoOrden;
      eventType:
        | "PICKUP_PREPARING"
        | "PICKUP_READY"
        | "PICKUP_COMPLETED"
        | "PICKUP_EXPIRED";
      extraPatch?: Record<string, unknown>;
    },
  ): Promise<Orden> {
    const now = Timestamp.now();
    const preparationStatusByEvent: Record<string, PreparationStatus> = {
      PICKUP_PREPARING: PreparationStatus.PREPARING,
      PICKUP_READY: PreparationStatus.READY_FOR_PICKUP,
      PICKUP_COMPLETED: PreparationStatus.PICKED_UP,
    };
    const nextPreparationStatus = preparationStatusByEvent[options.eventType];
    const patch = {
      fulfillmentStatus,
      estado: options.estado,
      ...(nextPreparationStatus
        ? { preparationStatus: nextPreparationStatus }
        : {}),
      updatedAt: now,
      ...(options.extraPatch || {}),
    };
    await firestoreTienda.collection(ORDENES_COLLECTION).doc(order.id!).set(patch, {
      merge: true,
    });
    await orderEventService.createEvent({
      orderId: order.id!,
      eventType: options.eventType,
      actorType: actor.actorType,
      actorId: actor.uid,
      pickupLocationId: order.pickupLocationId,
    });
    return {
      ...order,
      ...patch,
    } as Orden;
  }

  private async enqueuePickupNotification(
    order: Orden,
    eventType:
      | "pickup_paid_pending_preparation"
      | "pickup_ready_for_pickup"
      | "pickup_picked_up"
      | "pickup_expired"
      | "pickup_reminder",
    sourceData: Record<string, unknown>,
  ): Promise<void> {
    try {
      const { default: notificationEventService } = await import(
        "./notifications/notification-event.service"
      );
      await notificationEventService.enqueueEvent({
        eventType,
        userId: order.usuarioId,
        orderId: order.id,
        sourceData,
        triggerSource: "pickup_order_service",
      });
    } catch (error) {
      console.warn("pickup_notification_enqueue_failed", {
        orderId: order.id,
        eventType,
        message: error instanceof Error ? error.message : error,
      });
    }
  }
}

export const pickupOrderService = new PickupOrderService();
export default pickupOrderService;
