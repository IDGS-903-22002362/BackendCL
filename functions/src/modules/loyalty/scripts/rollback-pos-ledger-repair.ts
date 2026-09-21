/**
 * Rollback de la reparación POS → ledger.
 *
 * Revierte las transacciones creadas por `repair-pos-ledger` sin manipular
 * saldos a mano: por cada transacción reparada emite una transacción
 * compensatoria negativa, ajusta el wallet y vuelve a sincronizar el espejo
 * legacy. El ledger conserva así los dos eventos (el alta y su reverso), que
 * es lo que permite auditar qué pasó.
 *
 * DRY-RUN POR DEFECTO. Sólo escribe con `--apply`.
 *
 * Uso:
 *   node lib/modules/loyalty/scripts/rollback-pos-ledger-repair.js
 *   node lib/modules/loyalty/scripts/rollback-pos-ledger-repair.js --batch=<id>
 *   node lib/modules/loyalty/scripts/rollback-pos-ledger-repair.js --apply
 */
import * as fs from "fs";
import * as path from "path";
import { Timestamp } from "firebase-admin/firestore";
import { firestoreApp } from "../../../config/app.firebase";
import { LOYALTY_COLLECTIONS } from "../constants/loyalty.constants";
import {
  LoyaltyActorType,
  LoyaltyTransactionStatus,
  LoyaltyTransactionType,
} from "../models/loyalty.enums";
import { LoyaltyWallet } from "../models/loyalty.types";
import conversionRulesService from "../services/conversion-rules.service";
import { POS_SALE_CHANNEL } from "../utils/pos-sale.util";

export const ROLLBACK_SCRIPT_VERSION = "pos-ledger-rollback@1.0.0";

const USUARIOS = "usuariosApp";

export interface RollbackCandidate {
  transactionId: string;
  memberId: string;
  points: number;
  ventaId: string;
  originalMovementId: string;
  repairBatchId?: string;
  repairedAt?: string;
}

export interface RollbackOptions {
  apply: boolean;
  batchId?: string;
  ventaIds?: string[];
  reportDir: string;
}

export function parseOptions(argv: string[]): RollbackOptions {
  const get = (name: string) =>
    argv.find((a) => a.startsWith(`--${name}=`))?.slice(`--${name}=`.length);
  const ventas = get("venta");
  return {
    apply: argv.includes("--apply"),
    batchId: get("batch"),
    // Permite acotar el reverso a ventas concretas, para casos en que sólo
    // parte de una reparación resultó indebida.
    ventaIds: ventas
      ? ventas
          .split(",")
          .map((v) => v.trim())
          .filter(Boolean)
      : undefined,
    reportDir: get("report-dir") ?? path.resolve(process.cwd(), "reports"),
  };
}

/** Clave externa del reverso: estable, para que dos ejecuciones no dupliquen. */
export function buildRollbackExternalId(transactionId: string): string {
  return `pos-repair-rollback:${transactionId}`;
}

/**
 * Localiza las transacciones que creó la reparación. Se filtra en memoria por
 * `metadata.repair` porque indexar campos anidados de metadata exigiría un
 * índice compuesto nuevo y este script es de uso excepcional.
 */
export async function findRepairedTransactions(
  db: FirebaseFirestore.Firestore,
  batchId?: string,
  ventaIds?: string[],
): Promise<RollbackCandidate[]> {
  const ventaFilter = ventaIds?.length ? new Set(ventaIds) : undefined;
  const snap = await db
    .collection(LOYALTY_COLLECTIONS.TRANSACTIONS)
    .where("reasonCode", "==", "POS_LEDGER_REPAIR")
    .get();

  const candidates: RollbackCandidate[] = [];

  for (const doc of snap.docs) {
    const data = doc.data();
    const metadata = (data.metadata ?? {}) as Record<string, unknown>;

    if (metadata.repair !== true) continue;
    // Las filas de reconciliación sólo documentan puntos que el wallet ya
    // contenía; restarlas le quitaría al socio puntos que sí son suyos.
    if (metadata.balanceNeutral === true) continue;
    if (batchId && metadata.repairBatchId !== batchId) continue;
    if (ventaFilter && !ventaFilter.has(String(metadata.ventaId ?? ""))) continue;

    candidates.push({
      transactionId: doc.id,
      memberId: String(data.memberId ?? ""),
      points: Math.trunc(Number(data.points ?? 0)),
      ventaId: String(metadata.ventaId ?? ""),
      originalMovementId: String(metadata.originalMovementId ?? ""),
      repairBatchId: metadata.repairBatchId as string | undefined,
      repairedAt: metadata.repairedAt as string | undefined,
    });
  }

  return candidates;
}

/**
 * Emite el reverso de una transacción reparada dentro de una transacción de
 * Firestore. Idempotente: la clave externa del reverso se crea con `create()`,
 * así que reejecutar no vuelve a restar puntos.
 */
export async function revertRepairedTransaction(
  db: FirebaseFirestore.Firestore,
  candidate: RollbackCandidate,
): Promise<
  | { status: "REVERTED"; transactionId: string; points: number }
  | { status: "ALREADY_REVERTED" }
  | { status: "SKIPPED"; reason: string }
> {
  const rollbackExternalId = buildRollbackExternalId(candidate.transactionId);
  const extKey = conversionRulesService.buildExternalTxnKey(
    POS_SALE_CHANNEL,
    rollbackExternalId,
  );
  const extRef = db
    .collection(LOYALTY_COLLECTIONS.EXTERNAL_TXN_INDEX)
    .doc(extKey);
  const walletRef = db
    .collection(LOYALTY_COLLECTIONS.WALLETS)
    .doc(candidate.memberId);
  const userRef = db.collection(USUARIOS).doc(candidate.memberId);
  const txnRef = db.collection(LOYALTY_COLLECTIONS.TRANSACTIONS).doc();

  return db.runTransaction(async (tx) => {
    const [extSnap, walletSnap, userSnap] = await Promise.all([
      tx.get(extRef),
      tx.get(walletRef),
      tx.get(userRef),
    ]);

    if (extSnap.exists) {
      return { status: "ALREADY_REVERTED" as const };
    }
    if (!walletSnap.exists) {
      return { status: "SKIPPED" as const, reason: "El socio no tiene wallet" };
    }
    if (!userSnap.exists) {
      return { status: "SKIPPED" as const, reason: "El socio ya no existe" };
    }

    const wallet = walletSnap.data() as LoyaltyWallet;
    const balanceBefore = wallet.availablePoints;
    const balanceAfter = balanceBefore - candidate.points;

    if (balanceAfter < 0) {
      // El socio ya gastó esos puntos. Dejar el wallet en negativo sería peor
      // que no revertir: se aísla para revisión manual.
      return {
        status: "SKIPPED" as const,
        reason: `Revertir dejaría el saldo en ${balanceAfter}; los puntos ya se gastaron`,
      };
    }

    const level = conversionRulesService.calculateLevel(balanceAfter);
    const now = Timestamp.now();

    tx.set(
      walletRef,
      {
        ...wallet,
        availablePoints: balanceAfter,
        lifetimeEarnedPoints: Math.max(
          0,
          (wallet.lifetimeEarnedPoints ?? 0) - candidate.points,
        ),
        level,
        updatedAt: now,
      },
      { merge: true },
    );

    tx.set(txnRef, {
      transactionId: txnRef.id,
      memberId: candidate.memberId,
      actorId: "pos-ledger-rollback",
      actorType: LoyaltyActorType.SERVICE,
      type: LoyaltyTransactionType.ADJUSTMENT,
      status: LoyaltyTransactionStatus.CONFIRMED,
      points: -candidate.points,
      balanceBefore,
      balanceAfter,
      channel: POS_SALE_CHANNEL,
      currency: "MXN",
      externalTransactionId: rollbackExternalId,
      description: `Reverso de reparación POS ${candidate.ventaId}`,
      reasonCode: "POS_LEDGER_REPAIR_ROLLBACK",
      metadata: {
        source: "POS",
        rollback: true,
        revertsTransactionId: candidate.transactionId,
        originalMovementId: candidate.originalMovementId,
        ventaId: candidate.ventaId,
        repairBatchId: candidate.repairBatchId ?? null,
        revertedAt: now.toDate().toISOString(),
        rollbackScript: ROLLBACK_SCRIPT_VERSION,
      },
      createdAt: now,
    });

    tx.set(
      userRef,
      { puntosActuales: balanceAfter, nivel: level, updatedAt: now },
      { merge: true },
    );

    tx.create(extRef, {
      transactionId: txnRef.id,
      memberId: candidate.memberId,
      channel: POS_SALE_CHANNEL,
    });

    return {
      status: "REVERTED" as const,
      transactionId: txnRef.id,
      points: candidate.points,
    };
  });
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const options = parseOptions(argv);
  const mode = options.apply ? "apply" : "dry-run";

  console.log(`\n=== ${ROLLBACK_SCRIPT_VERSION} | modo: ${mode.toUpperCase()} ===`);
  if (!options.apply) {
    console.log("DRY-RUN: no se escribe absolutamente nada.");
  }
  if (options.batchId) {
    console.log(`Acotado al lote: ${options.batchId}`);
  }
  if (options.ventaIds?.length) {
    console.log(`Acotado a ${options.ventaIds.length} ventas concretas`);
  }

  const candidates = await findRepairedTransactions(
    firestoreApp,
    options.batchId,
    options.ventaIds,
  );
  console.log(`Transacciones de reparación encontradas: ${candidates.length}`);

  const resumen = {
    script: ROLLBACK_SCRIPT_VERSION,
    mode,
    generatedAt: new Date().toISOString(),
    batchId: options.batchId ?? null,
    candidatas: candidates.length,
    puntosCandidatos: candidates.reduce((acc, c) => acc + c.points, 0),
    revertidas: 0,
    yaRevertidas: 0,
    omitidas: 0,
    errores: 0,
    detalles: [] as Array<Record<string, unknown>>,
  };

  for (const candidate of candidates) {
    if (!options.apply) {
      resumen.detalles.push({ ...candidate, resultado: "SIMULADO" });
      continue;
    }

    try {
      const result = await revertRepairedTransaction(firestoreApp, candidate);
      if (result.status === "REVERTED") resumen.revertidas += 1;
      else if (result.status === "ALREADY_REVERTED") resumen.yaRevertidas += 1;
      else resumen.omitidas += 1;

      resumen.detalles.push({
        ...candidate,
        resultado: result.status,
        motivo: result.status === "SKIPPED" ? result.reason : undefined,
      });
    } catch (error) {
      resumen.errores += 1;
      resumen.detalles.push({
        ...candidate,
        resultado: "ERROR",
        motivo: error instanceof Error ? error.message : String(error),
      });
    }
  }

  fs.mkdirSync(options.reportDir, { recursive: true });
  const target = path.join(options.reportDir, "pos-ledger-rollback.json");
  fs.writeFileSync(target, JSON.stringify(resumen, null, 2), "utf8");

  console.log(JSON.stringify({ ...resumen, detalles: undefined }, null, 2));
  console.log(`\nReporte: ${target}`);
  if (!options.apply) {
    console.log("Nada fue modificado. Usa --apply para ejecutar el reverso.");
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error("Error en rollback:", error);
    process.exit(1);
  });
}
