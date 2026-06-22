import { firestoreTienda } from "../config/firebase";
import { admin } from "../config/firebase.admin";
import {
  buildFirestoreInventoryPatch,
  projectLegacyFromProductData,
} from "../utils/inventory-stock.util";
import { normalizeTallaIds } from "../utils/size-inventory.util";

const PRODUCTOS_COLLECTION = "productos";
const DRY_RUN = process.argv.includes("--dry-run");
const BATCH_LIMIT = 400;

async function migrateInventoryV2(): Promise<void> {
  console.log(
    `\n🚀 Migración inventario v2 (${DRY_RUN ? "DRY-RUN" : "EJECUCIÓN"})`,
  );

  const snapshot = await firestoreTienda.collection(PRODUCTOS_COLLECTION).get();
  let updated = 0;
  let batch = firestoreTienda.batch();
  let batchOps = 0;

  for (const doc of snapshot.docs) {
    const data = doc.data();
    const projection = projectLegacyFromProductData(data as Record<string, unknown>);
    const tallaIds = normalizeTallaIds(data.tallaIds);
    const patch = buildFirestoreInventoryPatch({
      tallaIds,
      inventarioPorTalla: projection.inventarioPorTalla,
      inventarioGlobal: projection.inventarioGlobal,
    });

    const needsBuckets =
      tallaIds.length === 0
        ? !data.inventarioGlobal
        : !(Array.isArray(data.inventarioPorTalla) &&
            data.inventarioPorTalla.some(
              (row: { fisica?: number }) => typeof row?.fisica === "number",
            ));

    if (!needsBuckets) {
      continue;
    }

    updated += 1;
    if (!DRY_RUN) {
      batch.update(doc.ref, {
        ...patch,
        updatedAt: admin.firestore.Timestamp.now(),
      });
      batchOps += 1;
      if (batchOps >= BATCH_LIMIT) {
        await batch.commit();
        batch = firestoreTienda.batch();
        batchOps = 0;
      }
    }
  }

  if (!DRY_RUN && batchOps > 0) {
    await batch.commit();
  }

  console.log(`✅ Productos actualizados: ${updated}`);
}

migrateInventoryV2().catch((error) => {
  console.error("❌ Error en migración inventario v2:", error);
  process.exit(1);
});
