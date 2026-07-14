/**
 * Reabre pedidos pickup marcados como EXPIRED/CANCELADA por la caducidad automatica.
 *
 * Uso:
 *   npm run repair:expired-pickups -- --dry-run
 *   npm run repair:expired-pickups
 *
 * Opcional: REPAIR_LIMIT=200
 */
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { firestoreTienda } from "../config/firebase";
import {
  EstadoOrden,
  FulfillmentMethod,
  FulfillmentStatus,
  Orden,
  PreparationStatus,
} from "../models/orden.model";
import type { OrderEventType } from "../models/order-event.model";
import orderEventService from "../services/order-event.service";

const ORDENES_COLLECTION = "ordenes";
const DRY_RUN =
  process.argv.includes("--dry-run") || process.env.DRY_RUN === "true";
const LIMIT = Number(process.env.REPAIR_LIMIT || "200");

type RestoredState = {
  fulfillmentStatus: FulfillmentStatus;
  estado: EstadoOrden;
  preparationStatus: PreparationStatus;
  eventType: OrderEventType;
};

function resolveRestoredState(order: Orden): RestoredState {
  if (
    order.readyForPickupAt ||
    order.preparationStatus === PreparationStatus.READY_FOR_PICKUP
  ) {
    return {
      fulfillmentStatus: FulfillmentStatus.READY_FOR_PICKUP,
      estado: EstadoOrden.EN_PROCESO,
      preparationStatus: PreparationStatus.READY_FOR_PICKUP,
      eventType: "PICKUP_READY",
    };
  }

  if (order.preparationStatus === PreparationStatus.PREPARING) {
    return {
      fulfillmentStatus: FulfillmentStatus.PREPARING,
      estado: EstadoOrden.EN_PROCESO,
      preparationStatus: PreparationStatus.PREPARING,
      eventType: "PICKUP_PREPARING",
    };
  }

  return {
    fulfillmentStatus: FulfillmentStatus.PAID,
    estado: EstadoOrden.CONFIRMADA,
    preparationStatus: PreparationStatus.PENDING_PREPARATION,
    eventType: "PAYMENT_CONFIRMED",
  };
}

async function repairExpiredPickupOrders(): Promise<void> {
  console.log(
    `Reparar pickup EXPIRED (${DRY_RUN ? "DRY-RUN" : "EJECUCION"}) limit=${LIMIT}`,
  );

  const snapshot = await firestoreTienda
    .collection(ORDENES_COLLECTION)
    .where("fulfillmentMethod", "==", FulfillmentMethod.PICKUP)
    .where("fulfillmentStatus", "==", FulfillmentStatus.EXPIRED)
    .limit(LIMIT)
    .get();

  let repaired = 0;
  let skipped = 0;

  for (const doc of snapshot.docs) {
    const order = { id: doc.id, ...(doc.data() as Orden) };
    if (order.fulfillmentMethod !== FulfillmentMethod.PICKUP) {
      skipped += 1;
      continue;
    }
    if (order.fulfillmentStatus !== FulfillmentStatus.EXPIRED) {
      skipped += 1;
      continue;
    }

    const restored = resolveRestoredState(order);
    console.log(
      `[CANDIDATE] orden=${doc.id} estado=${order.estado} prep=${order.preparationStatus || "-"} ` +
        `readyAt=${order.readyForPickupAt ? "yes" : "no"} -> ` +
        `${restored.fulfillmentStatus}/${restored.estado}/${restored.preparationStatus}`,
    );

    if (DRY_RUN) {
      continue;
    }

    const now = Timestamp.now();
    await firestoreTienda.collection(ORDENES_COLLECTION).doc(doc.id).set(
      {
        fulfillmentStatus: restored.fulfillmentStatus,
        estado: restored.estado,
        preparationStatus: restored.preparationStatus,
        pickupExpiresAt: FieldValue.delete(),
        repairedExpiredPickupAt: now,
        repairedExpiredPickupReason: "disable_pickup_auto_expiration",
        updatedAt: now,
      },
      { merge: true },
    );

    await orderEventService.createEvent({
      orderId: doc.id,
      eventType: restored.eventType,
      actorType: "system",
      actorId: "repair-expired-pickup",
      pickupLocationId: order.pickupLocationId,
      sourceEventId: `repair-expired-pickup:${doc.id}`,
      metadata: {
        reason: "disable_pickup_auto_expiration",
        previousFulfillmentStatus: FulfillmentStatus.EXPIRED,
        previousEstado: order.estado,
        restoredFulfillmentStatus: restored.fulfillmentStatus,
        restoredEstado: restored.estado,
      },
    });

    repaired += 1;
  }

  console.log(
    `Candidatos: ${snapshot.size}. Reparados: ${repaired}. Omitidos: ${skipped}.` +
      (DRY_RUN ? " (dry-run sin escrituras)" : ""),
  );
}

repairExpiredPickupOrders().catch((error) => {
  console.error("Error reparando pickup EXPIRED:", error);
  process.exit(1);
});
