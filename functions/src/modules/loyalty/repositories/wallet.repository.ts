import { FieldValue, Transaction } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { firestoreApp } from "../../../config/app.firebase";
import { admin } from "../../../config/firebase.admin";
import { UsuarioApp } from "../../../models/usuario.model";
import pointsService from "../../../services/puntos.service";
import { LOYALTY_COLLECTIONS } from "../constants/loyalty.constants";
import { LoyaltyWallet, WalletResponseDto } from "../models/loyalty.types";
import conversionRulesService from "../services/conversion-rules.service";

const USUARIOS_COLLECTION = "usuariosApp";

export interface LegacyMirrorDrift {
  memberId: string;
  walletAvailablePoints: number;
  legacyAvailablePoints: number;
  /** Positivo: el espejo va adelantado. Negativo: el espejo va atrasado. */
  drift: number;
}

/**
 * `usuariosApp.puntosActuales` es solo un espejo: el motor lo escribe en la
 * misma transacción que el wallet, así que cualquier diferencia significa que
 * alguien escribió un saldo absoluto sin registrar la transacción en el ledger.
 *
 * Devuelve el desfase para poder alertarlo. NO se corrige adoptando el número
 * del espejo: un `max(espejo, wallet)` devolvería puntos legítimamente
 * canjeados cuando el espejo queda alto por un fallo de escritura. El saldo
 * solo puede cambiar creando transacciones reales en el ledger.
 */
export function detectLegacyMirrorDrift(
  wallet: LoyaltyWallet,
  legacyBalance: unknown,
): LegacyMirrorDrift | null {
  if (legacyBalance === undefined || legacyBalance === null) {
    return null;
  }
  const legacyAvailable = Math.trunc(Number(legacyBalance));
  if (!Number.isFinite(legacyAvailable)) {
    return null;
  }
  const drift = legacyAvailable - wallet.availablePoints;
  if (drift === 0) {
    return null;
  }
  return {
    memberId: wallet.memberId,
    walletAvailablePoints: wallet.availablePoints,
    legacyAvailablePoints: legacyAvailable,
    drift,
  };
}

/**
 * Alerta estructurada de desincronización. `unledgeredCredit` marca el caso
 * grave: puntos visibles para el socio que nunca entraron al ledger (típico del
 * fallback directo del POS). Se resuelve importando esas transacciones, no
 * tocando el saldo.
 */
export function reportLegacyMirrorDrift(
  drift: LegacyMirrorDrift | null,
  context: { source: string },
): void {
  if (!drift) return;
  logger.error("loyalty_legacy_mirror_drift", {
    ...drift,
    source: context.source,
    unledgeredCredit: drift.drift > 0,
  });
}

/**
 * Detecta escrituras al wallet hechas por fuera del motor comparando el saldo
 * materializado con el `balanceAfter` de la última transacción del ledger.
 */
export function reportWalletLedgerMismatch(
  wallet: LoyaltyWallet,
  context: { source: string },
): void {
  if (typeof wallet.ledgerBalanceAfter !== "number") {
    return;
  }
  if (wallet.ledgerBalanceAfter === wallet.availablePoints) {
    return;
  }
  logger.error("loyalty_wallet_ledger_mismatch", {
    memberId: wallet.memberId,
    availablePoints: wallet.availablePoints,
    ledgerBalanceAfter: wallet.ledgerBalanceAfter,
    lastTransactionId: wallet.lastTransactionId,
    source: context.source,
  });
}

export class WalletRepository {
  private get collection() {
    return firestoreApp.collection(LOYALTY_COLLECTIONS.WALLETS);
  }

  async ensureExpirationProcessed(memberId: string): Promise<void> {
    const wallet = await this.getWalletDoc(memberId);
    if (wallet) {
      const { default: loyaltyEngineService } = await import(
        "../services/loyalty-engine.service"
      );
      await loyaltyEngineService.processExpirationIfDue(memberId);
      return;
    }
    await pointsService.procesarExpiracionUsuario(
      memberId,
      await this.getExpirationDays(),
    );
  }

  async getExpirationDays(): Promise<number> {
    const configSnap = await firestoreApp
      .collection("configuracion")
      .doc("puntos")
      .get();
    const days = Number(configSnap.data()?.diasExpiracionPuntos);
    return Number.isFinite(days) && days > 0 ? days : 365;
  }

  async getWalletDoc(memberId: string): Promise<LoyaltyWallet | null> {
    const snap = await this.collection.doc(memberId).get();
    if (!snap.exists) return null;
    return snap.data() as LoyaltyWallet;
  }

  async getOrSyncWallet(memberId: string): Promise<LoyaltyWallet> {
    await this.ensureExpirationProcessed(memberId);
    const userRef = firestoreApp.collection(USUARIOS_COLLECTION).doc(memberId);
    const userSnap = await userRef.get();
    if (!userSnap.exists) {
      throw new Error("MEMBER_NOT_FOUND");
    }
    const userData = userSnap.data() as UsuarioApp;
    const walletSnap = await this.collection.doc(memberId).get();
    const now = admin.firestore.Timestamp.now();

    if (!walletSnap.exists) {
      const availableFromUser = Math.max(
        0,
        Math.trunc(Number(userData.puntosActuales ?? 0)),
      );
      const level = conversionRulesService.calculateLevel(availableFromUser);
      const wallet: LoyaltyWallet = {
        memberId,
        availablePoints: availableFromUser,
        heldPoints: 0,
        pendingPoints: 0,
        lifetimeEarnedPoints: availableFromUser,
        lifetimeRedeemedPoints: 0,
        level,
        nextExpirationAt: userData.historialPuntos?.proximaExpiracionProgramada,
        createdAt: now,
        updatedAt: now,
      };
      await this.collection.doc(memberId).set(wallet);
      return wallet;
    }

    const wallet = walletSnap.data() as LoyaltyWallet;
    reportLegacyMirrorDrift(
      detectLegacyMirrorDrift(wallet, userData.puntosActuales),
      { source: "getOrSyncWallet" },
    );
    reportWalletLedgerMismatch(wallet, { source: "getOrSyncWallet" });

    const level = conversionRulesService.calculateLevel(wallet.availablePoints);
    if (wallet.level !== level) {
      const updated: LoyaltyWallet = {
        ...wallet,
        level,
        nextExpirationAt:
          userData.historialPuntos?.proximaExpiracionProgramada ??
          wallet.nextExpirationAt,
        updatedAt: now,
      };
      await this.collection.doc(memberId).set(updated, { merge: true });
      return updated;
    }
    return wallet;
  }

  applyWalletDeltaInTx(
    tx: Transaction,
    memberId: string,
    wallet: LoyaltyWallet,
    delta: {
      availableDelta: number;
      heldDelta?: number;
      lifetimeEarnedDelta?: number;
      lifetimeRedeemedDelta?: number;
    },
  ): LoyaltyWallet {
    const availablePoints = wallet.availablePoints + delta.availableDelta;
    const heldPoints = wallet.heldPoints + (delta.heldDelta ?? 0);
    if (availablePoints < 0 || heldPoints < 0) {
      throw new Error("INSUFFICIENT_POINTS");
    }
    const updated: LoyaltyWallet = {
      ...wallet,
      availablePoints,
      heldPoints,
      lifetimeEarnedPoints:
        wallet.lifetimeEarnedPoints + (delta.lifetimeEarnedDelta ?? 0),
      lifetimeRedeemedPoints:
        wallet.lifetimeRedeemedPoints + (delta.lifetimeRedeemedDelta ?? 0),
      level: conversionRulesService.calculateLevel(availablePoints),
      updatedAt: admin.firestore.Timestamp.now(),
    };
    tx.set(this.collection.doc(memberId), updated, { merge: true });
    return updated;
  }

  /**
   * Deja en el wallet la huella de la transacción que produjo el saldo, para
   * poder detectar después escrituras hechas por fuera del ledger.
   */
  writeLedgerMirrorInTx(
    tx: Transaction,
    memberId: string,
    ledgerBalanceAfter: number,
    transactionId: string,
  ): void {
    tx.set(
      this.collection.doc(memberId),
      { ledgerBalanceAfter, lastTransactionId: transactionId },
      { merge: true },
    );
  }

  dualWriteLegacyBalanceInTx(
    tx: Transaction,
    memberId: string,
    availablePoints: number,
    level: string,
  ): void {
    tx.set(
      firestoreApp.collection(USUARIOS_COLLECTION).doc(memberId),
      {
        puntosActuales: availablePoints,
        nivel: level,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  }

  toResponseDto(wallet: LoyaltyWallet): WalletResponseDto {
    return {
      memberId: wallet.memberId,
      availablePoints: wallet.availablePoints,
      heldPoints: wallet.heldPoints,
      pendingPoints: wallet.pendingPoints,
      lifetimeEarnedPoints: wallet.lifetimeEarnedPoints,
      lifetimeRedeemedPoints: wallet.lifetimeRedeemedPoints,
      level: wallet.level,
      nextExpirationAt: wallet.nextExpirationAt?.toDate().toISOString(),
      upcomingExpirations: wallet.nextExpirationAt
        ? [
            {
              points: wallet.availablePoints,
              expiresAt: wallet.nextExpirationAt.toDate().toISOString(),
            },
          ]
        : [],
    };
  }
}

export const walletRepository = new WalletRepository();
export default walletRepository;
