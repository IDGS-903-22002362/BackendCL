import { firestoreTienda } from "../config/firebase";
import { admin } from "../config/firebase.admin";
import {
  completeInventarioPorTalla,
  deriveExistenciasFromSizeInventory,
  normalizeTallaIds,
} from "../utils/size-inventory.util";

const PRODUCTOS_COLLECTION = "productos";
const DRY_RUN = process.argv.includes("--dry-run");
const BATCH_LIMIT = 400;

type NormalizedProductPayload = {
  tallaIds: string[];
  inventarioPorTalla: Array<{ tallaId: string; cantidad: number }>;
  existencias: number;
  updatedAt: FirebaseFirestore.Timestamp;
};

const areEqual = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

const getNormalizedPayload = (
  data: FirebaseFirestore.DocumentData,
): NormalizedProductPayload => {
  const tallaIds = normalizeTallaIds(data.tallaIds);
  const inventarioPorTalla = completeInventarioPorTalla(
    tallaIds,
    data.inventarioPorTalla,
    {
      failOnUnknownSize: false,
      failWhenNoSizes: false,
    },
  );
  const existencias = deriveExistenciasFromSizeInventory(
    tallaIds,
    inventarioPorTalla,
    data.existencias,
  );

  return {
    tallaIds,
    inventarioPorTalla,
    existencias,
    updatedAt: admin.firestore.Timestamp.now(),
  };
};

async function migrateProductsSizeInventory(): Promise<void> {
  console.log(
    `\n🚀 Iniciando migración de inventario por talla (${DRY_RUN ? "DRY-RUN" : "EJECUCIÓN"})`,
  );

  const snapshot = await firestoreTienda.collection(PRODUCTOS_COLLECTION).get();
  console.log(`📦 Productos detectados: ${snapshot.docs.length}`);

  if (snapshot.empty) {
    console.log("✅ No hay productos para migrar.");
    return;
  }

  let processed = 0;
  let toUpdate = 0;
  let updated = 0;
  let batchOps = 0;
  let batch = firestoreTienda.batch();

  for (const doc of snapshot.docs) {
    processed += 1;
    const data = doc.data();
    const normalized = getNormalizedPayload(data);

    const needsUpdate =
      !areEqual(normalizeTallaIds(data.tallaIds), normalized.tallaIds) ||
      !areEqual(
        completeInventarioPorTalla(normalized.tallaIds, data.inventarioPorTalla),
        normalized.inventarioPorTalla,
      ) ||
      Number(data.existencias ?? 0) !== normalized.existencias;

    if (!needsUpdate) {
      continue;
    }

    toUpdate += 1;
    const logPrefix = DRY_RUN ? "🔍 DRY-RUN" : "✍️ Actualizando";
    console.log(
      `${logPrefix} ${doc.id}: tallaIds=${JSON.stringify(normalized.tallaIds)} existencias=${normalized.existencias}`,
    );

    if (!DRY_RUN) {
      batch.update(doc.ref, normalized);
      batchOps += 1;

      if (batchOps >= BATCH_LIMIT) {
        await batch.commit();
        updated += batchOps;
        batch = firestoreTienda.batch();
        batchOps = 0;
      }
    }
  }

  if (!DRY_RUN && batchOps > 0) {
    await batch.commit();
    updated += batchOps;
  }

  console.log("\n📊 Resumen migración:");
  console.log(`- Procesados: ${processed}`);
  console.log(`- Detectados para actualización: ${toUpdate}`);
  console.log(`- Actualizados: ${DRY_RUN ? 0 : updated}`);
  console.log(`- Modo: ${DRY_RUN ? "DRY-RUN" : "EJECUCIÓN"}`);
  console.log("✅ Migración finalizada.\n");
}

migrateProductsSizeInventory()
  .catch((error) => {
    console.error("❌ Error en migración de inventario por talla:", error);
    process.exitCode = 1;
  })
  .finally(() => {
    // Asegura cierre limpio al ejecutar con ts-node-dev.
    setTimeout(() => process.exit(process.exitCode ?? 0), 50);
  });
