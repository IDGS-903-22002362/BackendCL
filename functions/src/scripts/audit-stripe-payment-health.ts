import { firestoreTienda } from "../config/firebase";
import { EstadoOrden, Orden, PaymentState } from "../models/orden.model";
import {
  COLECCION_PAGOS,
  EstadoPago,
} from "../models/pago.model";

const ORDENES_COLLECTION = "ordenes";
const WEBHOOK_EVENTS_COLLECTION = "stripe_webhook_events";
const LIMIT = Number(process.env.AUDIT_LIMIT || "50");

function maskSecret(value?: string): string {
  if (!value?.trim()) {
    return "MISSING";
  }
  const trimmed = value.trim();
  if (trimmed.length <= 8) {
    return "***";
  }
  return `${trimmed.slice(0, 7)}…${trimmed.slice(-4)}`;
}

async function auditStripePaymentHealth(): Promise<void> {
  console.log("=== Auditoría salud pagos Stripe ===\n");

  console.log("Secrets / env (enmascarados):");
  console.log(`  STRIPE_SECRET_KEY: ${maskSecret(process.env.STRIPE_SECRET_KEY)}`);
  console.log(
    `  STRIPE_WEBHOOK_SECRET: ${maskSecret(process.env.STRIPE_WEBHOOK_SECRET)}`,
  );
  console.log(
    `  STRIPE_PUBLISHABLE_KEY: ${maskSecret(process.env.STRIPE_PUBLISHABLE_KEY)}`,
  );
  console.log("");

  const unmatchedSnapshot = await firestoreTienda
    .collection(WEBHOOK_EVENTS_COLLECTION)
    .where("status", "==", "unmatched")
    .orderBy("updatedAt", "desc")
    .limit(LIMIT)
    .get()
    .catch(async () => {
      const fallback = await firestoreTienda
        .collection(WEBHOOK_EVENTS_COLLECTION)
        .where("status", "==", "unmatched")
        .limit(LIMIT)
        .get();
      return fallback;
    });

  console.log(`Webhooks unmatched recientes: ${unmatchedSnapshot.size}`);
  for (const doc of unmatchedSnapshot.docs.slice(0, 10)) {
    const data = doc.data() as {
      eventType?: string;
      reason?: string;
      pagoId?: string;
      ordenId?: string;
    };
    console.log(
      `  - ${doc.id} type=${data.eventType || "?"} reason=${data.reason || "?"} pago=${data.pagoId || "-"} orden=${data.ordenId || "-"}`,
    );
  }
  console.log("");

  const pagosSnapshot = await firestoreTienda
    .collection(COLECCION_PAGOS)
    .where("estado", "==", EstadoPago.COMPLETADO)
    .limit(LIMIT)
    .get();

  let stuckOrders = 0;
  for (const pagoDoc of pagosSnapshot.docs) {
    const pago = pagoDoc.data() as { ordenId?: string };
    if (!pago.ordenId) {
      continue;
    }
    const ordenDoc = await firestoreTienda
      .collection(ORDENES_COLLECTION)
      .doc(pago.ordenId)
      .get();
    if (!ordenDoc.exists) {
      continue;
    }
    const orden = ordenDoc.data() as Orden;
    const paymentStatus = String(orden.paymentStatus || "").toUpperCase();
    if (
      paymentStatus !== PaymentState.PAGADO ||
      orden.estado !== EstadoOrden.CONFIRMADA
    ) {
      stuckOrders += 1;
      if (stuckOrders <= 15) {
        console.log(
          `[STUCK] orden=${pago.ordenId} pago=${pagoDoc.id} paymentStatus=${orden.paymentStatus} estado=${orden.estado}`,
        );
      }
    }
  }

  console.log(
    `\nÓrdenes con pago COMPLETADO pero estado de orden inconsistente: ${stuckOrders}`,
  );
  console.log(
    "\nChecklist manual:",
  );
  console.log(
    "  1. Stripe Dashboard → Webhooks → URL: .../api/pagos/webhook o .../api/stripe/webhook",
  );
  console.log(
    "  2. Eventos: checkout.session.completed, checkout.session.async_payment_succeeded, payment_intent.succeeded",
  );
  console.log(
    "  3. STRIPE_WEBHOOK_SECRET debe ser el signing secret del endpoint de la cuenta empresa live",
  );
  console.log(
    "  4. pk_live frontend (apphosting.yaml) debe coincidir con sk_live del backend",
  );
  console.log(
    "  5. Recuperar caso: POST /api/checkout/attempts/reconcile-pending (usuario) o POST /api/admin/payments/stripe/reconcile (admin)",
  );
}

auditStripePaymentHealth().catch((error) => {
  console.error("Error en auditoría Stripe:", error);
  process.exit(1);
});
