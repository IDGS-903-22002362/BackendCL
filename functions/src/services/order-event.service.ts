import crypto from "crypto";
import { Timestamp } from "firebase-admin/firestore";
import { firestoreTienda } from "../config/firebase";
import {
  OrderEvent,
  OrderEventActorType,
  OrderEventType,
} from "../models/order-event.model";

const ORDER_EVENTS_COLLECTION = "orderEvents";

export class OrderEventService {
  private buildEventId(input: {
    orderId: string;
    eventType: OrderEventType;
    sourceEventId?: string;
  }): string | undefined {
    if (!input.sourceEventId) {
      return undefined;
    }

    return crypto
      .createHash("sha256")
      .update(`${input.orderId}|${input.eventType}|${input.sourceEventId}`)
      .digest("hex");
  }

  async createEvent(input: {
    orderId: string;
    eventType: OrderEventType;
    actorType: OrderEventActorType;
    actorId?: string;
    pickupLocationId?: string;
    sourceEventId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<OrderEvent> {
    const now = Timestamp.now();
    const payload: Omit<OrderEvent, "id"> = {
      orderId: input.orderId,
      eventType: input.eventType,
      actorType: input.actorType,
      actorId: input.actorId,
      pickupLocationId: input.pickupLocationId,
      sourceEventId: input.sourceEventId,
      metadata: input.metadata,
      createdAt: now,
    };
    const deterministicId = this.buildEventId(input);

    if (deterministicId) {
      const ref = firestoreTienda
        .collection(ORDER_EVENTS_COLLECTION)
        .doc(deterministicId);
      try {
        await ref.create(payload);
      } catch (error) {
        const code = String((error as { code?: unknown })?.code ?? "");
        if (code !== "6" && code !== "already-exists") {
          throw error;
        }
      }
      return { id: deterministicId, ...payload };
    }

    const ref = await firestoreTienda.collection(ORDER_EVENTS_COLLECTION).add(payload);
    return { id: ref.id, ...payload };
  }
}

export const orderEventService = new OrderEventService();
export default orderEventService;
