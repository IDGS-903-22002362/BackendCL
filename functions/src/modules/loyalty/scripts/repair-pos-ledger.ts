/**
 * Reparación del incidente de puntos POS ↔ ledger oficial.
 *
 * Contexto
 * --------
 * El POS de concesiones, cuando no pudo hablar con BackendCL, escribió los
 * puntos directamente en `usuariosApp.puntosActuales` y dejó un movimiento
 * `pos_acc_<ventaId>`, sin registrar nada en `loyalty_transactions` ni en
 * `loyalty_wallets`. Como el motor oficial toma `loyalty_wallets` como saldo
 * base y luego sobrescribe el espejo legacy, la siguiente operación de loyalty
 * (racha, ecommerce, canje) borraba visualmente esos puntos.
 *
 * Qué hace este script
 * --------------------
 * Recorre TODOS los movimientos `pos_acc_*` y, por cada venta, decide con base
 * en transacciones reales (nunca comparando saldos) si esa venta llegó o no al
 * ledger, y si sus puntos están o no dentro del saldo del wallet.
 *
 * Clasificación (esta es la parte delicada)
 * -----------------------------------------
 * El wallet solo se mueve a través del ledger, salvo la primera vez: cuando no
 * existe, se inicializa copiando `puntosActuales`. Por eso el discriminante
 * correcto es el instante en que el wallet empezó a existir (T0), que se
 * reconstruye como la fecha de la transacción más antigua del ledger de ese
 * socio (o "aún no existe" si no tiene ninguna).
 *
 *  - `IN_LEDGER`        la venta ya tiene su transacción. No se toca.
 *  - `ABSORBED`         el movimiento POS es anterior a T0, así que sus puntos
 *                       ya entraron al wallet dentro del saldo inicial.
 *                       Faltan en el ledger (hueco de trazabilidad) pero el
 *                       saldo es correcto: acreditarlos duplicaría puntos.
 *  - `MISSING`          el movimiento POS es posterior a T0. El wallet nunca
 *                       los vio y el espejo legacy ya fue sobrescrito.
 *                       Estos son los puntos realmente perdidos.
 *  - `NO_WALLET_YET`    el socio no tiene wallet ni ledger. Sus puntos POS
 *                       siguen dentro de `puntosActuales` y se absorberán solos
 *                       cuando se cree el wallet. No hay pérdida todavía,
 *                       pero es un usuario POTENCIALMENTE AFECTADO.
 *
 * Nunca se calcula nada como `puntosActuales - availablePoints` ni con
 * `Math.max(...)`: eso devolvería puntos legítimamente gastados.
 *
 * Uso
 * ---
 *   npm run repair:pos-ledger              # dry-run (no escribe nada)
 *   npm run repair:pos-ledger -- --apply   # aplica la restitución
 *
 * Opciones: --limit=N  --member=<uid>  --out=<ruta base del reporte>
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
import { LoyaltyTransaction, LoyaltyWallet } from "../models/loyalty.types";
import conversionRulesService from "../services/conversion-rules.service";
import {
  buildPosSaleExternalTxnId,
  POS_ACCUMULATION_MOVEMENT_PREFIX,
  POS_SALE_CHANNEL,
} from "../utils/pos-sale.util";

export const REPAIR_SCRIPT_VERSION = "pos-ledger-repair@1.0.0";

/**
 * Identifica esta ejecución concreta. Queda en la metadata de cada transacción
 * creada para que el rollback pueda acotarse exactamente a un lote.
 */
export const REPAIR_BATCH_ID = `repair-${new Date()
  .toISOString()
  .replace(/[:.]/g, "-")}`;

const USUARIOS = "usuariosApp";
const MOVIMIENTOS = "movimientos_puntos";

export type PosMovementClassification =
  | "IN_LEDGER"
  | "ABSORBED"
  | "MISSING"
  | "NO_WALLET_YET"
  | "INVALID"
  | "MEMBER_NOT_FOUND";

export interface PosMovementRecord {
  movementId: string;
  memberId: string;
  ventaId: string;
  puntos: number;
  createdAtMs: number | null;
  saldoAnterior?: number;
  saldoNuevo?: number;
  descripcion?: string;
}

export interface ClassifiedMovement extends PosMovementRecord {
  externalTransactionId: string;
  classification: PosMovementClassification;
  reason: string;
  existingTransactionId?: string;
}

/**
 * `PUNTOS_PERDIDOS`  el espejo legacy ya fue sobrescrito por el motor oficial;
 *                    el socio ya no ve esos puntos en la app.
 * `EN_RIESGO`        los puntos POS siguen visibles en `puntosActuales` pero no
 *                    están en el wallet: desaparecerán en la próxima operación
 *                    de loyalty (racha, compra, canje).
 * `SIN_IMPACTO`      no hay movimientos POS fuera del ledger.
 */
export type UserImpact = "PUNTOS_PERDIDOS" | "EN_RIESGO" | "SIN_IMPACTO";

export interface UserRepairReport {
  uid: string;
  email?: string;
  telefono?: string;
  nombre?: string;
  impacto: UserImpact;
  usuariosAppPuntosActuales: number | null;
  walletAvailablePoints: number | null;
  walletExists: boolean;
  firstLedgerTxnAtMs: number | null;
  ledgerTransactionCount: number;
  posMovimientos: number;
  posYaEnLedger: number;
  posAbsorbidos: number;
  posFaltantes: number;
  puntosPosFaltantes: number;
  puntosPosAbsorbidos: number;
  ventaIdsFaltantes: string[];
  ventaIdsAbsorbidos: string[];
  saldoOficialActual: number | null;
  saldoEsperadoTrasImportar: number | null;
  inconsistencias: string[];
  movimientos: ClassifiedMovement[];
}

export interface RepairSummary {
  script: string;
  mode: "dry-run" | "apply";
  generatedAt: string;
  usuariosAnalizados: number;
  usuariosConMovimientosPos: number;
  /** Espejo legacy ya sobrescrito: el socio ya no ve los puntos. */
  usuariosAfectados: number;
  puntosYaPerdidos: number;
  /** Puntos POS aún visibles en el espejo pero ausentes del wallet. */
  usuariosPotencialmenteAfectados: number;
  puntosEnRiesgo: number;
  totalMovimientosPosAnalizados: number;
  movimientosYaEnLedger: number;
  movimientosAbsorbidos: number;
  movimientosFaltantes: number;
  movimientosInvalidos: number;
  puntosTotalesARestaurar: number;
  puntosAbsorbidosSinLedger: number;
  duplicadosDetectados: number;
  usuariosNoEncontrados: number;
  ventasNoEncontradas: number;
  casosAmbiguos: Array<{ uid: string; ventaId?: string; motivo: string }>;
  aplicados?: {
    transaccionesCreadas: number;
    puntosAcreditados: number;
    yaProcesadas: number;
    errores: Array<{ uid: string; ventaId: string; error: string }>;
  };
}

export interface RepairResult {
  summary: RepairSummary;
  usuarios: UserRepairReport[];
}

interface Options {
  apply: boolean;
  limit?: number;
  member?: string;
  out: string;
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

const ventaIdFromMovement = (
  docId: string,
  data: Record<string, unknown>,
): string => {
  const fromField =
    (typeof data.origenId === "string" && data.origenId.trim()) ||
    (typeof data.referencia === "string" && data.referencia.trim());
  if (fromField) return fromField;
  return docId.slice(POS_ACCUMULATION_MOVEMENT_PREFIX.length);
};

/** Recorre `movimientos_puntos` completo y devuelve solo los `pos_acc_*`. */
export async function collectPosMovements(
  db: FirebaseFirestore.Firestore,
  options: { limit?: number; member?: string } = {},
): Promise<{ movements: PosMovementRecord[]; invalid: PosMovementRecord[] }> {
  const movements: PosMovementRecord[] = [];
  const invalid: PosMovementRecord[] = [];
  const pageSize = 2000;
  let last: FirebaseFirestore.QueryDocumentSnapshot | null = null;

  while (true) {
    let query = db
      .collectionGroup(MOVIMIENTOS)
      .orderBy(require("firebase-admin/firestore").FieldPath.documentId())
      .limit(pageSize);
    if (last) query = query.startAfter(last);
    const snap = await query.get();
    if (snap.empty) break;

    for (const doc of snap.docs) {
      if (!doc.id.startsWith(POS_ACCUMULATION_MOVEMENT_PREFIX)) continue;

      const memberId = doc.ref.parent.parent?.id ?? "";
      if (options.member && memberId !== options.member) continue;

      const data = (doc.data() ?? {}) as Record<string, unknown>;
      const puntos = Math.trunc(Number(data.puntos));
      const record: PosMovementRecord = {
        movementId: doc.id,
        memberId,
        ventaId: ventaIdFromMovement(doc.id, data),
        puntos: Number.isFinite(puntos) ? puntos : 0,
        createdAtMs: toMillis(data.createdAt),
        saldoAnterior: Number(data.saldoAnterior),
        saldoNuevo: Number(data.saldoNuevo),
        descripcion:
          typeof data.descripcion === "string" ? data.descripcion : undefined,
      };

      if (!memberId || !record.ventaId || record.puntos <= 0) {
        invalid.push(record);
        continue;
      }
      movements.push(record);
    }

    last = snap.docs[snap.docs.length - 1];
    if (snap.size < pageSize) break;
    if (options.limit && movements.length >= options.limit) break;
  }

  return {
    movements: options.limit ? movements.slice(0, options.limit) : movements,
    invalid,
  };
}

/**
 * Decide, por socio, qué movimientos POS faltan realmente en el saldo.
 * Se apoya solo en transacciones del ledger, nunca en comparar saldos.
 */
export function classifyMemberMovements(input: {
  memberId: string;
  movements: PosMovementRecord[];
  walletExists: boolean;
  firstLedgerTxnAtMs: number | null;
  ledgerExternalIds: Map<string, string>;
  ledgerSaleIds: Map<string, string>;
  absorptionEvents?: LedgerAbsorptionEvent[];
}): ClassifiedMovement[] {
  const base = input.movements.map((movement) => {
    const externalTransactionId = buildPosSaleExternalTxnId(movement.ventaId);

    const existingTransactionId =
      input.ledgerExternalIds.get(externalTransactionId) ??
      input.ledgerSaleIds.get(movement.ventaId);
    if (existingTransactionId) {
      return {
        ...movement,
        externalTransactionId,
        classification: "IN_LEDGER" as const,
        reason: "La venta ya tiene transacción en el ledger oficial",
        existingTransactionId,
      };
    }

    // Sin wallet y sin ledger el saldo legacy sigue intacto: los puntos POS
    // se absorberán solos cuando se inicialice el wallet desde puntosActuales.
    if (!input.walletExists && input.firstLedgerTxnAtMs === null) {
      return {
        ...movement,
        externalTransactionId,
        classification: "NO_WALLET_YET" as const,
        reason:
          "El socio aún no tiene wallet ni ledger; los puntos siguen en puntosActuales",
      };
    }

    if (movement.createdAtMs === null) {
      return {
        ...movement,
        externalTransactionId,
        classification: "INVALID" as const,
        reason: "El movimiento no tiene createdAt; no se puede ubicar vs el wallet",
      };
    }

    if (
      input.firstLedgerTxnAtMs !== null &&
      movement.createdAtMs < input.firstLedgerTxnAtMs
    ) {
      return {
        ...movement,
        externalTransactionId,
        classification: "ABSORBED" as const,
        reason:
          "Anterior a la primera transacción del ledger: sus puntos ya entraron en el saldo inicial del wallet",
      };
    }

    return {
      ...movement,
      externalTransactionId,
      classification: "MISSING" as const,
      reason:
        "Posterior al arranque del wallet y sin transacción: los puntos nunca llegaron al saldo oficial",
    };
  });

  return applyAbsorptionEvents(base, input.absorptionEvents ?? []);
}

/**
 * Reclasifica como ABSORBED los movimientos que el wallet ya se tragó en un
 * salto de saldo posterior al arranque (típicamente al reclamar la racha, que
 * re-materializa el wallet desde el espejo legacy).
 *
 * Sólo reclasifica cuando la correspondencia es exacta: si los movimientos
 * previos al salto no suman justo su magnitud, se dejan como estaban y se
 * marca la inconsistencia, porque adivinar aquí significa duplicar o borrar
 * puntos de un socio real.
 */
function applyAbsorptionEvents(
  movements: ClassifiedMovement[],
  events: LedgerAbsorptionEvent[],
): ClassifiedMovement[] {
  if (!events.length) return movements;

  const result = [...movements];
  const consumidos = new Set<string>();

  for (const event of [...events].sort((a, b) => a.atMs - b.atMs)) {
    const elegibles = result
      .map((m, index) => ({ m, index }))
      .filter(
        ({ m }) =>
          m.classification === "MISSING" &&
          m.createdAtMs !== null &&
          m.createdAtMs < event.atMs &&
          !consumidos.has(m.movementId),
      )
      .sort((a, b) => (a.m.createdAtMs ?? 0) - (b.m.createdAtMs ?? 0));

    let acumulado = 0;
    let corte = -1;
    for (let i = 0; i < elegibles.length; i += 1) {
      acumulado += elegibles[i].m.puntos;
      if (acumulado === event.amount) {
        corte = i;
        break;
      }
      if (acumulado > event.amount) break;
    }

    if (corte === -1) {
      for (const { index } of elegibles) {
        result[index] = {
          ...result[index],
          reason: `${result[index].reason}. ATENCIÓN: el wallet dio un salto de ${event.amount} puntos sin transacción y no cuadra exactamente con los movimientos previos; revisar antes de acreditar`,
        };
      }
      continue;
    }

    for (let i = 0; i <= corte; i += 1) {
      const { index, m } = elegibles[i];
      consumidos.add(m.movementId);
      result[index] = {
        ...m,
        classification: "ABSORBED" as const,
        reason: `El wallet absorbió estos puntos al re-materializarse desde el espejo legacy (salto de ${event.amount} puntos sin transacción); reacreditarlos los duplicaría`,
      };
    }
  }

  return result;
}

/**
 * Momento en que el wallet dio un salto de saldo que ninguna transacción
 * explica. Ocurre cuando el motor re-materializa `availablePoints` desde
 * `usuariosApp.puntosActuales`: los puntos POS que hubiera en el espejo entran
 * al wallet sin dejar fila en el ledger. Reacreditarlos los duplicaría.
 */
export interface LedgerAbsorptionEvent {
  atMs: number;
  amount: number;
}

export function detectAbsorptionEvents(
  txns: Array<{ balanceBefore: number; balanceAfter: number; createdAtMs: number | null }>,
): LedgerAbsorptionEvent[] {
  const ordered = txns
    .filter((t) => t.createdAtMs !== null)
    .sort((a, b) => (a.createdAtMs ?? 0) - (b.createdAtMs ?? 0));

  const events: LedgerAbsorptionEvent[] = [];
  let esperado = 0;
  for (const txn of ordered) {
    const salto = txn.balanceBefore - esperado;
    if (salto > 0) {
      events.push({ atMs: txn.createdAtMs as number, amount: salto });
    }
    esperado = txn.balanceAfter;
  }
  return events;
}

async function loadMemberLedger(
  db: FirebaseFirestore.Firestore,
  memberId: string,
): Promise<{
  firstLedgerTxnAtMs: number | null;
  count: number;
  externalIds: Map<string, string>;
  saleIds: Map<string, string>;
  absorptionEvents: LedgerAbsorptionEvent[];
}> {
  const snap = await db
    .collection(LOYALTY_COLLECTIONS.TRANSACTIONS)
    .where("memberId", "==", memberId)
    .get();

  const externalIds = new Map<string, string>();
  const saleIds = new Map<string, string>();
  const chain: Array<{
    balanceBefore: number;
    balanceAfter: number;
    createdAtMs: number | null;
  }> = [];
  let firstLedgerTxnAtMs: number | null = null;

  for (const doc of snap.docs) {
    const txn = doc.data() as LoyaltyTransaction;
    const createdAtMs = toMillis(txn.createdAt);
    if (
      createdAtMs !== null &&
      (firstLedgerTxnAtMs === null || createdAtMs < firstLedgerTxnAtMs)
    ) {
      firstLedgerTxnAtMs = createdAtMs;
    }
    if (txn.externalTransactionId) {
      externalIds.set(txn.externalTransactionId, doc.id);
    }
    // Red de seguridad: si la venta ya se acreditó bajo otro namespace
    // (`staff-sale:...`, folio suelto) tampoco debe volver a acreditarse.
    const saleId = txn.metadata?.saleId;
    if (typeof saleId === "string" && saleId.trim()) {
      saleIds.set(saleId.trim(), doc.id);
    }
    chain.push({
      balanceBefore: Number(txn.balanceBefore ?? 0),
      balanceAfter: Number(txn.balanceAfter ?? 0),
      createdAtMs,
    });
  }

  return {
    firstLedgerTxnAtMs,
    count: snap.size,
    externalIds,
    saleIds,
    absorptionEvents: detectAbsorptionEvents(chain),
  };
}

export async function analyze(
  db: FirebaseFirestore.Firestore,
  options: { limit?: number; member?: string } = {},
): Promise<{ usuarios: UserRepairReport[]; invalid: PosMovementRecord[] }> {
  const { movements, invalid } = await collectPosMovements(db, options);

  const byMember = new Map<string, PosMovementRecord[]>();
  const seenVenta = new Map<string, number>();
  for (const movement of movements) {
    const list = byMember.get(movement.memberId) ?? [];
    list.push(movement);
    byMember.set(movement.memberId, list);
    const key = `${movement.memberId}:${movement.ventaId}`;
    seenVenta.set(key, (seenVenta.get(key) ?? 0) + 1);
  }

  const usuarios: UserRepairReport[] = [];

  for (const [memberId, memberMovements] of byMember) {
    const inconsistencias: string[] = [];

    const [userSnap, walletSnap, ledger] = await Promise.all([
      db.collection(USUARIOS).doc(memberId).get(),
      db.collection(LOYALTY_COLLECTIONS.WALLETS).doc(memberId).get(),
      loadMemberLedger(db, memberId),
    ]);

    const userData = (userSnap.data() ?? {}) as Record<string, unknown>;
    const wallet = walletSnap.exists
      ? (walletSnap.data() as LoyaltyWallet)
      : null;

    if (!userSnap.exists) {
      inconsistencias.push("El socio no existe en usuariosApp");
    }
    if (!walletSnap.exists && ledger.count > 0) {
      inconsistencias.push(
        "Tiene transacciones en el ledger pero no tiene documento loyalty_wallets",
      );
    }

    const classified = classifyMemberMovements({
      memberId,
      movements: memberMovements,
      walletExists: walletSnap.exists,
      firstLedgerTxnAtMs: ledger.firstLedgerTxnAtMs,
      ledgerExternalIds: ledger.externalIds,
      ledgerSaleIds: ledger.saleIds,
      absorptionEvents: ledger.absorptionEvents,
    });

    for (const movement of memberMovements) {
      if ((seenVenta.get(`${memberId}:${movement.ventaId}`) ?? 0) > 1) {
        inconsistencias.push(
          `ventaId duplicado en movimientos POS: ${movement.ventaId}`,
        );
      }
    }

    const faltantes = classified.filter((m) => m.classification === "MISSING");
    const absorbidos = classified.filter(
      (m) => m.classification === "ABSORBED" || m.classification === "NO_WALLET_YET",
    );
    const enLedger = classified.filter((m) => m.classification === "IN_LEDGER");

    const puntosPosFaltantes = faltantes.reduce((sum, m) => sum + m.puntos, 0);
    const puntosPosAbsorbidos = absorbidos.reduce((sum, m) => sum + m.puntos, 0);

    const puntosActuales = userSnap.exists
      ? Math.trunc(Number(userData.puntosActuales ?? 0))
      : null;
    const saldoOficialActual = wallet ? wallet.availablePoints : null;

    const espejoDesincronizado =
      wallet !== null &&
      puntosActuales !== null &&
      puntosActuales !== wallet.availablePoints;

    // El espejo por encima del wallet es la firma del incidente, no una
    // ambigüedad: son puntos POS que todavía se ven pero aún no entraron al
    // saldo oficial. Solo avisamos cuando el wallet va por delante, que sí
    // sería un caso raro que merece revisión manual.
    if (wallet && puntosActuales !== null && puntosActuales < wallet.availablePoints) {
      inconsistencias.push(
        `El wallet supera al espejo legacy (wallet=${wallet.availablePoints} vs puntosActuales=${puntosActuales}); revisar manualmente`,
      );
    }

    const impacto: UserImpact =
      faltantes.length === 0
        ? "SIN_IMPACTO"
        : espejoDesincronizado
          ? "EN_RIESGO"
          : "PUNTOS_PERDIDOS";

    usuarios.push({
      uid: memberId,
      impacto,
      email:
        typeof userData.email === "string" ? userData.email : undefined,
      telefono:
        typeof userData.telefono === "string"
          ? userData.telefono
          : typeof userData.phone === "string"
            ? userData.phone
            : undefined,
      nombre:
        typeof userData.nombre === "string" ? userData.nombre : undefined,
      usuariosAppPuntosActuales: puntosActuales,
      walletAvailablePoints: saldoOficialActual,
      walletExists: walletSnap.exists,
      firstLedgerTxnAtMs: ledger.firstLedgerTxnAtMs,
      ledgerTransactionCount: ledger.count,
      posMovimientos: classified.length,
      posYaEnLedger: enLedger.length,
      posAbsorbidos: absorbidos.length,
      posFaltantes: faltantes.length,
      puntosPosFaltantes,
      puntosPosAbsorbidos,
      ventaIdsFaltantes: faltantes.map((m) => m.ventaId),
      ventaIdsAbsorbidos: absorbidos.map((m) => m.ventaId),
      saldoOficialActual,
      saldoEsperadoTrasImportar:
        saldoOficialActual === null
          ? null
          : saldoOficialActual + puntosPosFaltantes,
      inconsistencias,
      movimientos: classified,
    });
  }

  usuarios.sort((a, b) => b.puntosPosFaltantes - a.puntosPosFaltantes);
  return { usuarios, invalid };
}

/**
 * Crea la transacción oficial que faltaba, mueve el wallet y sincroniza el
 * espejo legacy, todo en una transacción de Firestore.
 *
 * Idempotente por doble candado: el índice externo se crea con `create()` (si
 * ya existe, la transacción falla y se reporta ALREADY_PROCESSED) y además se
 * relee dentro de la transacción. Interrumpir y reejecutar no duplica puntos.
 */
export async function applyMovementRepair(
  db: FirebaseFirestore.Firestore,
  movement: ClassifiedMovement,
): Promise<
  | { status: "APPLIED"; transactionId: string; points: number }
  | { status: "ALREADY_PROCESSED" }
  | { status: "SKIPPED"; reason: string }
> {
  const extKey = conversionRulesService.buildExternalTxnKey(
    POS_SALE_CHANNEL,
    movement.externalTransactionId,
  );
  const extRef = db
    .collection(LOYALTY_COLLECTIONS.EXTERNAL_TXN_INDEX)
    .doc(extKey);
  const walletRef = db
    .collection(LOYALTY_COLLECTIONS.WALLETS)
    .doc(movement.memberId);
  const userRef = db.collection(USUARIOS).doc(movement.memberId);
  const txnRef = db.collection(LOYALTY_COLLECTIONS.TRANSACTIONS).doc();

  return db.runTransaction(async (tx) => {
    const [extSnap, walletSnap, userSnap] = await Promise.all([
      tx.get(extRef),
      tx.get(walletRef),
      tx.get(userRef),
    ]);

    if (extSnap.exists) {
      return { status: "ALREADY_PROCESSED" as const };
    }
    if (!userSnap.exists) {
      return {
        status: "SKIPPED" as const,
        reason: "El socio ya no existe en usuariosApp",
      };
    }
    if (!walletSnap.exists) {
      // Sin wallet los puntos POS siguen dentro de puntosActuales y el wallet
      // los absorberá al crearse. Acreditar aquí los duplicaría.
      return {
        status: "SKIPPED" as const,
        reason: "El socio no tiene wallet; sus puntos POS siguen en el saldo legacy",
      };
    }

    const wallet = walletSnap.data() as LoyaltyWallet;
    const balanceBefore = wallet.availablePoints;
    const balanceAfter = balanceBefore + movement.puntos;
    const level = conversionRulesService.calculateLevel(balanceAfter);
    const now = Timestamp.now();

    tx.set(
      walletRef,
      {
        ...wallet,
        availablePoints: balanceAfter,
        lifetimeEarnedPoints:
          (wallet.lifetimeEarnedPoints ?? 0) + movement.puntos,
        level,
        updatedAt: now,
      },
      { merge: true },
    );

    tx.set(txnRef, {
      transactionId: txnRef.id,
      memberId: movement.memberId,
      actorId: "pos-ledger-repair",
      actorType: LoyaltyActorType.SERVICE,
      type: LoyaltyTransactionType.EARN,
      status: LoyaltyTransactionStatus.CONFIRMED,
      points: movement.puntos,
      balanceBefore,
      balanceAfter,
      channel: POS_SALE_CHANNEL,
      currency: "MXN",
      externalTransactionId: movement.externalTransactionId,
      description:
        movement.descripcion ?? `Venta POS ${movement.ventaId} (reparación)`,
      reasonCode: "POS_LEDGER_REPAIR",
      // FASE 12: trazabilidad de la reparación sin romper el schema existente.
      metadata: {
        source: "POS",
        repair: true,
        originalMovementId: movement.movementId,
        ventaId: movement.ventaId,
        saleId: movement.ventaId,
        repairedAt: now.toDate().toISOString(),
        repairScript: REPAIR_SCRIPT_VERSION,
        repairVersion: REPAIR_SCRIPT_VERSION,
        repairBatchId: REPAIR_BATCH_ID,
      },
      createdAt: now,
    });

    // Espejo legacy: derivado del wallet, nunca fuente independiente.
    tx.set(
      userRef,
      { puntosActuales: balanceAfter, nivel: level, updatedAt: now },
      { merge: true },
    );

    // `create` para que dos ejecuciones concurrentes no puedan acreditar dos veces.
    tx.create(extRef, {
      transactionId: txnRef.id,
      memberId: movement.memberId,
      channel: POS_SALE_CHANNEL,
    });

    return {
      status: "APPLIED" as const,
      transactionId: txnRef.id,
      points: movement.puntos,
    };
  });
}

function buildSummary(
  usuarios: UserRepairReport[],
  invalid: PosMovementRecord[],
  mode: "dry-run" | "apply",
): RepairSummary {
  const casosAmbiguos: RepairSummary["casosAmbiguos"] = [];
  let movimientosYaEnLedger = 0;
  let movimientosAbsorbidos = 0;
  let movimientosFaltantes = 0;
  let puntosTotalesARestaurar = 0;
  let puntosAbsorbidosSinLedger = 0;
  let duplicadosDetectados = 0;
  let usuariosNoEncontrados = 0;
  let usuariosAfectados = 0;
  let usuariosPotencialmenteAfectados = 0;
  let puntosYaPerdidos = 0;
  let puntosEnRiesgo = 0;

  for (const user of usuarios) {
    movimientosYaEnLedger += user.posYaEnLedger;
    movimientosAbsorbidos += user.posAbsorbidos;
    movimientosFaltantes += user.posFaltantes;
    puntosTotalesARestaurar += user.puntosPosFaltantes;
    puntosAbsorbidosSinLedger += user.puntosPosAbsorbidos;

    if (user.usuariosAppPuntosActuales === null) usuariosNoEncontrados += 1;
    if (user.impacto === "PUNTOS_PERDIDOS") {
      usuariosAfectados += 1;
      puntosYaPerdidos += user.puntosPosFaltantes;
    } else if (user.impacto === "EN_RIESGO") {
      usuariosPotencialmenteAfectados += 1;
      puntosEnRiesgo += user.puntosPosFaltantes;
    }

    for (const inconsistencia of user.inconsistencias) {
      if (inconsistencia.startsWith("ventaId duplicado")) duplicadosDetectados += 1;
      casosAmbiguos.push({ uid: user.uid, motivo: inconsistencia });
    }
    for (const movement of user.movimientos) {
      if (movement.classification === "INVALID") {
        casosAmbiguos.push({
          uid: user.uid,
          ventaId: movement.ventaId,
          motivo: movement.reason,
        });
      }
    }
  }

  return {
    script: REPAIR_SCRIPT_VERSION,
    mode,
    generatedAt: new Date().toISOString(),
    usuariosAnalizados: usuarios.length,
    usuariosConMovimientosPos: usuarios.length,
    usuariosAfectados,
    puntosYaPerdidos,
    usuariosPotencialmenteAfectados,
    puntosEnRiesgo,
    totalMovimientosPosAnalizados:
      movimientosYaEnLedger + movimientosAbsorbidos + movimientosFaltantes,
    movimientosYaEnLedger,
    movimientosAbsorbidos,
    movimientosFaltantes,
    movimientosInvalidos: invalid.length,
    puntosTotalesARestaurar,
    puntosAbsorbidosSinLedger,
    duplicadosDetectados,
    usuariosNoEncontrados,
    ventasNoEncontradas: 0,
    casosAmbiguos,
  };
}

function writeReports(result: RepairResult, outBase: string): void {
  const dir = path.dirname(outBase);
  fs.mkdirSync(dir, { recursive: true });

  fs.writeFileSync(`${outBase}.json`, JSON.stringify(result, null, 2));

  const header = [
    "uid",
    "impacto",
    "email",
    "telefono",
    "puntosActuales",
    "walletAvailablePoints",
    "movimientosPos",
    "yaEnLedger",
    "absorbidos",
    "faltantes",
    "puntosFaltantes",
    "saldoOficialActual",
    "saldoEsperadoTrasImportar",
    "ventaIdsFaltantes",
    "inconsistencias",
  ].join(",");

  const escape = (value: unknown): string => {
    const text = value === null || value === undefined ? "" : String(value);
    return `"${text.replace(/"/g, '""')}"`;
  };

  const rows = result.usuarios.map((u) =>
    [
      u.uid,
      u.impacto,
      u.email ?? "",
      u.telefono ?? "",
      u.usuariosAppPuntosActuales,
      u.walletAvailablePoints,
      u.posMovimientos,
      u.posYaEnLedger,
      u.posAbsorbidos,
      u.posFaltantes,
      u.puntosPosFaltantes,
      u.saldoOficialActual,
      u.saldoEsperadoTrasImportar,
      u.ventaIdsFaltantes.join(" | "),
      u.inconsistencias.join(" | "),
    ]
      .map(escape)
      .join(","),
  );

  fs.writeFileSync(`${outBase}.csv`, [header, ...rows].join("\n"));
}

function parseOptions(argv: string[]): Options {
  const get = (name: string): string | undefined =>
    argv.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
  const limit = get("limit");
  return {
    apply: argv.includes("--apply"),
    limit: limit ? Number(limit) : undefined,
    member: get("member"),
    out:
      get("out") ??
      path.resolve(__dirname, "../../../../reports/pos-ledger-repair"),
  };
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const options = parseOptions(argv);
  const mode = options.apply ? "apply" : "dry-run";

  console.log(`\n=== ${REPAIR_SCRIPT_VERSION} | modo: ${mode.toUpperCase()} ===`);
  if (!options.apply) {
    console.log("DRY-RUN: no se escribe absolutamente nada.\n");
  }

  const { usuarios, invalid } = await analyze(firestoreApp, {
    limit: options.limit,
    member: options.member,
  });
  const summary = buildSummary(usuarios, invalid, mode);

  if (options.apply) {
    const aplicados = {
      transaccionesCreadas: 0,
      puntosAcreditados: 0,
      yaProcesadas: 0,
      errores: [] as Array<{ uid: string; ventaId: string; error: string }>,
    };

    for (const user of usuarios) {
      for (const movement of user.movimientos) {
        if (movement.classification !== "MISSING") continue;
        try {
          const outcome = await applyMovementRepair(firestoreApp, movement);
          if (outcome.status === "APPLIED") {
            aplicados.transaccionesCreadas += 1;
            aplicados.puntosAcreditados += outcome.points;
            console.log(
              `  + ${user.uid} ${movement.ventaId} => +${outcome.points} pts (${outcome.transactionId})`,
            );
          } else if (outcome.status === "ALREADY_PROCESSED") {
            aplicados.yaProcesadas += 1;
          } else {
            aplicados.errores.push({
              uid: user.uid,
              ventaId: movement.ventaId,
              error: outcome.reason,
            });
          }
        } catch (error) {
          aplicados.errores.push({
            uid: user.uid,
            ventaId: movement.ventaId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
    summary.aplicados = aplicados;
  }

  writeReports({ summary, usuarios }, options.out);

  console.log("\n--- RESUMEN ---");
  console.log(JSON.stringify({ ...summary, casosAmbiguos: undefined }, null, 2));
  console.log(`\ncasos ambiguos: ${summary.casosAmbiguos.length}`);
  console.log(`reporte JSON: ${options.out}.json`);
  console.log(`reporte CSV : ${options.out}.csv`);
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error("Fallo la reparación:", error);
      process.exit(1);
    });
}
