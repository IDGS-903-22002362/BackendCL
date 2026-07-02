import { randomBytes } from "crypto";
import { Timestamp, Transaction } from "firebase-admin/firestore";
import { firestoreApp } from "../../../../config/app.firebase";
import { admin } from "../../../../config/firebase.admin";
import {
  LOYALTY_DEFAULTS,
  LOYALTY_SANDBOX_COLLECTIONS,
} from "../../constants/loyalty.constants";
import LoyaltyProblemError from "../../errors/loyalty-problem.error";
import {
  LoyaltyActorType,
  LoyaltyChannel,
  LoyaltyEnvironment,
  LoyaltyRedemptionStatus,
  LoyaltyTransactionStatus,
  LoyaltyTransactionType,
} from "../../models/loyalty.enums";
import {
  EarnTransactionInput,
  LoyaltyActorContext,
  LoyaltyRedemption,
  LoyaltyTransaction,
  LoyaltyWallet,
  RedemptionInput,
  ReversalInput,
  TransactionResponseDto,
  WalletResponseDto,
} from "../../models/loyalty.types";
import conversionRulesService from "../../services/conversion-rules.service";
import { SandboxMemberRecord } from "../partner.types";

const SANDBOX_MEMBER_PREFIX = "test_member_";

function isSandboxMemberId(memberId: string): boolean {
  return memberId.startsWith(SANDBOX_MEMBER_PREFIX) || memberId.startsWith("test_");
}

function rejectProductionMemberInSandbox(memberId: string): void {
  if (!isSandboxMemberId(memberId)) {
    throw new LoyaltyProblemError(
      "MEMBER_NOT_FOUND",
      "Solo miembros sandbox permitidos en entorno de pruebas",
    );
  }
}

function buildPartnerExternalKey(
  partnerId: string,
  channel: LoyaltyChannel,
  externalTransactionId: string,
): string {
  return `sandbox:${partnerId}:${channel}:${externalTransactionId.trim()}`;
}

function buildIdempotencyDocId(
  environment: string,
  partnerId: string,
  operation: string,
  idempotencyKeyHash: string,
): string {
  return `${environment}:${partnerId}:${operation}:${idempotencyKeyHash}`;
}

function toWalletDto(wallet: LoyaltyWallet): WalletResponseDto {
  return {
    memberId: wallet.memberId,
    availablePoints: wallet.availablePoints,
    heldPoints: wallet.heldPoints,
    pendingPoints: wallet.pendingPoints,
    lifetimeEarnedPoints: wallet.lifetimeEarnedPoints,
    lifetimeRedeemedPoints: wallet.lifetimeRedeemedPoints,
    level: wallet.level,
    nextExpirationAt: wallet.nextExpirationAt?.toDate().toISOString(),
    upcomingExpirations: [],
  };
}

function toTransactionDto(txn: LoyaltyTransaction): TransactionResponseDto {
  return {
    transactionId: txn.transactionId,
    memberId: txn.memberId,
    type: txn.type,
    status: txn.status,
    points: txn.points,
    balanceBefore: txn.balanceBefore,
    balanceAfter: txn.balanceAfter,
    channel: txn.channel,
    amountCents: txn.amountCents,
    currency: txn.currency,
    externalTransactionId: txn.externalTransactionId,
    originalTransactionId: txn.originalTransactionId,
    description: txn.description,
    reasonCode: txn.reasonCode,
    actorId: txn.actorId,
    createdAt: txn.createdAt.toDate().toISOString(),
  };
}

export class SandboxMemberService {
  private members = firestoreApp.collection(LOYALTY_SANDBOX_COLLECTIONS.MEMBERS);
  private wallets = firestoreApp.collection(LOYALTY_SANDBOX_COLLECTIONS.WALLETS);
  private memberTokens = firestoreApp.collection(LOYALTY_SANDBOX_COLLECTIONS.MEMBER_TOKENS);

  async createTestMember(input: {
    partnerId: string;
    displayName: string;
    defaultPoints?: number;
    memberId?: string;
  }): Promise<{ member: SandboxMemberRecord; wallet: WalletResponseDto }> {
    const memberId =
      input.memberId ??
      `${SANDBOX_MEMBER_PREFIX}${input.partnerId.replace(/^partner_test_/, "")}_${randomBytes(4).toString("hex")}`;
    const defaultPoints = input.defaultPoints ?? LOYALTY_DEFAULTS.SANDBOX_DEFAULT_POINTS;
    const now = admin.firestore.Timestamp.now();

    const member: SandboxMemberRecord = {
      memberId,
      partnerId: input.partnerId,
      displayName: input.displayName,
      defaultPoints,
      environment: LoyaltyEnvironment.SANDBOX,
      createdAt: now,
    };

    const wallet: LoyaltyWallet = {
      memberId,
      availablePoints: defaultPoints,
      heldPoints: 0,
      pendingPoints: 0,
      lifetimeEarnedPoints: defaultPoints,
      lifetimeRedeemedPoints: 0,
      level: conversionRulesService.calculateLevel(defaultPoints),
      createdAt: now,
      updatedAt: now,
    };

    await firestoreApp.runTransaction(async (tx) => {
      tx.set(this.members.doc(memberId), member);
      tx.set(this.wallets.doc(memberId), wallet);
    });

    return { member, wallet: toWalletDto(wallet) };
  }

  async assertMemberBelongsToPartner(
    memberId: string,
    partnerId: string,
  ): Promise<SandboxMemberRecord> {
    rejectProductionMemberInSandbox(memberId);
    const snap = await this.members.doc(memberId).get();
    if (!snap.exists) {
      throw new LoyaltyProblemError("MEMBER_NOT_FOUND");
    }
    const member = snap.data() as SandboxMemberRecord;
    if (member.partnerId !== partnerId) {
      throw new LoyaltyProblemError("MEMBER_NOT_FOUND");
    }
    return member;
  }

  async resetTestMember(memberId: string, partnerId: string): Promise<WalletResponseDto> {
    const member = await this.assertMemberBelongsToPartner(memberId, partnerId);
    const now = admin.firestore.Timestamp.now();
    const wallet: LoyaltyWallet = {
      memberId,
      availablePoints: member.defaultPoints,
      heldPoints: 0,
      pendingPoints: 0,
      lifetimeEarnedPoints: member.defaultPoints,
      lifetimeRedeemedPoints: 0,
      level: conversionRulesService.calculateLevel(member.defaultPoints),
      createdAt: now,
      updatedAt: now,
    };

    const batch = firestoreApp.batch();
    batch.set(this.wallets.doc(memberId), wallet);

    const txSnap = await firestoreApp
      .collection(LOYALTY_SANDBOX_COLLECTIONS.TRANSACTIONS)
      .where("memberId", "==", memberId)
      .where("partnerId", "==", partnerId)
      .get();
    txSnap.docs.forEach((doc) => batch.delete(doc.ref));

    const redSnap = await firestoreApp
      .collection(LOYALTY_SANDBOX_COLLECTIONS.REDEMPTIONS)
      .where("memberId", "==", memberId)
      .get();
    redSnap.docs.forEach((doc) => batch.delete(doc.ref));

    await batch.commit();
    return toWalletDto(wallet);
  }

  async createMemberToken(
    memberId: string,
    partnerId: string,
  ): Promise<{ memberToken: string; expiresAt: string }> {
    await this.assertMemberBelongsToPartner(memberId, partnerId);
    const token = `mbr_test_${randomBytes(16).toString("hex")}`;
    const expiresAt = Date.now() + LOYALTY_DEFAULTS.MEMBER_TOKEN_TTL_MS;
    await this.memberTokens.doc(token).set({
      token,
      memberId,
      partnerId,
      expiresAt,
      createdAt: admin.firestore.Timestamp.now(),
    });
    return { memberToken: token, expiresAt: new Date(expiresAt).toISOString() };
  }

  async resolveMemberToken(token: string, partnerId: string): Promise<string> {
    const snap = await this.memberTokens.doc(token).get();
    if (!snap.exists) {
      throw new LoyaltyProblemError("INVALID_MEMBER_TOKEN");
    }
    const record = snap.data() as { memberId: string; partnerId: string; expiresAt: number };
    if (record.partnerId !== partnerId || record.expiresAt < Date.now()) {
      throw new LoyaltyProblemError("INVALID_MEMBER_TOKEN");
    }
    return record.memberId;
  }
}

export class SandboxLoyaltyEngine {
  private wallets = firestoreApp.collection(LOYALTY_SANDBOX_COLLECTIONS.WALLETS);
  private transactions = firestoreApp.collection(LOYALTY_SANDBOX_COLLECTIONS.TRANSACTIONS);
  private redemptions = firestoreApp.collection(LOYALTY_SANDBOX_COLLECTIONS.REDEMPTIONS);
  private idempotency = firestoreApp.collection(LOYALTY_SANDBOX_COLLECTIONS.IDEMPOTENCY);
  private externalIndex = firestoreApp.collection(LOYALTY_SANDBOX_COLLECTIONS.EXTERNAL_TXN_INDEX);

  async getWallet(memberId: string, partnerId: string): Promise<WalletResponseDto> {
    rejectProductionMemberInSandbox(memberId);
    await sandboxMemberService.assertMemberBelongsToPartner(memberId, partnerId);
    const snap = await this.wallets.doc(memberId).get();
    if (!snap.exists) {
      throw new LoyaltyProblemError("MEMBER_NOT_FOUND");
    }
    return toWalletDto(snap.data() as LoyaltyWallet);
  }

  async listTransactions(
    memberId: string,
    partnerId: string,
    options: { limit: number; cursor?: string },
  ): Promise<{ items: TransactionResponseDto[]; pagination: { nextCursor?: string; hasMore: boolean } }> {
    rejectProductionMemberInSandbox(memberId);
    await sandboxMemberService.assertMemberBelongsToPartner(memberId, partnerId);
    let query = this.transactions
      .where("memberId", "==", memberId)
      .where("partnerId", "==", partnerId)
      .orderBy("createdAt", "desc")
      .limit(options.limit + 1);

    if (options.cursor) {
      const cursorSnap = await this.transactions.doc(options.cursor).get();
      if (cursorSnap.exists) query = query.startAfter(cursorSnap);
    }

    const snap = await query.get();
    const hasMore = snap.docs.length > options.limit;
    const page = hasMore ? snap.docs.slice(0, options.limit) : snap.docs;
    const items = page.map((doc) =>
      toTransactionDto({ ...(doc.data() as LoyaltyTransaction), transactionId: doc.id }),
    );
    return {
      items,
      pagination: {
        nextCursor: hasMore ? page[page.length - 1]?.id : undefined,
        hasMore,
      },
    };
  }

  async getTransaction(
    transactionId: string,
    partnerId: string,
  ): Promise<TransactionResponseDto> {
    const snap = await this.transactions.doc(transactionId).get();
    if (!snap.exists) throw new LoyaltyProblemError("TRANSACTION_NOT_FOUND");
    const txn = { ...(snap.data() as LoyaltyTransaction), transactionId: snap.id };
    if ((txn as LoyaltyTransaction & { partnerId?: string }).partnerId !== partnerId) {
      throw new LoyaltyProblemError("TRANSACTION_NOT_FOUND");
    }
    return toTransactionDto(txn);
  }

  async earnFromSale(
    input: EarnTransactionInput & { partnerId: string },
  ): Promise<TransactionResponseDto> {
    rejectProductionMemberInSandbox(input.memberId);
    await sandboxMemberService.assertMemberBelongsToPartner(input.memberId, input.partnerId);

    const points = conversionRulesService.calculatePointsFromAmountCents(input.amountCents);
    if (points <= 0) throw new LoyaltyProblemError("INVALID_AMOUNT");
    if (points > LOYALTY_DEFAULTS.MAX_POINTS_PER_TRANSACTION) {
      throw new LoyaltyProblemError("INVALID_AMOUNT");
    }

    const txn = await this.executeMutation({
      memberId: input.memberId,
      partnerId: input.partnerId,
      actor: input.actor,
      points,
      type: LoyaltyTransactionType.EARN,
      channel: input.channel,
      amountCents: input.amountCents,
      currency: input.currency,
      externalTransactionId: input.externalTransactionId,
      idempotencyKey: input.idempotencyKey,
      operation: "earn-transactions",
      description: input.description ?? "AcumulaciÃ³n sandbox por venta",
      locationId: input.locationId,
    });
    return toTransactionDto(txn);
  }

  async createRedemption(
    input: RedemptionInput & { partnerId: string },
  ): Promise<{ redemption: Record<string, unknown>; transaction: TransactionResponseDto }> {
    rejectProductionMemberInSandbox(input.memberId);
    await sandboxMemberService.assertMemberBelongsToPartner(input.memberId, input.partnerId);

    const holdTxn = await this.executeMutation({
      memberId: input.memberId,
      partnerId: input.partnerId,
      actor: input.actor,
      points: -input.points,
      type: LoyaltyTransactionType.REDEMPTION_HOLD,
      channel: LoyaltyChannel.PARTNER,
      idempotencyKey: input.idempotencyKey,
      operation: "redemptions",
      description: input.description ?? "Reserva de canje sandbox",
      heldDelta: input.points,
      availableDelta: -input.points,
    });

    const expiresAt = Timestamp.fromMillis(
      Date.now() + LOYALTY_DEFAULTS.REDEMPTION_HOLD_TTL_MS,
    );
    const redemptionRef = this.redemptions.doc();
    const redemption: LoyaltyRedemption & { partnerId: string } = {
      redemptionId: redemptionRef.id,
      memberId: input.memberId,
      points: input.points,
      holdTransactionId: holdTxn.transactionId,
      status: LoyaltyRedemptionStatus.PENDING,
      expiresAt,
      createdAt: admin.firestore.Timestamp.now(),
      partnerId: input.partnerId,
    };
    await redemptionRef.set(redemption);

    return {
      redemption: {
        redemptionId: redemption.redemptionId,
        memberId: redemption.memberId,
        points: redemption.points,
        status: redemption.status,
        holdTransactionId: redemption.holdTransactionId,
        expiresAt: expiresAt.toDate().toISOString(),
        createdAt: redemption.createdAt.toDate().toISOString(),
      },
      transaction: toTransactionDto(holdTxn),
    };
  }

  /**
   * Replay idempotente: si la clave ya se usó para esta operación, devuelve
   * la respuesta original antes de validar estado (evita 409 en retries).
   */
  private async findCachedMutation(
    operation: string,
    partnerId: string,
    idempotencyKey: string,
  ): Promise<LoyaltyTransaction | null> {
    const docId = buildIdempotencyDocId(
      LoyaltyEnvironment.SANDBOX,
      partnerId,
      operation,
      conversionRulesService.hashIdempotencyKey(idempotencyKey),
    );
    const snap = await this.idempotency.doc(docId).get();
    if (!snap.exists) return null;
    return (snap.data() as { responseBody: LoyaltyTransaction }).responseBody ?? null;
  }

  async confirmRedemption(
    redemptionId: string,
    partnerId: string,
    actor: LoyaltyActorContext,
    idempotencyKey: string,
  ): Promise<TransactionResponseDto> {
    const cachedConfirm = await this.findCachedMutation(
      `redemptions/${redemptionId}/confirm`,
      partnerId,
      idempotencyKey,
    );
    if (cachedConfirm) {
      return toTransactionDto(cachedConfirm);
    }
    const redemption = await this.getRedemption(redemptionId, partnerId);
    if (redemption.status === LoyaltyRedemptionStatus.CONFIRMED) {
      throw new LoyaltyProblemError("REDEMPTION_ALREADY_CONFIRMED");
    }
    if (
      redemption.status !== LoyaltyRedemptionStatus.PENDING ||
      redemption.expiresAt.toMillis() < Date.now()
    ) {
      throw new LoyaltyProblemError("REDEMPTION_EXPIRED");
    }

    const txn = await this.executeMutation({
      memberId: redemption.memberId,
      partnerId,
      actor,
      points: 0,
      type: LoyaltyTransactionType.REDEMPTION_CONFIRM,
      channel: LoyaltyChannel.PARTNER,
      idempotencyKey,
      operation: `redemptions/${redemptionId}/confirm`,
      description: "ConfirmaciÃ³n de canje sandbox",
      heldDelta: -redemption.points,
      lifetimeRedeemedDelta: redemption.points,
    });

    await this.redemptions.doc(redemptionId).update({
      status: LoyaltyRedemptionStatus.CONFIRMED,
      updatedAt: admin.firestore.Timestamp.now(),
    });
    return toTransactionDto(txn);
  }

  async cancelRedemption(
    redemptionId: string,
    partnerId: string,
    actor: LoyaltyActorContext,
    idempotencyKey: string,
  ): Promise<TransactionResponseDto> {
    const cachedCancel = await this.findCachedMutation(
      `redemptions/${redemptionId}/cancel`,
      partnerId,
      idempotencyKey,
    );
    if (cachedCancel) {
      return toTransactionDto(cachedCancel);
    }
    const redemption = await this.getRedemption(redemptionId, partnerId);
    if (redemption.status === LoyaltyRedemptionStatus.CONFIRMED) {
      throw new LoyaltyProblemError("REDEMPTION_ALREADY_CONFIRMED");
    }
    if (redemption.status !== LoyaltyRedemptionStatus.PENDING) {
      throw new LoyaltyProblemError("REDEMPTION_EXPIRED");
    }

    const txn = await this.executeMutation({
      memberId: redemption.memberId,
      partnerId,
      actor,
      points: redemption.points,
      type: LoyaltyTransactionType.REDEMPTION_RELEASE,
      channel: LoyaltyChannel.PARTNER,
      idempotencyKey,
      operation: `redemptions/${redemptionId}/cancel`,
      description: "CancelaciÃ³n de canje sandbox",
      heldDelta: -redemption.points,
      availableDelta: redemption.points,
    });

    await this.redemptions.doc(redemptionId).update({
      status: LoyaltyRedemptionStatus.CANCELLED,
      updatedAt: admin.firestore.Timestamp.now(),
    });
    return toTransactionDto(txn);
  }

  async reverseTransaction(
    input: ReversalInput & { partnerId: string; originalTransactionId: string },
  ): Promise<TransactionResponseDto> {
    const cachedReversal = await this.findCachedMutation(
      `transactions/${input.originalTransactionId}/reversals`,
      input.partnerId,
      input.idempotencyKey,
    );
    if (cachedReversal) {
      return toTransactionDto(cachedReversal);
    }
    const originalSnap = await this.transactions.doc(input.originalTransactionId).get();
    if (!originalSnap.exists) throw new LoyaltyProblemError("TRANSACTION_NOT_FOUND");
    const original = {
      ...(originalSnap.data() as LoyaltyTransaction),
      transactionId: originalSnap.id,
    };
    if ((original as LoyaltyTransaction & { partnerId?: string }).partnerId !== input.partnerId) {
      throw new LoyaltyProblemError("TRANSACTION_NOT_FOUND");
    }
    if (
      original.status === LoyaltyTransactionStatus.REVERSED ||
      original.type === LoyaltyTransactionType.REVERSAL
    ) {
      throw new LoyaltyProblemError("TRANSACTION_NOT_REVERSIBLE");
    }
    if (original.points <= 0) throw new LoyaltyProblemError("TRANSACTION_NOT_REVERSIBLE");

    const alreadyReversed = original.reversedPoints ?? 0;
    const remaining = original.points - alreadyReversed;
    const requested = input.points ?? remaining;
    if (requested <= 0 || requested > remaining) {
      throw new LoyaltyProblemError("REVERSAL_EXCEEDS_ORIGINAL");
    }

    const walletSnap = await this.wallets.doc(original.memberId).get();
    const wallet = walletSnap.data() as LoyaltyWallet;
    if (!wallet || wallet.availablePoints < requested) {
      throw new LoyaltyProblemError("INSUFFICIENT_POINTS");
    }

    const txn = await this.executeMutation({
      memberId: original.memberId,
      partnerId: input.partnerId,
      actor: input.actor,
      points: -requested,
      type: LoyaltyTransactionType.REVERSAL,
      channel: original.channel,
      idempotencyKey: input.idempotencyKey,
      operation: `transactions/${input.originalTransactionId}/reversals`,
      description: input.reason,
      originalTransactionId: input.originalTransactionId,
      postLedgerInTx: (tx) => {
        tx.set(
          this.transactions.doc(input.originalTransactionId),
          {
            reversedPoints: alreadyReversed + requested,
            partiallyReversed: alreadyReversed + requested < original.points,
            status:
              alreadyReversed + requested < original.points
                ? LoyaltyTransactionStatus.CONFIRMED
                : LoyaltyTransactionStatus.REVERSED,
          },
          { merge: true },
        );
      },
    });
    return toTransactionDto(txn);
  }

  private async getRedemption(
    redemptionId: string,
    partnerId: string,
  ): Promise<LoyaltyRedemption & { partnerId: string }> {
    const snap = await this.redemptions.doc(redemptionId).get();
    if (!snap.exists) throw new LoyaltyProblemError("REDEMPTION_NOT_FOUND");
    const redemption = snap.data() as LoyaltyRedemption & { partnerId: string };
    if (redemption.partnerId !== partnerId) {
      throw new LoyaltyProblemError("REDEMPTION_NOT_FOUND");
    }
    return { ...redemption, redemptionId: snap.id };
  }

  private async executeMutation(params: {
    memberId: string;
    partnerId: string;
    actor: LoyaltyActorContext;
    points: number;
    type: LoyaltyTransactionType;
    channel: LoyaltyChannel;
    idempotencyKey: string;
    operation: string;
    description?: string;
    amountCents?: number;
    currency?: string;
    externalTransactionId?: string;
    originalTransactionId?: string;
    locationId?: string;
    heldDelta?: number;
    availableDelta?: number;
    lifetimeEarnedDelta?: number;
    lifetimeRedeemedDelta?: number;
    postLedgerInTx?: (tx: Transaction) => void;
  }): Promise<LoyaltyTransaction> {
    const idempotencyKeyHash = conversionRulesService.hashIdempotencyKey(params.idempotencyKey);
    const requestHash = conversionRulesService.hashRequestBody({
      memberId: params.memberId,
      points: params.points,
      type: params.type,
      externalTransactionId: params.externalTransactionId,
    });
    const idempotencyDocId = buildIdempotencyDocId(
      LoyaltyEnvironment.SANDBOX,
      params.partnerId,
      params.operation,
      idempotencyKeyHash,
    );

    const cached = await this.idempotency.doc(idempotencyDocId).get();
    if (cached.exists) {
      const record = cached.data() as { requestHash: string; responseBody: LoyaltyTransaction };
      if (record.requestHash !== requestHash) {
        throw new LoyaltyProblemError("IDEMPOTENCY_CONFLICT");
      }
      return record.responseBody;
    }

    const extKey =
      params.externalTransactionId && params.type === LoyaltyTransactionType.EARN
        ? buildPartnerExternalKey(params.partnerId, params.channel, params.externalTransactionId)
        : null;

    return firestoreApp.runTransaction(async (tx) => {
      const existingIdem = await tx.get(this.idempotency.doc(idempotencyDocId));
      if (existingIdem.exists) {
        const record = existingIdem.data() as { requestHash: string; responseBody: LoyaltyTransaction };
        if (record.requestHash !== requestHash) throw new LoyaltyProblemError("IDEMPOTENCY_CONFLICT");
        return record.responseBody;
      }

      if (extKey) {
        const extSnap = await tx.get(this.externalIndex.doc(extKey));
        if (extSnap.exists) {
          const ext = extSnap.data() as { transactionId: string };
          const txnSnap = await tx.get(this.transactions.doc(ext.transactionId));
          if (txnSnap.exists) {
            const existingTxn = { ...(txnSnap.data() as LoyaltyTransaction), transactionId: txnSnap.id };
            tx.create(this.idempotency.doc(idempotencyDocId), {
              operation: params.operation,
              actorId: params.partnerId,
              requestHash,
              statusCode: 201,
              responseBody: existingTxn,
              expiresAt: Date.now() + LOYALTY_DEFAULTS.IDEMPOTENCY_TTL_MS,
              createdAt: admin.firestore.Timestamp.now(),
            });
            return existingTxn;
          }
          throw new LoyaltyProblemError("DUPLICATE_TRANSACTION");
        }
      }

      const walletRef = this.wallets.doc(params.memberId);
      const walletSnap = await tx.get(walletRef);
      if (!walletSnap.exists) throw new LoyaltyProblemError("MEMBER_NOT_FOUND");
      let wallet = walletSnap.data() as LoyaltyWallet;

      const availableDelta = params.availableDelta ?? params.points;
      const balanceBefore = wallet.availablePoints;
      const newAvailable = balanceBefore + availableDelta;
      const newHeld = wallet.heldPoints + (params.heldDelta ?? 0);

      if (newAvailable < 0 || newHeld < 0) {
        throw new LoyaltyProblemError("INSUFFICIENT_POINTS");
      }

      wallet = {
        ...wallet,
        availablePoints: newAvailable,
        heldPoints: newHeld,
        lifetimeEarnedPoints:
          wallet.lifetimeEarnedPoints + (params.lifetimeEarnedDelta ?? (params.points > 0 ? params.points : 0)),
        lifetimeRedeemedPoints:
          wallet.lifetimeRedeemedPoints + (params.lifetimeRedeemedDelta ?? 0),
        level: conversionRulesService.calculateLevel(newAvailable),
        updatedAt: admin.firestore.Timestamp.now(),
      };
      tx.set(walletRef, wallet);

      const txnRef = this.transactions.doc();
      const entry: LoyaltyTransaction & { partnerId: string } = {
        transactionId: txnRef.id,
        memberId: params.memberId,
        partnerId: params.partnerId,
        actorId: params.actor.actorId,
        actorType: LoyaltyActorType.PARTNER,
        type: params.type,
        status: LoyaltyTransactionStatus.CONFIRMED,
        points: params.points,
        balanceBefore,
        balanceAfter: newAvailable,
        channel: params.channel,
        amountCents: params.amountCents,
        currency: params.currency,
        externalTransactionId: params.externalTransactionId,
        idempotencyKeyHash,
        originalTransactionId: params.originalTransactionId,
        description: params.description,
        locationId: params.locationId,
        createdAt: admin.firestore.Timestamp.now(),
      };
      tx.set(txnRef, entry);

      if (extKey) {
        tx.create(this.externalIndex.doc(extKey), {
          transactionId: txnRef.id,
          memberId: params.memberId,
          channel: params.channel,
          partnerId: params.partnerId,
        });
      }

      params.postLedgerInTx?.(tx);

      tx.create(this.idempotency.doc(idempotencyDocId), {
        operation: params.operation,
        actorId: params.partnerId,
        requestHash,
        statusCode: 201,
        responseBody: entry,
        expiresAt: Date.now() + LOYALTY_DEFAULTS.IDEMPOTENCY_TTL_MS,
        createdAt: admin.firestore.Timestamp.now(),
      });

      return entry;
    });
  }
}

export const sandboxMemberService = new SandboxMemberService();
export const sandboxLoyaltyEngine = new SandboxLoyaltyEngine();
export default sandboxLoyaltyEngine;
