import "../config/env.bootstrap";
import { Timestamp } from "firebase-admin/firestore";
import { firestoreTienda } from "../config/firebase";

const DRY_RUN = process.argv.includes("--dry-run");
const PRODUCTOS_COLLECTION = "productos";
const BATCH_SIZE = 400;

function normalize(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

function isJersey(data: FirebaseFirestore.DocumentData): boolean {
  return normalize(`${data.descripcion ?? ""} ${data.clave ?? ""}`).includes(
    "jersey",
  );
}

async function backfillPersonalizable(): Promise<void> {
  console.log(
    `\nBackfill personalizable en jerseys (${DRY_RUN ? "DRY-RUN" : "EJECUCION"})`,
  );

  const snapshot = await firestoreTienda
    .collection(PRODUCTOS_COLLECTION)
    .get();

  const pending = snapshot.docs.filter(
    (doc) => isJersey(doc.data()) && doc.data().personalizable !== true,
  );

  console.log(`   Productos revisados: ${snapshot.size}`);
  console.log(`   Jerseys por activar: ${pending.length}`);

  for (const doc of pending) {
    const data = doc.data();
    console.log(
      `   - ${doc.id} | ${data.descripcion ?? "(sin descripcion)"} | activo=${data.activo} | personalizable=${data.personalizable ?? "(ausente)"}`,
    );
  }

  if (DRY_RUN || pending.length === 0) {
    console.log("Sin escrituras aplicadas");
    return;
  }

  for (let index = 0; index < pending.length; index += BATCH_SIZE) {
    const batch = firestoreTienda.batch();
    for (const doc of pending.slice(index, index + BATCH_SIZE)) {
      batch.update(doc.ref, {
        personalizable: true,
        updatedAt: Timestamp.now(),
      });
    }
    await batch.commit();
  }

  console.log(`Backfill completado: ${pending.length} productos actualizados`);
}

backfillPersonalizable().catch((error) => {
  console.error("Error en backfill personalizable:", error);
  process.exitCode = 1;
});
