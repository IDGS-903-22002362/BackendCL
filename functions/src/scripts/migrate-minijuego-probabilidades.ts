/**
 * Migración de minijuegos con pesos relativos a probabilidades porcentuales.
 *
 * Uso:
 *   npm run migrate:minijuego-probabilidades                 (simulación, no escribe)
 *   npm run migrate:minijuego-probabilidades -- --apply      (escribe; solo emulador)
 *   ... -- --apply --allow-production                        (escribe en Firestore real)
 *
 * La migración NO es obligatoria: los minijuegos antiguos siguen sorteando con
 * sus pesos originales y el panel los muestra convertidos a porcentaje. Este
 * script solo sirve para dejar los datos en el formato nuevo de forma masiva.
 *
 * Por cada premio escribe:
 *   probabilidad  porcentaje con precisión de 0.001 % (suma exacta 100 %)
 *   weight        la misma probabilidad en unidades de 0.001 %
 *   pesoOriginal  el peso anterior, para poder revertir
 */
import { firestoreApp } from "../config/app.firebase";
import { percentToUnits, planWeightMigration } from "../services/minijuego.probability";

const APPLY = process.argv.includes("--apply");
const ALLOW_PRODUCTION = process.argv.includes("--allow-production");

type PremioDoc = { id: string; weight: number; probabilidad?: unknown; nombre: string };

function readPremios(
  docs: FirebaseFirestore.QueryDocumentSnapshot[],
): PremioDoc[] {
  return docs
    .map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        nombre: typeof data.nombre === "string" ? data.nombre : doc.id,
        weight: typeof data.weight === "number" ? data.weight : 1,
        probabilidad: data.probabilidad,
        orden: typeof data.orden === "number" ? data.orden : 0,
      };
    })
    .sort((a, b) => a.orden - b.orden);
}

function needsMigration(premios: PremioDoc[]): boolean {
  return (
    premios.length > 0 &&
    !premios.every((premio) => percentToUnits(premio.probabilidad) != null)
  );
}

async function main(): Promise<void> {
  const emulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST?.trim());
  if (APPLY && !emulator && !ALLOW_PRODUCTION) {
    throw new Error(
      "--apply sin FIRESTORE_EMULATOR_HOST escribiría en Firestore real. Agrega --allow-production solo si es intencional.",
    );
  }

  console.log(
    `Modo: ${APPLY ? "ESCRITURA" : "SIMULACIÓN (sin escrituras)"} · Destino: ${
      emulator ? `emulador ${process.env.FIRESTORE_EMULATOR_HOST}` : "Firestore real"
    }`,
  );

  const minijuegos = await firestoreApp.collection("minijuegos").get();
  let pendientes = 0;
  let migrados = 0;

  for (const minijuego of minijuegos.docs) {
    const premiosRef = minijuego.ref.collection("premios");
    const premios = readPremios((await premiosRef.get()).docs);
    if (!needsMigration(premios)) continue;

    pendientes += 1;
    const plan = planWeightMigration(premios);
    console.log(`\nMinijuego ${minijuego.id}`);
    console.table(
      plan.rows.map((row, index) => ({
        premio: premios[index].nombre,
        peso: row.pesoOriginal,
        "exacto %": row.porcentajeExacto.toFixed(6),
        "nuevo %": row.probabilidad,
        "desviación pp": row.desviacion.toFixed(6),
      })),
    );
    console.log(
      `Suma: ${plan.totalUnits / 1000}% · Desviación máxima: ${plan.maxDesviacion.toFixed(6)} pp`,
    );

    if (!APPLY) continue;

    await firestoreApp.runTransaction(async (tx) => {
      const current = readPremios((await tx.get(premiosRef)).docs);
      const sameConfig =
        current.length === premios.length &&
        current.every(
          (premio, index) =>
            premio.id === premios[index].id &&
            premio.weight === premios[index].weight,
        );
      if (!sameConfig || !needsMigration(current)) {
        throw new Error(
          `El minijuego ${minijuego.id} cambió durante la migración. Vuelve a ejecutar el script.`,
        );
      }
      for (const row of plan.rows) {
        tx.set(
          premiosRef.doc(row.id),
          {
            probabilidad: row.probabilidad,
            weight: row.unidades,
            pesoOriginal: row.pesoOriginal,
          },
          { merge: true },
        );
      }
    });
    migrados += 1;
  }

  console.log(
    `\nMinijuegos con pesos: ${pendientes}. ${
      APPLY ? `Migrados: ${migrados}.` : "Nada se escribió (simulación)."
    }`,
  );
}

main().catch((error: unknown) => {
  console.error(
    "migrate_minijuego_probabilidades_failed",
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
