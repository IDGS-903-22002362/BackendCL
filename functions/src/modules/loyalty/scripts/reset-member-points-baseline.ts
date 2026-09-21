/**
 * Reset del saldo de puntos de UN SOLO socio a un valor base.
 *
 * Contexto
 * --------
 * Cuando un socio acumula movimientos por un uso indebido del sistema hace
 * falta devolverlo a su saldo base sin inventar puntos ni borrar el rastro de
 * lo que pasó. El saldo vive en `loyalty_wallets.availablePoints` y el espejo
 * legacy `usuariosApp.puntosActuales` lo escribe únicamente el motor: tocarlo
 * a mano es justo lo que provocó el incidente POS. Por eso el ajuste va por
 * `loyaltyEngineService.applyAdjustment`, igual que el endpoint admin
 * `POST /admin/adjustments`.
 *
 * Qué hace
 * --------
 *  1. Resuelve el socio por email y exige coincidencia exacta entre Firebase
 *     Auth y `usuariosApp`. Cualquier ambigüedad aborta sin escribir.
 *  2. Cancela los canjes PENDING para devolver `heldPoints` al saldo por el
 *     ledger (asiento REDEMPTION_RELEASE), en lugar de borrarlos a mano.
 *  3. Aplica un ADJUSTMENT por la diferencia hasta el objetivo. El historial
 *     previo se conserva y queda un asiento que documenta la corrección.
 *  4. Normaliza los contadores del wallet y reconstruye el resumen del ciclo
 *     anual vigente, preservando `ultimoCicloProcesado` para no reprocesar
 *     ciclos de expiración pasados.
 *  5. Verifica el estado final y falla si no cuadra.
 *
 * Alcance: todas las escrituras se hacen contra el uid resuelto. No hay
 * recorridos de colección ni lotes; ningún otro socio se toca.
 *
 * Uso
 * ---
 *   npm run build
 *   node lib/modules/loyalty/scripts/reset-member-points-baseline.js \
 *     --email=alguien@correo.com                  # dry-run
 *   node lib/modules/loyalty/scripts/reset-member-points-baseline.js \
 *     --email=alguien@correo.com --apply          # aplica
 *
 * Se invoca con node y no con `npm run reset:member-points -- ...` porque npm
 * descarta los argumentos que van tras `--` (los interpreta como config propia)
 * y el script se quedaría sin email. Por eso también se aceptan los alias
 * `--member-email` y `--out`, que sobreviven en instalaciones de npm donde el
 * reenvío sí funciona.
 *
 * Opciones: --target=40  --actor-uid=<uid>  --out=<ruta.json>
 */
import * as fs from "fs";
import * as path from "path";
import { Timestamp } from "firebase-admin/firestore";
import { authAppOficial, firestoreApp } from "../../../config/app.firebase";
import { HistorialPuntosUsuario } from "../../../models/usuario.model";
import {
  construirResumenPuntosAnual,
  obtenerCicloActual,
} from "../../../services/puntos-expiracion.utils";
import { LOYALTY_COLLECTIONS } from "../constants/loyalty.constants";
import {
  LoyaltyActorType,
  LoyaltyAdjustmentReason,
  LoyaltyRedemptionStatus,
} from "../models/loyalty.enums";
import {
  LoyaltyActorContext,
  LoyaltyRedemption,
  LoyaltyWallet,
} from "../models/loyalty.types";
import walletRepository from "../repositories/wallet.repository";
import conversionRulesService from "../services/conversion-rules.service";
import loyaltyEngineService from "../services/loyalty-engine.service";

export const SCRIPT_VERSION = "reset-member-points-baseline@1.0.0";

const USUARIOS = "usuariosApp";
const HISTORIAL_ANUAL = "historial_puntos_anual";
const DEFAULT_TARGET = 40;
/** Cotas de sanidad: este script corrige saldos, no reparte premios. */
const MAX_TARGET = 100_000;
/** Vueltas máximas para converger al objetivo si la expiración mueve el saldo. */
const MAX_PASSES = 3;

interface Options {
  email: string;
  target: number;
  actorUid?: string;
  apply: boolean;
  report?: string;
}

interface MemberSnapshot {
  uid: string;
  email: string;
  nombre?: string;
  rol?: string;
  puntosActuales: number | null;
  nivel?: string;
  wallet: LoyaltyWallet | null;
  ledgerTransactions: number;
  legacyMovements: number;
  pendingRedemptions: Array<{ redemptionId: string; points: number }>;
  mirrorDrift: number | null;
}

interface AppliedStep {
  step: string;
  detail: string;
}

class AbortError extends Error {}

function parseOptions(argv: string[]): Options {
  const get = (...names: string[]): string | undefined => {
    for (const name of names) {
      const found = argv.find((a) => a.startsWith(`--${name}=`));
      if (found) return found.split("=").slice(1).join("=");
    }
    return undefined;
  };

  // `email` y `report` son configs de npm y no sobreviven a `npm run -- ...`,
  // así que los nombres canónicos son `member-email` y `out`. Los alias siguen
  // funcionando al invocar el script directamente con node.
  const email = (get("member-email", "email") ?? "").trim().toLowerCase();
  if (!email) {
    throw new AbortError(
      "Falta --member-email=<correo>. Este script solo opera sobre un socio a la vez.",
    );
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new AbortError(`El email "${email}" no tiene un formato válido.`);
  }

  const rawTarget = get("target");
  const target = rawTarget === undefined ? DEFAULT_TARGET : Number(rawTarget);
  if (!Number.isInteger(target) || target < 0 || target > MAX_TARGET) {
    throw new AbortError(
      `--target debe ser un entero entre 0 y ${MAX_TARGET} (recibido: ${rawTarget}).`,
    );
  }

  return {
    email,
    target,
    actorUid: get("actor-uid")?.trim() || undefined,
    apply: argv.includes("--apply"),
    report: get("out", "report"),
  };
}

/**
 * Resuelve el uid exigiendo que Auth y Firestore coincidan. Si el email
 * aparece 0 o 2+ veces, o el doc no es el uid de Auth, se aborta: es preferible
 * no hacer nada que ajustarle los puntos al socio equivocado.
 */
async function resolveMemberUid(email: string): Promise<string> {
  let authUid: string;
  try {
    const authUser = await authAppOficial.getUserByEmail(email);
    authUid = authUser.uid;
  } catch (error) {
    // Solo `user-not-found` significa que el socio no existe. Cualquier otro
    // fallo (credenciales, red, TLS) se propaga tal cual: reportarlo como
    // "no existe" haría creer que el email está mal cuando el problema es
    // que no pudimos preguntar.
    const code = (error as { code?: string }).code;
    if (code === "auth/user-not-found") {
      throw new AbortError(
        `No existe usuario en Firebase Auth con el email ${email}.`,
      );
    }
    throw error;
  }

  const snap = await firestoreApp
    .collection(USUARIOS)
    .where("email", "==", email)
    .get();

  if (snap.empty) {
    throw new AbortError(
      `El email ${email} existe en Auth (uid ${authUid}) pero no tiene documento en ${USUARIOS}.`,
    );
  }
  if (snap.size > 1) {
    throw new AbortError(
      `El email ${email} aparece en ${snap.size} documentos de ${USUARIOS} (${snap.docs
        .map((d) => d.id)
        .join(", ")}). Resolver el duplicado antes de ajustar puntos.`,
    );
  }

  const doc = snap.docs[0];
  if (doc.id !== authUid) {
    throw new AbortError(
      `Discrepancia de identidad: Auth dice uid ${authUid} pero ${USUARIOS} tiene el documento ${doc.id}. No se ajusta nada.`,
    );
  }

  return authUid;
}

async function listPendingRedemptions(
  uid: string,
): Promise<LoyaltyRedemption[]> {
  // Filtro de estado en memoria para no depender de un índice compuesto.
  const snap = await firestoreApp
    .collection(LOYALTY_COLLECTIONS.REDEMPTIONS)
    .where("memberId", "==", uid)
    .get();

  return snap.docs
    .map((doc) => ({
      ...(doc.data() as LoyaltyRedemption),
      redemptionId: doc.id,
    }))
    .filter(
      (redemption) => redemption.status === LoyaltyRedemptionStatus.PENDING,
    );
}

async function buildSnapshot(uid: string): Promise<MemberSnapshot> {
  const [userSnap, wallet, ledgerSnap, movimientosSnap, pending] =
    await Promise.all([
      firestoreApp.collection(USUARIOS).doc(uid).get(),
      walletRepository.getWalletDoc(uid),
      firestoreApp
        .collection(LOYALTY_COLLECTIONS.TRANSACTIONS)
        .where("memberId", "==", uid)
        .count()
        .get(),
      firestoreApp
        .collection(USUARIOS)
        .doc(uid)
        .collection("movimientos_puntos")
        .count()
        .get(),
      listPendingRedemptions(uid),
    ]);

  const userData = (userSnap.data() ?? {}) as Record<string, unknown>;
  const puntosActuales = userSnap.exists
    ? Math.trunc(Number(userData.puntosActuales ?? 0))
    : null;

  return {
    uid,
    email: String(userData.email ?? ""),
    nombre: typeof userData.nombre === "string" ? userData.nombre : undefined,
    rol: typeof userData.rol === "string" ? userData.rol : undefined,
    puntosActuales,
    nivel: typeof userData.nivel === "string" ? userData.nivel : undefined,
    wallet,
    ledgerTransactions: ledgerSnap.data().count,
    legacyMovements: movimientosSnap.data().count,
    pendingRedemptions: pending.map((r) => ({
      redemptionId: r.redemptionId,
      points: r.points,
    })),
    mirrorDrift:
      wallet && puntosActuales !== null
        ? puntosActuales - wallet.availablePoints
        : null,
  };
}

function buildActor(uid: string, actorUid?: string): LoyaltyActorContext {
  // Por defecto el actor es el propio socio: `applyAdjustment` fuerza
  // `legacyOrigen: "admin"`, y el motor copia el movimiento en
  // `usuariosApp/{actorId}/asignaciones_hechas`. Usando el uid del socio esa
  // copia de auditoría queda dentro de su propio documento y no se escribe
  // nada fuera de él. Con --actor-uid se puede atribuir a un admin real.
  return {
    actorType: actorUid ? LoyaltyActorType.ADMIN : LoyaltyActorType.SERVICE,
    actorId: actorUid ?? uid,
    roles: actorUid ? ["ADMIN"] : ["SERVICE"],
    permissions: [],
  };
}

/**
 * Reconstruye el resumen del ciclo anual vigente para que la contabilidad de
 * expiración arranque desde el saldo base. `ultimoCicloProcesado` se preserva
 * y los resúmenes de ciclos anteriores se dejan intactos: sobrescribirlos
 * haría que el job de expiración reprocesara ciclos ya cerrados.
 */
async function rebuildCurrentCycleSummary(
  uid: string,
  target: number,
): Promise<AppliedStep> {
  const dias = await walletRepository.getExpirationDays();
  const userRef = firestoreApp.collection(USUARIOS).doc(uid);
  const userSnap = await userRef.get();
  const userData = (userSnap.data() ?? {}) as Record<string, unknown>;
  const createdAt = userData.createdAt as Timestamp | undefined;

  if (!createdAt || typeof createdAt.toDate !== "function") {
    return {
      step: "cycle-summary",
      detail:
        "Omitido: el socio no tiene createdAt válido, no se puede ubicar el ciclo vigente.",
    };
  }

  const ciclo = obtenerCicloActual(createdAt.toDate(), new Date(), dias);
  const resumen = construirResumenPuntosAnual(ciclo, target);
  const historialPrevio = userData.historialPuntos as
    | HistorialPuntosUsuario
    | undefined;

  const historial: HistorialPuntosUsuario = {
    ultimoCicloProcesado: Number(historialPrevio?.ultimoCicloProcesado ?? 0),
    cicloActual: ciclo.numero,
    proximaExpiracionProgramada: ciclo.fechaFinProgramada,
    resumenes: {
      ...(historialPrevio?.resumenes ?? {}),
      [ciclo.etiqueta]: resumen,
    },
  };

  await userRef.collection(HISTORIAL_ANUAL).doc(ciclo.etiqueta).set(resumen);
  await userRef.set({ historialPuntos: historial }, { merge: true });

  return {
    step: "cycle-summary",
    detail: `Ciclo ${ciclo.etiqueta} reconstruido con saldo base ${target}; ultimoCicloProcesado=${historial.ultimoCicloProcesado} preservado.`,
  };
}

/**
 * Fija los contadores acumulados del wallet. No toca `availablePoints`, por lo
 * que no puede introducir drift con el espejo legacy.
 */
async function normalizeWalletCounters(
  uid: string,
  target: number,
): Promise<AppliedStep> {
  const userSnap = await firestoreApp.collection(USUARIOS).doc(uid).get();
  const historial = (userSnap.data() ?? {}).historialPuntos as
    | HistorialPuntosUsuario
    | undefined;

  const patch: Partial<LoyaltyWallet> = {
    heldPoints: 0,
    pendingPoints: 0,
    lifetimeEarnedPoints: target,
    lifetimeRedeemedPoints: 0,
    level: conversionRulesService.calculateLevel(target),
    updatedAt: Timestamp.now(),
  };
  if (historial?.proximaExpiracionProgramada) {
    patch.nextExpirationAt = historial.proximaExpiracionProgramada;
  }

  await firestoreApp
    .collection(LOYALTY_COLLECTIONS.WALLETS)
    .doc(uid)
    .set(patch, { merge: true });

  return {
    step: "wallet-counters",
    detail: `lifetimeEarnedPoints=${target}, lifetimeRedeemedPoints=0, heldPoints=0, pendingPoints=0, level=${patch.level}.`,
  };
}

async function cancelPendingRedemptions(
  uid: string,
  redemptions: Array<{ redemptionId: string; points: number }>,
  actor: LoyaltyActorContext,
): Promise<AppliedStep[]> {
  const steps: AppliedStep[] = [];
  for (const redemption of redemptions) {
    await loyaltyEngineService.cancelRedemption(
      redemption.redemptionId,
      actor,
      `baseline-reset:${redemption.redemptionId}`,
    );
    steps.push({
      step: "redemption-cancel",
      detail: `Canje ${redemption.redemptionId} cancelado; ${redemption.points} pts retenidos devueltos al saldo.`,
    });
  }
  return steps;
}

/**
 * Lleva `availablePoints` al objetivo. Vuelve a leer el wallet antes de cada
 * pasada porque el motor procesa la expiración pendiente al inicio de cada
 * mutación y eso puede mover el saldo bajo nuestros pies.
 */
async function convergeToTarget(
  uid: string,
  target: number,
  actor: LoyaltyActorContext,
): Promise<AppliedStep[]> {
  const steps: AppliedStep[] = [];

  for (let pass = 1; pass <= MAX_PASSES; pass += 1) {
    const wallet = await walletRepository.getOrSyncWallet(uid);
    const delta = target - wallet.availablePoints;

    if (delta === 0) {
      if (pass === 1) {
        steps.push({
          step: "adjustment",
          detail: `El saldo ya estaba en ${target}; no se generó ajuste.`,
        });
      }
      return steps;
    }

    const transaction = await loyaltyEngineService.applyAdjustment({
      memberId: uid,
      points: delta,
      reasonCode: LoyaltyAdjustmentReason.SYSTEM_CORRECTION,
      description: `Reset de saldo base a ${target} puntos por corrección operativa`,
      externalReference: `baseline-reset:${uid}`,
      // El delta forma parte de la clave para que un reintento con otro saldo
      // de partida no choque con el hash de la petición anterior.
      idempotencyKey: `baseline-reset:${uid}:${target}:${delta}`,
      actor,
    });

    steps.push({
      step: "adjustment",
      detail: `Ajuste ${delta > 0 ? "+" : ""}${delta} pts (${transaction.balanceBefore} -> ${transaction.balanceAfter}), txn ${transaction.transactionId}.`,
    });

    if (transaction.balanceAfter === target) {
      return steps;
    }
  }

  throw new Error(
    `No se pudo llevar el saldo a ${target} en ${MAX_PASSES} intentos; revisar el reporte antes de reintentar.`,
  );
}

/** Cierra el drift cuando el ajuste no corrió y el espejo no coincide. */
async function syncMirrorIfDrifted(
  uid: string,
  target: number,
): Promise<AppliedStep | null> {
  const userRef = firestoreApp.collection(USUARIOS).doc(uid);
  const userSnap = await userRef.get();
  const puntosActuales = Math.trunc(
    Number((userSnap.data() ?? {}).puntosActuales ?? 0),
  );
  if (puntosActuales === target) {
    return null;
  }

  const nivel = conversionRulesService.calculateLevel(target);
  await userRef.set(
    { puntosActuales: target, nivel, updatedAt: Timestamp.now() },
    { merge: true },
  );
  return {
    step: "mirror-sync",
    detail: `Espejo legacy corregido de ${puntosActuales} a ${target} (nivel ${nivel}).`,
  };
}

function describePlan(snapshot: MemberSnapshot, target: number): string[] {
  const lines: string[] = [];
  const available = snapshot.wallet?.availablePoints ?? null;

  if (!snapshot.wallet) {
    lines.push(
      `El socio no tiene wallet; se creará desde puntosActuales=${snapshot.puntosActuales} antes de ajustar.`,
    );
  }
  for (const redemption of snapshot.pendingRedemptions) {
    lines.push(
      `Cancelar canje PENDING ${redemption.redemptionId} y devolver ${redemption.points} pts retenidos al saldo.`,
    );
  }

  const puntoDePartida =
    (available ?? snapshot.puntosActuales ?? 0) +
    snapshot.pendingRedemptions.reduce((sum, r) => sum + r.points, 0);
  const delta = target - puntoDePartida;
  lines.push(
    delta === 0
      ? `El saldo ya quedaría en ${target}; no haría falta ajuste.`
      : `Aplicar ADJUSTMENT de ${delta > 0 ? "+" : ""}${delta} pts para pasar de ${puntoDePartida} a ${target}.`,
  );
  lines.push(
    `Normalizar wallet: lifetimeEarnedPoints=${target}, lifetimeRedeemedPoints=0, heldPoints=0, pendingPoints=0, level=${conversionRulesService.calculateLevel(target)}.`,
  );
  lines.push("Reconstruir el resumen del ciclo anual vigente con el saldo base.");
  if (snapshot.mirrorDrift !== null && snapshot.mirrorDrift !== 0) {
    lines.push(
      `Nota: hoy hay drift de ${snapshot.mirrorDrift} pts entre puntosActuales y el wallet; quedará cerrado al terminar.`,
    );
  }
  return lines;
}

interface VerificationResult {
  ok: boolean;
  problems: string[];
  wallet: LoyaltyWallet | null;
  puntosActuales: number | null;
  nivel?: string;
}

async function verify(
  uid: string,
  target: number,
): Promise<VerificationResult> {
  const [wallet, userSnap] = await Promise.all([
    walletRepository.getWalletDoc(uid),
    firestoreApp.collection(USUARIOS).doc(uid).get(),
  ]);
  const userData = (userSnap.data() ?? {}) as Record<string, unknown>;
  const puntosActuales = userSnap.exists
    ? Math.trunc(Number(userData.puntosActuales ?? 0))
    : null;

  const problems: string[] = [];
  if (!wallet) {
    problems.push("El wallet no existe después de aplicar el reset.");
  } else {
    if (wallet.availablePoints !== target) {
      problems.push(
        `availablePoints=${wallet.availablePoints}, se esperaba ${target}.`,
      );
    }
    if (wallet.heldPoints !== 0) {
      problems.push(`heldPoints=${wallet.heldPoints}, se esperaba 0.`);
    }
    if (wallet.pendingPoints !== 0) {
      problems.push(`pendingPoints=${wallet.pendingPoints}, se esperaba 0.`);
    }
    if (wallet.lifetimeEarnedPoints !== target) {
      problems.push(
        `lifetimeEarnedPoints=${wallet.lifetimeEarnedPoints}, se esperaba ${target}.`,
      );
    }
    if (wallet.lifetimeRedeemedPoints !== 0) {
      problems.push(
        `lifetimeRedeemedPoints=${wallet.lifetimeRedeemedPoints}, se esperaba 0.`,
      );
    }
  }
  if (puntosActuales !== target) {
    problems.push(
      `usuariosApp.puntosActuales=${puntosActuales}, se esperaba ${target}.`,
    );
  }

  return {
    ok: problems.length === 0,
    problems,
    wallet,
    puntosActuales,
    nivel: typeof userData.nivel === "string" ? userData.nivel : undefined,
  };
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const options = parseOptions(argv);
  const mode = options.apply ? "apply" : "dry-run";

  console.log(`\n=== ${SCRIPT_VERSION} | modo: ${mode.toUpperCase()} ===`);
  console.log(`socio objetivo: ${options.email}`);
  console.log(`saldo objetivo: ${options.target} puntos`);
  if (!options.apply) {
    console.log("DRY-RUN: no se escribe absolutamente nada.");
  }

  const uid = await resolveMemberUid(options.email);
  console.log(`uid resuelto: ${uid}\n`);

  const before = await buildSnapshot(uid);
  console.log("--- ESTADO ANTES ---");
  console.log(JSON.stringify(before, null, 2));

  console.log("\n--- PLAN ---");
  for (const line of describePlan(before, options.target)) {
    console.log(`  - ${line}`);
  }

  const report: Record<string, unknown> = {
    script: SCRIPT_VERSION,
    mode,
    generatedAt: new Date().toISOString(),
    email: options.email,
    uid,
    target: options.target,
    before,
    plan: describePlan(before, options.target),
  };

  if (options.apply) {
    const actor = buildActor(uid, options.actorUid);
    const steps: AppliedStep[] = [];

    console.log("\n--- APLICANDO ---");
    steps.push(
      ...(await cancelPendingRedemptions(uid, before.pendingRedemptions, actor)),
    );
    steps.push(...(await convergeToTarget(uid, options.target, actor)));
    steps.push(await rebuildCurrentCycleSummary(uid, options.target));
    steps.push(await normalizeWalletCounters(uid, options.target));
    const mirrorStep = await syncMirrorIfDrifted(uid, options.target);
    if (mirrorStep) {
      steps.push(mirrorStep);
    }

    for (const step of steps) {
      console.log(`  [${step.step}] ${step.detail}`);
    }

    const verification = await verify(uid, options.target);
    const after = await buildSnapshot(uid);
    report.steps = steps;
    report.after = after;
    report.verification = verification;

    console.log("\n--- ESTADO DESPUÉS ---");
    console.log(JSON.stringify(after, null, 2));

    if (!verification.ok) {
      console.error("\nVERIFICACIÓN FALLIDA:");
      for (const problem of verification.problems) {
        console.error(`  - ${problem}`);
      }
      writeReport(report, options.report);
      process.exitCode = 1;
      return;
    }

    console.log(
      `\nVERIFICACIÓN OK: ${options.email} quedó en ${options.target} puntos, nivel ${verification.nivel ?? verification.wallet?.level}.`,
    );
  } else {
    console.log(
      "\nNada aplicado. Volver a correr con --apply para ejecutar el plan.",
    );
  }

  writeReport(report, options.report);
}

function writeReport(report: Record<string, unknown>, target?: string): void {
  if (!target) return;
  const resolved = path.resolve(target);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, JSON.stringify(report, null, 2), "utf8");
  console.log(`\nreporte: ${resolved}`);
}

if (require.main === module) {
  main()
    .then(() => process.exit(process.exitCode ?? 0))
    .catch((error) => {
      if (error instanceof AbortError) {
        console.error(`\nABORTADO: ${error.message}`);
      } else {
        console.error("\nFalló el reset de puntos:", error);
      }
      process.exit(1);
    });
}
