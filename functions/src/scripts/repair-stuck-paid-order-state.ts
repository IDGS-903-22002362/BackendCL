import { firestoreTienda } from "../config/firebase";
import { admin } from "../config/firebase.admin";
import { EstadoOrden, Orden, PaymentState } from "../models/orden.model";
import {
  COLECCION_PAGOS,
  EstadoPago,
  PaymentStatus,
} from "../models/pago.model";
import paidOrderFinalizerService from "../services/paid-order-finalizer.service";

const ORDENES_COLLECTION = "ordenes";
const DRY_RUN = process.argv.includes("--dry-run") || process.env.DRY_RUN === "true";
const LIMIT = Number(process.env.REPAIR_LIMIT || "200");

const PAID_PAGO_STATUSES = new Set<string>([
  PaymentStatus.PAID,
  "paid",
  "succeeded",
]);

async function repairStuckPaidOrderState(): Promise<void> {
  console.log(
    `Reparar órdenes con pago confirmado pero paymentStatus pendiente (${DRY_RUN ? "DRY-RUN" : "EJECUCION"}) limit=${LIMIT}`,
  );

  const pagosSnapshot = await firestoreTienda
    .collection(COLECCION_PAGOS)
    .where("estado", "==", EstadoPago.COMPLETADO)
    .limit(LIMIT)
    .get();

  let candidates = 0;
  let repaired = 0;
  let skipped = 0;

  for (const pagoDoc of pagosSnapshot.docs) {
    const pago = pagoDoc.data() as {
      ordenId?: string;
      status?: string;
      estado?: EstadoPago;
    };
    const status = String(pago.status || "").toLowerCase();
    const isPaidStatus =
      pago.estado === EstadoPago.COMPLETADO || PAID_PAGO_STATUSES.has(status);

    if (!isPaidStatus || !pago.ordenId) {
      skipped += 1;
      continue;
    }

    const ordenRef = firestoreTienda
      .collection(ORDENES_COLLECTION)
      .doc(pago.ordenId);
    const ordenDoc = await ordenRef.get();
    if (!ordenDoc.exists) {
      skipped += 1;
      continue;
    }

    const orden = ordenDoc.data() as Orden;
    const paymentStatus = String(orden.paymentStatus || "").toUpperCase();
    if (
      paymentStatus === PaymentState.PAGADO &&
      orden.estado === EstadoOrden.CONFIRMADA
    ) {
      skipped += 1;
      continue;
    }

    candidates += 1;
    console.log(
      `[CANDIDATE] orden=${pago.ordenId} pago=${pagoDoc.id} paymentStatus=${orden.paymentStatus} estado=${orden.estado}`,
    );

    if (DRY_RUN) {
      continue;
    }

    await paidOrderFinalizerService.applyPaidOrderStatePatch(pago.ordenId);
    await ordenRef.set(
      {
        repairPaidStateAt: admin.firestore.Timestamp.now(),
        repairPaidStateReason: "pago_completado_order_pending",
        repairPaidStatePagoId: pagoDoc.id,
        updatedAt: admin.firestore.Timestamp.now(),
      },
      { merge: true },
    );
    repaired += 1;
  }

  console.log(
    `Candidatos: ${candidates}. Reparados: ${repaired}. Omitidos: ${skipped}.`,
  );
}

repairStuckPaidOrderState().catch((error) => {
  console.error("Error reparando órdenes con pago atascado:", error);
  process.exit(1);
});
