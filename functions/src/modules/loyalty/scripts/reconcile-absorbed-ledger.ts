/**
 * Reconciliación de puntos POS absorbidos por el wallet.
 *
 * El problema
 * -----------
 * Cuando el POS escribía los puntos sólo en `usuariosApp.puntosActuales`, una
 * operación oficial posterior (típicamente la racha) re-materializaba el wallet
 * desde ese espejo y se llevaba los puntos POS dentro de `availablePoints` sin
 * dejar ninguna fila en el ledger. El socio conserva su saldo, pero el ledger
 * ya no explica de dónde salen esos puntos: queda un salto en el encadenado
 * `balanceBefore`/`balanceAfter`.
 *
 * Reacreditar esas ventas los duplicaría, así que la reparación normal las
 * clasifica como `ABSORBED` y no las toca. Este script cierra el otro lado del
 * problema: documenta en el ledger las ventas que el wallet ya se tragó,
 * SIN MOVER NINGÚN SALDO.
 *
 * Cómo
 * ----
 * La transacción se inserta ocupando exactamente el hueco: `balanceBefore` es
 * el saldo previo al salto y `balanceAfter` el posterior. Así la cadena queda
 * continua y la suma del ledger vuelve a coincidir con el wallet sin reescribir
 * ninguna fila existente. No se escribe ni el wallet ni el espejo legacy.
 *
 * Sólo actúa cuando la correspondencia es exacta: si los movimientos POS
 * previos al salto no suman justo su magnitud, el socio se aísla para revisión
 * manual en lugar de adivinar.
 *
 * DRY-RUN POR DEFECTO. Sólo escribe con `--apply`.
 *
 * Uso:
 *   node lib/modules/loyalty/scripts/reconcile-absorbed-ledger.js
 *   node lib/modules/loyalty/scripts/reconcile-absorbed-ledger.js --member=<uid>
 *   node lib/modules/loyalty/scripts/reconcile-absorbed-ledger.js --apply
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
import conversionRulesService from "../services/conversion-rules.service";
import { POS_SALE_CHANNEL } from "../utils/pos-sale.util";

export const RECONCILE_SCRIPT_VERSION = "pos-absorbed-reconcile@1.0.0";

const POS_MOVEMENT_PREFIX = "pos_acc_";
const USUARIOS = "usuariosApp";
const MOVIMIENTOS = "movimientos_puntos";

export interface ReconcileOptions {
  apply: boolean;
  member?: string;
  reportDir: string;
}

export function parseOptions(argv: string[]): ReconcileOptions {
  const get = (name: string) =>
    argv.find((a) => a.startsWith(`--${name}=`))?.slice(`--${name}=`.length);
  return {
    apply: argv.includes("--apply"),
    member: get("member"),
    reportDir: get("report-dir") ?? path.resolve(process.cwd(), "reports"),
  };
}

/** Clave externa propia: no colisiona con `pos-sale:` ni con su reverso. */
export function buildAbsorbedExternalId(ventaId: string): string {
  return `pos-absorbed:${ventaId}`;
}

interface LedgerRow {
  id: string;
  points: number;
  balanceBefore: number;
  balanceAfter: number;
  createdAtMs: number;
}

interface PosMovement {
  movementId: string;
  ventaId: string;
  puntos: number;
  createdAtMs: number;
}

export interface AbsorptionFill {
  ventaId: string;
  movementId: string;
  points: number;
  balanceBefore: number;
  balanceAfter: number;
  atMs: number;
}

export interface MemberPlan {
  memberId: string;
  walletPoints: number;
  ledgerSum: number;
  hueco: number;
  fills: AbsorptionFill[];
  problema?: string;
}

const toMillis = (value: unknown): number | null => {
  if (value instanceof Timestamp) return value.toMillis();
  if (
    value &&
    typeof value === "object" &&
    typeof (value as { _seconds?: number })._seconds === "number"
  ) {
    const v = value as { _seconds: number; _nanoseconds?: number };
    return v._seconds * 1000 + Math.floor((v._nanoseconds ?? 0) / 1e6);
  }
  if (typeof value === "number") return value;
  return null;
};

/**
 * Reparte el hueco entre los movimientos POS que lo provocaron, encadenando
 * cada fila con la siguiente para que no quede ningún salto intermedio.
 */
export function planFills(
  gapAtMs: number,
  gapFrom: number,
  gapTo: number,
  movements: PosMovement[],
): AbsorptionFill[] | null {
  const previos = movements
    .filter((m) => m.createdAtMs < gapAtMs)
    .sort((a, b) => a.createdAtMs - b.createdAtMs);

  const magnitud = gapTo - gapFrom;
  const fills: AbsorptionFill[] = [];
  let saldo = gapFrom;

  for (const movement of previos) {
    if (saldo + movement.puntos > gapTo) break;
    fills.push({
      ventaId: movement.ventaId,
      movementId: movement.movementId,
      points: movement.puntos,
      balanceBefore: saldo,
      balanceAfter: saldo + movement.puntos,
      // Justo antes del salto, para que el orden cronológico del ledger
      // coincida con el orden del encadenado.
      atMs: gapAtMs - (previos.length - fills.length),
    });
    saldo += movement.puntos;
    if (saldo === gapTo) break;
  }

  if (saldo !== gapTo) return null;
  if (!fills.length && magnitud !== 0) return null;
  return fills;
}

async function loadMemberPlan(
  db: FirebaseFirestore.Firestore,
  memberId: string,
): Promise<MemberPlan | null> {
  const [walletSnap, txnSnap, movSnap] = await Promise.all([
    db.collection(LOYALTY_COLLECTIONS.WALLETS).doc(memberId).get(),
    db
      .collection(LOYALTY_COLLECTIONS.TRANSACTIONS)
      .where("memberId", "==", memberId)
      .get(),
    db.collection(USUARIOS).doc(memberId).collection(MOVIMIENTOS).get(),
  ]);

  if (!walletSnap.exists) return null;

  const walletPoints = Number(walletSnap.data()?.availablePoints ?? 0);
  const rows: LedgerRow[] = [];
  for (const doc of txnSnap.docs) {
    const data = doc.data();
    const createdAtMs = toMillis(data.createdAt);
    if (createdAtMs === null) continue;
    rows.push({
      id: doc.id,
      points: Number(data.points ?? 0),
      balanceBefore: Number(data.balanceBefore ?? 0),
      balanceAfter: Number(data.balanceAfter ?? 0),
      createdAtMs,
    });
  }
  rows.sort((a, b) => a.createdAtMs - b.createdAtMs);

  const ledgerSum = rows.reduce((sum, r) => sum + r.points, 0);
  if (ledgerSum === walletPoints) return null;

  const yaReconciliadas = new Set<string>();
  for (const doc of txnSnap.docs) {
    const ext = doc.data().externalTransactionId;
    if (typeof ext === "string" && ext.startsWith("pos-absorbed:")) {
      yaReconciliadas.add(ext.slice("pos-absorbed:".length));
    }
  }

  const movements: PosMovement[] = [];
  for (const doc of movSnap.docs) {
    if (!doc.id.startsWith(POS_MOVEMENT_PREFIX)) continue;
    const data = doc.data();
    const createdAtMs = toMillis(data.createdAt ?? data.fechaMovimiento);
    const puntos = Math.trunc(Number(data.puntos ?? 0));
    if (createdAtMs === null || puntos <= 0) continue;
    const ventaId =
      (typeof data.origenId === "string" && data.origenId.trim()) ||
      (typeof data.referencia === "string" && data.referencia.trim()) ||
      doc.id.slice(POS_MOVEMENT_PREFIX.length);
    if (yaReconciliadas.has(ventaId)) continue;
    movements.push({ movementId: doc.id, ventaId, puntos, createdAtMs });
  }

  const plan: MemberPlan = {
    memberId,
    walletPoints,
    ledgerSum,
    hueco: walletPoints - ledgerSum,
    fills: [],
  };

  let esperado = 0;
  for (const row of rows) {
    const salto = row.balanceBefore - esperado;
    if (salto > 0) {
      const fills = planFills(
        row.createdAtMs,
        esperado,
        row.balanceBefore,
        movements.filter(
          (m) => !plan.fills.some((f) => f.movementId === m.movementId),
        ),
      );
      if (!fills) {
        plan.problema = `Salto de ${salto} puntos que los movimientos POS previos no explican exactamente`;
        return plan;
      }
      plan.fills.push(...fills);
    }
    esperado = row.balanceAfter;
  }

  if (!plan.fills.length && !plan.problema) {
    plan.problema = `El ledger suma ${ledgerSum} y el wallet ${walletPoints}, pero no hay ningún salto que lo explique`;
  }

  return plan;
}

export async function applyFill(
  db: FirebaseFirestore.Firestore,
  memberId: string,
  fill: AbsorptionFill,
): Promise<"CREATED" | "ALREADY_PRESENT"> {
  const externalTransactionId = buildAbsorbedExternalId(fill.ventaId);
  const extKey = conversionRulesService.buildExternalTxnKey(
    POS_SALE_CHANNEL,
    externalTransactionId,
  );
  const extRef = db
    .collection(LOYALTY_COLLECTIONS.EXTERNAL_TXN_INDEX)
    .doc(extKey);
  const txnRef = db.collection(LOYALTY_COLLECTIONS.TRANSACTIONS).doc();

  return db.runTransaction(async (tx) => {
    const extSnap = await tx.get(extRef);
    if (extSnap.exists) return "ALREADY_PRESENT" as const;

    const at = Timestamp.fromMillis(fill.atMs);
    tx.set(txnRef, {
      transactionId: txnRef.id,
      memberId,
      actorId: "pos-absorbed-reconcile",
      actorType: LoyaltyActorType.SERVICE,
      type: LoyaltyTransactionType.EARN,
      status: LoyaltyTransactionStatus.CONFIRMED,
      points: fill.points,
      balanceBefore: fill.balanceBefore,
      balanceAfter: fill.balanceAfter,
      channel: POS_SALE_CHANNEL,
      currency: "MXN",
      externalTransactionId,
      description: `Puntos POS ${fill.ventaId} absorbidos por el wallet antes de existir en el ledger`,
      reasonCode: "POS_ABSORBED_RECONCILE",
      metadata: {
        source: "POS",
        repair: true,
        absorbed: true,
        // El saldo del socio no cambia: esta fila sólo documenta puntos que el
        // wallet ya contenía. Marcado para que un rollback nunca la reste.
        balanceNeutral: true,
        ventaId: fill.ventaId,
        originalMovementId: fill.movementId,
        reconciledAt: new Date().toISOString(),
        reconcileScript: RECONCILE_SCRIPT_VERSION,
      },
      createdAt: at,
    });

    tx.create(extRef, {
      transactionId: txnRef.id,
      memberId,
      channel: POS_SALE_CHANNEL,
    });

    return "CREATED" as const;
  });
}

async function collectMemberIds(
  db: FirebaseFirestore.Firestore,
  member?: string,
): Promise<string[]> {
  if (member) return [member];
  const snap = await db.collection(LOYALTY_COLLECTIONS.WALLETS).get();
  return snap.docs.map((d) => d.id);
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const options = parseOptions(argv);
  const mode = options.apply ? "apply" : "dry-run";

  console.log(`\n=== ${RECONCILE_SCRIPT_VERSION} | modo: ${mode.toUpperCase()} ===`);
  if (!options.apply) {
    console.log("DRY-RUN: no se escribe absolutamente nada.");
  }
  console.log("Este script NUNCA modifica wallets ni el espejo legacy.\n");

  const memberIds = await collectMemberIds(firestoreApp, options.member);
  const planes: MemberPlan[] = [];

  for (const memberId of memberIds) {
    const plan = await loadMemberPlan(firestoreApp, memberId);
    if (plan) planes.push(plan);
  }

  const accionables = planes.filter((p) => !p.problema && p.fills.length);
  const problematicos = planes.filter((p) => p.problema);

  let creadas = 0;
  let yaPresentes = 0;
  let puntosDocumentados = 0;

  if (options.apply) {
    for (const plan of accionables) {
      for (const fill of plan.fills) {
        const result = await applyFill(firestoreApp, plan.memberId, fill);
        if (result === "CREATED") {
          creadas += 1;
          puntosDocumentados += fill.points;
        } else {
          yaPresentes += 1;
        }
      }
    }
  } else {
    for (const plan of accionables) {
      creadas += plan.fills.length;
      puntosDocumentados += plan.fills.reduce((s, f) => s + f.points, 0);
    }
  }

  const summary = {
    script: RECONCILE_SCRIPT_VERSION,
    mode,
    generatedAt: new Date().toISOString(),
    sociosAnalizados: memberIds.length,
    sociosConDescuadre: planes.length,
    sociosReconciliables: accionables.length,
    transaccionesDocumentadas: creadas,
    puntosDocumentados,
    yaPresentes,
    sociosParaRevisionManual: problematicos.length,
  };

  console.log(JSON.stringify(summary, null, 2));

  if (problematicos.length) {
    console.log("\nSocios que requieren revisión manual:");
    for (const plan of problematicos) {
      console.log(` - ${plan.memberId}: ${plan.problema}`);
    }
  }

  fs.mkdirSync(options.reportDir, { recursive: true });
  const reportPath = path.join(options.reportDir, "pos-absorbed-reconcile.json");
  fs.writeFileSync(
    reportPath,
    JSON.stringify({ summary, planes }, null, 2),
    "utf8",
  );
  console.log(`\nReporte: ${reportPath}`);

  if (!options.apply) {
    console.log("Nada fue modificado. Usa --apply para documentar el ledger.");
  }
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error("Fallo la reconciliación:", error);
      process.exit(1);
    });
}
