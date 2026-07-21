import { Timestamp } from "firebase-admin/firestore";
import { firestoreApp } from "../../../config/app.firebase";
import { TipoMovimientoPuntos } from "../../../models/usuario.model";
import { LOYALTY_DEFAULTS, LOYALTY_COLLECTIONS } from "../constants/loyalty.constants";
import LoyaltyProblemError from "../errors/loyalty-problem.error";
import {
  LoyaltyActorType,
  LoyaltyChannel,
  LoyaltyRedemptionStatus,
  LoyaltyTransactionStatus,
  LoyaltyTransactionType,
} from "../models/loyalty.enums";
import {
  AdjustmentInput,
  EarnTransactionInput,
  LoyaltyRedemption,
  LoyaltyTransaction,
  LoyaltyWallet,
  RedemptionInput,
  ReversalInput,
} from "../models/loyalty.types";
import {
  externalTxnRepository,
  idempotencyRepository,
} from "../repositories/idempotency.repository";
import ledgerRepository from "../repositories/ledger.repository";
import redemptionRepository from "../repositories/redemption.repository";
import walletRepository from "../repositories/wallet.repository";
import conversionRulesService from "./conversion-rules.service";
import { requireLoyaltyWrites, loyaltyFeatureFlagsService } from "./loyalty-feature-flags.service";
import pointsService from "../../../services/puntos.service";
import { isCustomerOnlyAccount } from "../../../utils/usuario-roles";

const USUARIOS = "usuariosApp";
const MOVIMIENTOS = "movimientos_puntos";
const ASIGNACIONES = "asignaciones_hechas";

export class LoyaltyEngineService {
  async getWallet(memberId: string): Promise<LoyaltyWallet> {
    try {
      return await walletRepository.getOrSyncWallet(memberId);
    } catch (error) {
      if (error instanceof Error && error.message === "MEMBER_NOT_FOUND") {
        throw new LoyaltyProblemError("MEMBER_NOT_FOUND");
      }
      throw error;
    }
  }

  async earnFromSale(input: EarnTransactionInput): Promise<LoyaltyTransaction> {
    await requireLoyaltyWrites();
    const flags = await loyaltyFeatureFlagsService.getFlags();
    if (input.channel === LoyaltyChannel.STORE && !flags.loyaltyPhysicalEarnEnabled) {
      throw new LoyaltyProblemError("SERVICE_UNAVAILABLE");
    }
    if (input.channel === LoyaltyChannel.ECOMMERCE && !flags.loyaltyDigitalEarnEnabled) {
      throw new LoyaltyProblemError("SERVICE_UNAVAILABLE");
    }
    const points = conversionRulesService.calculatePointsFromAmountCents(
      input.amountCents,
    );
    if (points <= 0) {
      throw new LoyaltyProblemError(
        "INVALID_AMOUNT",
        "El monto no genera puntos acumulables",
      );
    }
    if (points > LOYALTY_DEFAULTS.MAX_POINTS_PER_TRANSACTION) {
      throw new LoyaltyProblemError("INVALID_AMOUNT", "Puntos exceden el máximo por transacción");
    }

    return this.executeMutation({
      memberId: input.memberId,
      actor: input.actor,
      points,
      type: LoyaltyTransactionType.EARN,
      channel: input.channel,
      amountCents: input.amountCents,
      currency: input.currency,
      externalTransactionId: input.externalTransactionId,
      idempotencyKey: input.idempotencyKey,
      operation: "earn-transactions",
      description: input.description ?? `Acumulación por venta (${input.channel})`,
      locationId: input.locationId,
      metadata: input.metadata,
      legacyTipo: TipoMovimientoPuntos.ACUMULACION,
      legacyOrigen: input.channel === LoyaltyChannel.ECOMMERCE ? "tienda" : "admin",
      requireCustomerRecipient: true,
    });
  }

  async applyAdjustment(input: AdjustmentInput): Promise<LoyaltyTransaction> {
    if (input.points === 0) {
      throw new LoyaltyProblemError("INVALID_AMOUNT");
    }
    return this.executeMutation({
      memberId: input.memberId,
      actor: input.actor,
      points: input.points,
      type: LoyaltyTransactionType.ADJUSTMENT,
      channel: LoyaltyChannel.ADMIN,
      externalTransactionId: input.externalReference,
      idempotencyKey: input.idempotencyKey,
      operation: "admin/adjustments",
      description: input.description,
      reasonCode: input.reasonCode,
      legacyTipo: TipoMovimientoPuntos.AJUSTE,
      legacyOrigen: "admin",
    });
  }

  async applyWelcomeBonus(memberId: string, actorId = "system"): Promise<LoyaltyTransaction | null> {
    const idempotencyKey = `welcome:${memberId}`;
    try {
      return await this.executeMutation({
        memberId,
        actor: {
          actorType: LoyaltyActorType.SERVICE,
          actorId,
          roles: ["SERVICE"],
          permissions: [],
        },
        points: LOYALTY_DEFAULTS.WELCOME_BONUS_POINTS,
        type: LoyaltyTransactionType.BONUS,
        channel: LoyaltyChannel.SYSTEM,
        externalTransactionId: idempotencyKey,
        idempotencyKey,
        operation: "bonus/welcome",
        description: "Bonificación de bienvenida por registro",
        reasonCode: "WELCOME",
        legacyTipo: TipoMovimientoPuntos.BONIFICACION,
        legacyOrigen: "promo",
        skipIfDuplicate: true,
      });
    } catch (error) {
      if (error instanceof LoyaltyProblemError && error.code === "DUPLICATE_TRANSACTION") {
        return null;
      }
      throw error;
    }
  }

  async applyDailyStreakBonus(
    memberId: string,
    dayKey: string,
    actorId = "racha-system",
  ): Promise<LoyaltyTransaction | null> {
    const idempotencyKey = `streak:${memberId}:${dayKey}`;
    try {
      return await this.executeMutation({
        memberId,
        actor: {
          actorType: LoyaltyActorType.SERVICE,
          actorId,
          roles: ["SERVICE"],
          permissions: [],
        },
        points: LOYALTY_DEFAULTS.STREAK_DAILY_BONUS_POINTS,
        type: LoyaltyTransactionType.BONUS,
        channel: LoyaltyChannel.SYSTEM,
        externalTransactionId: idempotencyKey,
        idempotencyKey,
        operation: "bonus/streak",
        description: "Bonificación por Fiera Racha diaria",
        reasonCode: "STREAK",
        legacyTipo: TipoMovimientoPuntos.BONIFICACION,
        legacyOrigen: "promo",
        skipIfDuplicate: true,
      });
    } catch (error) {
      if (error instanceof LoyaltyProblemError && error.code === "DUPLICATE_TRANSACTION") {
        return null;
      }
      throw error;
    }
  }

  async createRedemption(input: RedemptionInput): Promise<{
    redemption: LoyaltyRedemption;
    transaction: LoyaltyTransaction;
  }> {
    if (input.points <= 0 || !Number.isInteger(input.points)) {
      throw new LoyaltyProblemError("INVALID_AMOUNT");
    }

    const holdTxn = await this.executeMutation({
      memberId: input.memberId,
      actor: input.actor,
      points: -input.points,
      type: LoyaltyTransactionType.REDEMPTION_HOLD,
      channel: LoyaltyChannel.SYSTEM,
      idempotencyKey: input.idempotencyKey,
      operation: "redemptions",
      description: input.description ?? "Reserva de canje",
      heldDelta: input.points,
      availableDelta: -input.points,
      legacyTipo: TipoMovimientoPuntos.CANJE,
      legacyOrigen: "tienda",
    });

    const redemption = await firestoreApp.runTransaction(async (tx) => {
      return redemptionRepository.createInTx(tx, {
        memberId: input.memberId,
        points: input.points,
        holdTransactionId: holdTxn.transactionId,
      });
    });

    return { redemption, transaction: holdTxn };
  }

  /**
   * Replay idempotente: si la operación ya se ejecutó con la misma clave,
   * devuelve la respuesta cacheada antes de validar estado. Sin esto, un
   * retry legítimo (confirm/cancel/reversal ya aplicado) recibiría 409 por
   * las validaciones de estado en lugar del resultado original.
   * El docId incluye el ID del recurso en `operation`, por lo que la clave
   * no puede colisionar entre recursos distintos.
   */
  private async findCachedMutation(
    operation: string,
    actorId: string,
    idempotencyKey: string,
  ): Promise<LoyaltyTransaction | null> {
    const docId = idempotencyRepository.buildDocId(
      operation,
      actorId,
      conversionRulesService.hashIdempotencyKey(idempotencyKey),
    );
    const cached = await idempotencyRepository.get(docId);
    return (cached?.responseBody as LoyaltyTransaction) ?? null;
  }

  async confirmRedemption(
    redemptionId: string,
    actor: RedemptionInput["actor"],
    idempotencyKey: string,
  ): Promise<LoyaltyTransaction> {
    const replay = await this.findCachedMutation(
      `redemptions/${redemptionId}/confirm`,
      actor.actorId,
      idempotencyKey,
    );
    if (replay) {
      return replay;
    }
    const redemption = await redemptionRepository.getById(redemptionId);
    if (!redemption) {
      throw new LoyaltyProblemError("REDEMPTION_NOT_FOUND");
    }
    if (redemption.status === LoyaltyRedemptionStatus.CONFIRMED) {
      throw new LoyaltyProblemError("REDEMPTION_ALREADY_CONFIRMED");
    }
    if (redemption.status !== LoyaltyRedemptionStatus.PENDING) {
      throw new LoyaltyProblemError("REDEMPTION_EXPIRED");
    }
    if (redemption.expiresAt.toMillis() < Date.now()) {
      throw new LoyaltyProblemError("REDEMPTION_EXPIRED");
    }

    const confirmTxn = await this.executeMutation({
      memberId: redemption.memberId,
      actor,
      points: -redemption.points,
      type: LoyaltyTransactionType.REDEMPTION_CONFIRM,
      channel: LoyaltyChannel.SYSTEM,
      idempotencyKey,
      operation: `redemptions/${redemptionId}/confirm`,
      description: "Confirmación de canje",
      heldDelta: -redemption.points,
      availableDelta: 0,
      lifetimeEarnedDelta: 0,
      lifetimeRedeemedDelta: redemption.points,
      legacySkip: true,
      postLedgerInTx: (tx) => {
        redemptionRepository.updateStatusInTx(
          tx,
          redemptionId,
          LoyaltyRedemptionStatus.CONFIRMED,
        );
      },
    });

    return confirmTxn;
  }

  async cancelRedemption(
    redemptionId: string,
    actor: RedemptionInput["actor"],
    idempotencyKey: string,
  ): Promise<LoyaltyTransaction> {
    const replay = await this.findCachedMutation(
      `redemptions/${redemptionId}/cancel`,
      actor.actorId,
      idempotencyKey,
    );
    if (replay) {
      return replay;
    }
    const redemption = await redemptionRepository.getById(redemptionId);
    if (!redemption) {
      throw new LoyaltyProblemError("REDEMPTION_NOT_FOUND");
    }
    if (redemption.status === LoyaltyRedemptionStatus.CONFIRMED) {
      throw new LoyaltyProblemError("REDEMPTION_ALREADY_CONFIRMED");
    }
    if (redemption.status !== LoyaltyRedemptionStatus.PENDING) {
      throw new LoyaltyProblemError("REDEMPTION_EXPIRED");
    }

    const releaseTxn = await this.executeMutation({
      memberId: redemption.memberId,
      actor,
      points: redemption.points,
      type: LoyaltyTransactionType.REDEMPTION_RELEASE,
      channel: LoyaltyChannel.SYSTEM,
      idempotencyKey,
      operation: `redemptions/${redemptionId}/cancel`,
      description: "Liberación de reserva de canje",
      heldDelta: -redemption.points,
      availableDelta: redemption.points,
      lifetimeEarnedDelta: 0,
      legacySkip: true,
      postLedgerInTx: (tx) => {
        redemptionRepository.updateStatusInTx(
          tx,
          redemptionId,
          LoyaltyRedemptionStatus.CANCELLED,
        );
      },
    });

    return releaseTxn;
  }

  async reverseTransaction(input: ReversalInput): Promise<LoyaltyTransaction> {
    const replay = await this.findCachedMutation(
      `transactions/${input.originalTransactionId}/reversals`,
      input.actor.actorId,
      input.idempotencyKey,
    );
    if (replay) {
      return replay;
    }
    const original = await ledgerRepository.getById(input.originalTransactionId);
    if (!original) {
      throw new LoyaltyProblemError("TRANSACTION_NOT_FOUND");
    }
    if (
      original.status === LoyaltyTransactionStatus.REVERSED ||
      original.type === LoyaltyTransactionType.REVERSAL
    ) {
      throw new LoyaltyProblemError("TRANSACTION_NOT_REVERSIBLE");
    }
    if (original.points <= 0) {
      throw new LoyaltyProblemError("TRANSACTION_NOT_REVERSIBLE");
    }

    const alreadyReversed = original.reversedPoints ?? 0;
    const remaining = original.points - alreadyReversed;
    const requested = input.points ?? remaining;
    if (requested <= 0 || requested > remaining) {
      throw new LoyaltyProblemError("REVERSAL_EXCEEDS_ORIGINAL");
    }

    const wallet = await walletRepository.getOrSyncWallet(original.memberId);
    if (wallet.availablePoints < requested) {
      throw new LoyaltyProblemError(
        "INSUFFICIENT_POINTS",
        "No hay puntos suficientes para revertir; política conservadora activa",
      );
    }

    const reversal = await this.executeMutation({
      memberId: original.memberId,
      actor: input.actor,
      points: -requested,
      type: LoyaltyTransactionType.REVERSAL,
      channel: original.channel,
      idempotencyKey: input.idempotencyKey,
      operation: `transactions/${input.originalTransactionId}/reversals`,
      description: input.reason,
      originalTransactionId: input.originalTransactionId,
      legacyTipo: TipoMovimientoPuntos.DEVOLUCION,
      legacyOrigen: "admin",
      postLedgerInTx: (tx) => {
        ledgerRepository.markReversedInTx(
          tx,
          input.originalTransactionId,
          alreadyReversed + requested,
          alreadyReversed + requested < original.points,
        );
      },
    });

    return reversal;
  }

  private async executeMutation(params: {
    memberId: string;
    actor: EarnTransactionInput["actor"];
    points: number;
    type: LoyaltyTransactionType;
    channel: LoyaltyChannel;
    idempotencyKey: string;
    operation: string;
    description?: string;
    reasonCode?: string;
    amountCents?: number;
    currency?: string;
    externalTransactionId?: string;
    originalTransactionId?: string;
    locationId?: string;
    metadata?: Record<string, string | number | boolean>;
    legacyTipo?: TipoMovimientoPuntos;
    legacyOrigen?: string;
    heldDelta?: number;
    availableDelta?: number;
    lifetimeEarnedDelta?: number;
    lifetimeRedeemedDelta?: number;
    legacySkip?: boolean;
    skipIfDuplicate?: boolean;
    requireCustomerRecipient?: boolean;
    postLedgerInTx?: (
      tx: FirebaseFirestore.Transaction,
      entry: LoyaltyTransaction,
    ) => void;
  }): Promise<LoyaltyTransaction> {
    const idempotencyKeyHash = conversionRulesService.hashIdempotencyKey(
      params.idempotencyKey,
    );
    const requestHash = conversionRulesService.hashRequestBody({
      memberId: params.memberId,
      points: params.points,
      type: params.type,
      externalTransactionId: params.externalTransactionId,
    });
    const idempotencyDocId = idempotencyRepository.buildDocId(
      params.operation,
      params.actor.actorId,
      idempotencyKeyHash,
    );

    const cached = await idempotencyRepository.get(idempotencyDocId);
    if (cached) {
      if (cached.requestHash !== requestHash) {
        throw new LoyaltyProblemError("IDEMPOTENCY_CONFLICT");
      }
      return cached.responseBody as LoyaltyTransaction;
    }

    if (params.requireCustomerRecipient) {
      const recipient = await firestoreApp
        .collection(USUARIOS)
        .doc(params.memberId)
        .get();
      if (!recipient.exists || !isCustomerOnlyAccount(recipient.data() ?? {})) {
        throw new LoyaltyProblemError("MEMBER_NOT_FOUND");
      }
    }

    await walletRepository.ensureExpirationProcessed(params.memberId);

    const extKey =
      params.externalTransactionId &&
      params.type === LoyaltyTransactionType.EARN
        ? conversionRulesService.buildExternalTxnKey(
            params.channel,
            params.externalTransactionId,
          )
        : null;

    const result = await firestoreApp.runTransaction(async (tx) => {
      const existingIdem = await idempotencyRepository.getInTx(tx, idempotencyDocId);
      if (existingIdem) {
        if (existingIdem.requestHash !== requestHash) {
          throw new LoyaltyProblemError("IDEMPOTENCY_CONFLICT");
        }
        if (existingIdem.responseBody) {
          return existingIdem.responseBody as LoyaltyTransaction;
        }
        throw new LoyaltyProblemError("IDEMPOTENCY_CONFLICT");
      }

      if (extKey) {
        const existingExt = await externalTxnRepository.getInTx(tx, extKey);
        if (existingExt?.transactionId) {
          const txnSnap = await tx.get(
            firestoreApp
              .collection(LOYALTY_COLLECTIONS.TRANSACTIONS)
              .doc(existingExt.transactionId),
          );
          if (txnSnap.exists) {
            const existingTxn = txnSnap.data() as LoyaltyTransaction;
            idempotencyRepository.saveInTx(tx, idempotencyDocId, {
              operation: params.operation,
              actorId: params.actor.actorId,
              requestHash,
              statusCode: 201,
              responseBody: existingTxn,
              expiresAt: Date.now() + LOYALTY_DEFAULTS.IDEMPOTENCY_TTL_MS,
            });
            return existingTxn;
          }
          if (params.skipIfDuplicate) {
            throw new LoyaltyProblemError("DUPLICATE_TRANSACTION");
          }
          throw new LoyaltyProblemError("DUPLICATE_TRANSACTION");
        }
      }

      const userRef = firestoreApp.collection(USUARIOS).doc(params.memberId);
      const userSnap = await tx.get(userRef);
      if (!userSnap.exists) {
        throw new LoyaltyProblemError("MEMBER_NOT_FOUND");
      }
      if (
        params.requireCustomerRecipient &&
        !isCustomerOnlyAccount(userSnap.data() ?? {})
      ) {
        // Mismo error que un QR desconocido: no filtrar la existencia ni el rol
        // de cuentas internas a operadores del escáner.
        throw new LoyaltyProblemError("MEMBER_NOT_FOUND");
      }

      const walletRef = firestoreApp
        .collection("loyalty_wallets")
        .doc(params.memberId);
      const walletSnap = await tx.get(walletRef);
      let wallet: LoyaltyWallet;
      if (!walletSnap.exists) {
        const available = Math.max(
          0,
          Math.trunc(Number(userSnap.data()?.puntosActuales ?? 0)),
        );
        wallet = {
          memberId: params.memberId,
          availablePoints: available,
          heldPoints: 0,
          pendingPoints: 0,
          lifetimeEarnedPoints: available,
          lifetimeRedeemedPoints: 0,
          level: conversionRulesService.calculateLevel(available),
          createdAt: userSnap.data()?.createdAt,
          updatedAt: userSnap.data()?.updatedAt,
        };
      } else {
        wallet = walletSnap.data() as LoyaltyWallet;
      }

      const availableDelta =
        params.availableDelta ?? params.points;
      const balanceBefore = wallet.availablePoints;
      const updatedWallet = walletRepository.applyWalletDeltaInTx(
        tx,
        params.memberId,
        wallet,
        {
          availableDelta,
          heldDelta: params.heldDelta,
          lifetimeEarnedDelta:
            params.lifetimeEarnedDelta ??
            (params.points > 0 ? params.points : 0),
          lifetimeRedeemedDelta: params.lifetimeRedeemedDelta,
        },
      );

      const entry = ledgerRepository.createEntryInTx(tx, {
        memberId: params.memberId,
        actor: params.actor,
        type: params.type,
        status: LoyaltyTransactionStatus.CONFIRMED,
        points: params.points,
        balanceBefore,
        balanceAfter: updatedWallet.availablePoints,
        channel: params.channel,
        amountCents: params.amountCents,
        currency: params.currency,
        externalTransactionId: params.externalTransactionId,
        idempotencyKeyHash,
        originalTransactionId: params.originalTransactionId,
        description: params.description,
        reasonCode: params.reasonCode,
        locationId: params.locationId,
        metadata: params.metadata,
      });

      walletRepository.dualWriteLegacyBalanceInTx(
        tx,
        params.memberId,
        updatedWallet.availablePoints,
        updatedWallet.level,
      );

      if (params.type === LoyaltyTransactionType.BONUS && params.reasonCode === "WELCOME") {
        tx.set(
          userRef,
          { bonoBienvenidaOtorgadoAt: Timestamp.now() },
          { merge: true },
        );
      }

      if (!params.legacySkip && params.legacyTipo) {
        this.writeLegacyMovementInTx(tx, params.memberId, {
          points: params.points,
          balanceBefore,
          balanceAfter: updatedWallet.availablePoints,
          tipo: params.legacyTipo,
          origen: params.legacyOrigen ?? "admin",
          origenId: params.actor.actorId,
          descripcion: params.description,
          referencia: params.externalTransactionId,
        });
      }

      if (extKey) {
        externalTxnRepository.createInTx(tx, extKey, {
          transactionId: entry.transactionId,
          memberId: params.memberId,
          channel: params.channel,
        });
      }

      if (params.postLedgerInTx) {
        params.postLedgerInTx(tx, entry);
      }

      idempotencyRepository.saveInTx(tx, idempotencyDocId, {
        operation: params.operation,
        actorId: params.actor.actorId,
        requestHash,
        statusCode: 201,
        responseBody: entry,
        expiresAt: Date.now() + LOYALTY_DEFAULTS.IDEMPOTENCY_TTL_MS,
      });

      return entry;
    });

    return result;
  }

  private writeLegacyMovementInTx(
    tx: FirebaseFirestore.Transaction,
    memberId: string,
    input: {
      points: number;
      balanceBefore: number;
      balanceAfter: number;
      tipo: TipoMovimientoPuntos;
      origen: string;
      origenId?: string;
      descripcion?: string;
      referencia?: string;
    },
  ): void {
    if (input.points === 0) return;
    const userRef = firestoreApp.collection(USUARIOS).doc(memberId);
    const movRef = userRef.collection(MOVIMIENTOS).doc();
    const now = Timestamp.now();
    const movimiento = {
      id: movRef.id,
      usuarioId: memberId,
      tipo: input.tipo,
      puntos: input.points,
      saldoAnterior: input.balanceBefore,
      saldoNuevo: input.balanceAfter,
      origen: input.origen,
      origenId: input.origenId,
      referencia: input.referencia,
      descripcion: input.descripcion,
      createdAt: now,
    };
    tx.set(movRef, movimiento);
    if (input.origen === "admin" && input.origenId) {
      tx.set(
        firestoreApp
          .collection(USUARIOS)
          .doc(input.origenId)
          .collection(ASIGNACIONES)
          .doc(movRef.id),
        movimiento,
      );
    }
  }

  async releaseExpiredRedemptions(limit = 100): Promise<number> {
    const expired = await redemptionRepository.listExpiredPending(limit);
    let processed = 0;
    for (const redemption of expired) {
      try {
        await this.cancelRedemption(
          redemption.redemptionId,
          {
            actorType: LoyaltyActorType.SERVICE,
            actorId: "system",
            roles: ["SERVICE"],
            permissions: [],
          },
          `release:${redemption.redemptionId}`,
        );
        await firestoreApp
          .collection("loyalty_redemptions")
          .doc(redemption.redemptionId)
          .set({ status: LoyaltyRedemptionStatus.EXPIRED }, { merge: true });
        processed += 1;
      } catch {
        // continue batch
      }
    }
    return processed;
  }

  async processExpirationIfDue(memberId: string): Promise<boolean> {
    const dias = await walletRepository.getExpirationDays();
    const wallet = await walletRepository.getWalletDoc(memberId);
    if (!wallet) {
      return false;
    }
    const evaluation = await pointsService.evaluateExpiracionPendiente(
      memberId,
      dias,
    );
    if (!evaluation.expiring || evaluation.points <= 0) {
      await pointsService.procesarExpiracionUsuario(memberId, dias, {
        skipBalanceWrite: true,
        skipLegacyMovement: true,
      });
      return false;
    }

    const pointsToExpire = Math.min(wallet.availablePoints, evaluation.points);
    if (pointsToExpire <= 0) {
      return false;
    }

    const idempotencyKey = `expiration:${memberId}:${evaluation.cycleKey}`;
    await this.executeMutation({
      memberId,
      actor: {
        actorType: LoyaltyActorType.SERVICE,
        actorId: "expiration-job",
        roles: ["SERVICE"],
        permissions: [],
      },
      points: -pointsToExpire,
      type: LoyaltyTransactionType.EXPIRATION,
      channel: LoyaltyChannel.SYSTEM,
      externalTransactionId: idempotencyKey,
      idempotencyKey,
      operation: "expiration",
      description: "Expiración automática de puntos por ciclo",
      reasonCode: "CYCLE_EXPIRATION",
      legacySkip: true,
    });

    await pointsService.procesarExpiracionUsuario(memberId, dias, {
      skipBalanceWrite: true,
      skipLegacyMovement: true,
    });
    return true;
  }

  async processExpirationsVencidas(): Promise<{
    usuariosRevisados: number;
    usuariosProcesados: number;
    ciclosProcesados: number;
    puntosExpirados: number;
  }> {
    const dias = await walletRepository.getExpirationDays();
    const pageSize = 200;
    const cutoff = Timestamp.fromDate(
      new Date(Date.now() - dias * 24 * 60 * 60 * 1000),
    );
    let lastDoc: FirebaseFirestore.QueryDocumentSnapshot | null = null;

    const resumen = {
      usuariosRevisados: 0,
      usuariosProcesados: 0,
      ciclosProcesados: 0,
      puntosExpirados: 0,
    };

    while (true) {
      let query = firestoreApp
        .collection(USUARIOS)
        .where("createdAt", "<=", cutoff)
        .orderBy("createdAt")
        .limit(pageSize);
      if (lastDoc) {
        query = query.startAfter(lastDoc);
      }
      const snapshot = await query.get();
      if (snapshot.empty) break;

      for (const doc of snapshot.docs) {
        resumen.usuariosRevisados += 1;
        try {
          const wallet = await walletRepository.getWalletDoc(doc.id);
          if (wallet) {
            const processed = await this.processExpirationIfDue(doc.id);
            if (processed) {
              resumen.usuariosProcesados += 1;
            }
            continue;
          }
          const resultado = await pointsService.procesarExpiracionUsuario(
            doc.id,
            dias,
          );
          if (resultado.procesado) {
            resumen.usuariosProcesados += 1;
            resumen.ciclosProcesados += resultado.ciclosProcesados;
            resumen.puntosExpirados += resultado.puntosExpirados;
          }
        } catch {
          // continue batch
        }
      }

      lastDoc = snapshot.docs[snapshot.docs.length - 1];
      if (snapshot.size < pageSize) break;
    }

    return resumen;
  }
}

export const loyaltyEngineService = new LoyaltyEngineService();
export default loyaltyEngineService;
