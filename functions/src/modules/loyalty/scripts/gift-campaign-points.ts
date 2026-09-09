/**
 * Regalo masivo de puntos a todos los socios registrados en usuariosApp.
 *
 * Acredita por el motor oficial (wallet + ledger + espejo puntosActuales +
 * movimientos_puntos). No toca saldos a mano: eso es lo que provocó el
 * incidente POS.
 *
 * Campaña 8/09/2026: +20 pts, movimiento
 * "regalo 20 puntos del 8/09/2026".
 *
 * Idempotente: cada socio queda marcado con `regaloPuntos20260908At`.
 * Reejecutar no duplica puntos.
 *
 * Uso
 * ---
 *   npm run build
 *   node lib/modules/loyalty/scripts/gift-campaign-points.js
 *   node lib/modules/loyalty/scripts/gift-campaign-points.js --apply
 *
 * Opciones: --limit=N  --member=<uid>  --concurrency=8  --out=<ruta.json>
 */
import * as fs from "fs";
import * as path from "path";
import { firestoreApp } from "../../../config/app.firebase";
import LoyaltyProblemError from "../errors/loyalty-problem.error";
import loyaltyEngineService from "../services/loyalty-engine.service";

export const SCRIPT_VERSION = "gift-campaign-points@1.0.0";

export const CAMPAIGN_KEY = "regalo-20-puntos-2026-09-08";
export const CAMPAIGN_POINTS = 20;
export const CAMPAIGN_DESCRIPTION = "regalo 20 puntos del 8/09/2026";
export const CAMPAIGN_CLAIM_FIELD = "regaloPuntos20260908At";

const USUARIOS = "usuariosApp";
const PAGE_SIZE = 200;
const DEFAULT_CONCURRENCY = 8;

interface Options {
  apply: boolean;
  limit?: number;
  memberId?: string;
  concurrency: number;
  report?: string;
}

interface UserOutcome {
  uid: string;
  status: "applied" | "already" | "skipped_inactive" | "would_apply" | "error";
  puntosAntes?: number;
  puntosDespues?: number;
  error?: string;
}

function parseOptions(argv: string[]): Options {
  const get = (...names: string[]): string | undefined => {
    for (const name of names) {
      const found = argv.find((a) => a.startsWith(`--${name}=`));
      if (found) return found.split("=").slice(1).join("=");
    }
    return undefined;
  };

  const rawLimit = get("limit");
  const limit = rawLimit === undefined ? undefined : Number(rawLimit);
  if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) {
    throw new Error(`--limit debe ser un entero positivo (recibido: ${rawLimit}).`);
  }

  const rawConcurrency = get("concurrency");
  const concurrency =
    rawConcurrency === undefined ? DEFAULT_CONCURRENCY : Number(rawConcurrency);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 25) {
    throw new Error("--concurrency debe ser un entero entre 1 y 25.");
  }

  return {
    apply: argv.includes("--apply"),
    limit,
    memberId: get("member")?.trim() || undefined,
    concurrency,
    report: get("out", "report"),
  };
}

function isInactive(data: FirebaseFirestore.DocumentData | undefined): boolean {
  return data?.activo === false;
}

async function mapPool<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let index = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      const current = items[index];
      index += 1;
      await fn(current);
    }
  });
  await Promise.all(workers);
}

async function listTargetUids(options: Options): Promise<string[]> {
  if (options.memberId) {
    return [options.memberId];
  }

  const uids: string[] = [];
  let lastDoc: FirebaseFirestore.QueryDocumentSnapshot | null = null;

  while (true) {
    let query = firestoreApp
      .collection(USUARIOS)
      .orderBy("__name__")
      .limit(PAGE_SIZE);
    if (lastDoc) {
      query = query.startAfter(lastDoc);
    }
    const snapshot = await query.get();
    if (snapshot.empty) break;

    for (const doc of snapshot.docs) {
      uids.push(doc.id);
      if (options.limit && uids.length >= options.limit) {
        return uids;
      }
    }

    lastDoc = snapshot.docs[snapshot.docs.length - 1];
    if (snapshot.size < PAGE_SIZE) break;
  }

  return uids;
}

async function processUser(uid: string, apply: boolean): Promise<UserOutcome> {
  const snap = await firestoreApp.collection(USUARIOS).doc(uid).get();
  if (!snap.exists) {
    return { uid, status: "error", error: "MEMBER_NOT_FOUND" };
  }

  const data = snap.data() ?? {};
  if (isInactive(data)) {
    return { uid, status: "skipped_inactive" };
  }

  const puntosAntes = Math.trunc(Number(data.puntosActuales ?? 0));
  if (data[CAMPAIGN_CLAIM_FIELD]) {
    return { uid, status: "already", puntosAntes, puntosDespues: puntosAntes };
  }

  if (!apply) {
    return {
      uid,
      status: "would_apply",
      puntosAntes,
      puntosDespues: puntosAntes + CAMPAIGN_POINTS,
    };
  }

  try {
    const txn = await loyaltyEngineService.applyCampaignGiftBonus(uid, {
      campaignKey: CAMPAIGN_KEY,
      points: CAMPAIGN_POINTS,
      description: CAMPAIGN_DESCRIPTION,
      claimField: CAMPAIGN_CLAIM_FIELD,
    });
    if (txn === null) {
      return { uid, status: "already", puntosAntes, puntosDespues: puntosAntes };
    }
    return {
      uid,
      status: "applied",
      puntosAntes: txn.balanceBefore,
      puntosDespues: txn.balanceAfter,
    };
  } catch (error) {
    const message =
      error instanceof LoyaltyProblemError
        ? error.code
        : error instanceof Error
          ? error.message
          : String(error);
    return { uid, status: "error", puntosAntes, error: message };
  }
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  console.log(SCRIPT_VERSION);
  console.log(
    options.apply
      ? "MODO APPLY: se van a acreditar puntos."
      : "DRY-RUN: no se escribe nada. Pasa --apply para acreditar.",
  );
  console.log(
    `Campaña=${CAMPAIGN_KEY} puntos=${CAMPAIGN_POINTS} movimiento="${CAMPAIGN_DESCRIPTION}"`,
  );

  const uids = await listTargetUids(options);
  console.log(`Usuarios a revisar: ${uids.length}`);

  const outcomes: UserOutcome[] = [];
  let processed = 0;

  await mapPool(uids, options.concurrency, async (uid) => {
    const outcome = await processUser(uid, options.apply);
    outcomes.push(outcome);
    processed += 1;
    if (processed % 100 === 0 || processed === uids.length) {
      console.log(`Progreso ${processed}/${uids.length}`);
    }
  });

  const summary = {
    script: SCRIPT_VERSION,
    campaignKey: CAMPAIGN_KEY,
    points: CAMPAIGN_POINTS,
    description: CAMPAIGN_DESCRIPTION,
    apply: options.apply,
    revisados: outcomes.length,
    wouldApply: outcomes.filter((o) => o.status === "would_apply").length,
    applied: outcomes.filter((o) => o.status === "applied").length,
    already: outcomes.filter((o) => o.status === "already").length,
    skippedInactive: outcomes.filter((o) => o.status === "skipped_inactive").length,
    errors: outcomes.filter((o) => o.status === "error").length,
  };

  console.log(JSON.stringify(summary, null, 2));

  const errorOutcomes = outcomes.filter((o) => o.status === "error");
  if (errorOutcomes.length > 0) {
    console.log("Errores:");
    for (const outcome of errorOutcomes.slice(0, 30)) {
      console.log(`  ${outcome.uid}: ${outcome.error}`);
    }
    if (errorOutcomes.length > 30) {
      console.log(`  … y ${errorOutcomes.length - 30} más`);
    }
  }

  const reportPath =
    options.report ??
    path.join(
      __dirname,
      "../../../../reports",
      `gift-campaign-points-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
    );
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(
    reportPath,
    JSON.stringify({ summary, outcomes }, null, 2),
    "utf8",
  );
  console.log(`Reporte: ${reportPath}`);

  if (summary.errors > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("Fallo el script de regalo de puntos:", error);
  process.exit(1);
});
