import { firestoreTienda } from "../config/firebase";
import { admin } from "../config/firebase.admin";
import { EstadoOrden, Orden, PaymentState } from "../models/orden.model";
import inventoryService from "../services/inventory.service";
import { TipoMovimientoInventario } from "../models/inventario.model";

const ORDENES_COLLECTION = "ordenes";
const DRY_RUN = process.argv.includes("--dry-run") || process.env.DRY_RUN === "true";
const LIMIT = Number(process.env.REPAIR_LIMIT || "200");

async function repairUnpaidOrdersInventory(): Promise<void> {
  console.log(`Reparacion inventario ordenes sin pago (${DRY_RUN ? "DRY-RUN" : "EJECUCION"}) limit=${LIMIT}`);

  const snapshot = await firestoreTienda
    .collection(ORDENES_COLLECTION)
    .where("estado", "in", [EstadoOrden.PENDIENTE, EstadoOrden.CANCELADA])
    .limit(LIMIT)
    .get();

  let candidates = 0;
  let repaired = 0;

  for (const doc of snapshot.docs) {
    const orden = doc.data() as Orden;
    const ordenId = doc.id;

    if (orden.paymentStatus === PaymentState.PAGADO) {
      continue;
    }

    const hasSale = await inventoryService.orderHasSaleMovements(ordenId);
    if (!hasSale) {
      continue;
    }

    candidates += 1;
    console.log(`[CANDIDATE] orden=${ordenId} estado=${orden.estado}`);

    if (DRY_RUN) {
      continue;
    }

    for (const item of orden.items || []) {
      await inventoryService.registerMovement({
        tipo: TipoMovimientoInventario.DEVOLUCION,
        productoId: item.productoId,
        tallaId: item.tallaId,
        cantidad: item.cantidad,
        ordenId,
        referencia: ordenId,
        motivo: "Reparacion: revertir venta sin pago confirmado",
        usuarioId: orden.usuarioId,
        idempotencyKey: `repair-unpaid:${ordenId}:${item.productoId}:${item.tallaId ?? "_"}`,
      });
    }

    await doc.ref.set(
      {
        repairInventoryAt: admin.firestore.Timestamp.now(),
        repairInventoryReason: "unpaid_order_with_sale_movements",
        updatedAt: admin.firestore.Timestamp.now(),
      },
      { merge: true },
    );
    repaired += 1;
  }

  console.log(`Candidatos: ${candidates}. Reparados: ${repaired}.`);
}

repairUnpaidOrdersInventory().catch((error) => {
  console.error("Error en reparacion de inventario:", error);
  process.exit(1);
});
