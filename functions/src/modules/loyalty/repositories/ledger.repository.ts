import { Timestamp, Transaction } from "firebase-admin/firestore";
import { firestoreApp } from "../../../config/app.firebase";
import { admin } from "../../../config/firebase.admin";
import { LOYALTY_COLLECTIONS } from "../constants/loyalty.constants";
import {
  LoyaltyChannel,
  LoyaltyTransactionStatus,
  LoyaltyTransactionType,
} from "../models/loyalty.enums";
import {
  LoyaltyActorContext,
  LoyaltyTransaction,
  TransactionResponseDto,
} from "../models/loyalty.types";

export class LedgerRepository {
  private collection = firestoreApp.collection(LOYALTY_COLLECTIONS.TRANSACTIONS);

  async getById(transactionId: string): Promise<LoyaltyTransaction | null> {
    const snap = await this.collection.doc(transactionId).get();
    if (!snap.exists) return null;
    return { ...(snap.data() as LoyaltyTransaction), transactionId: snap.id };
  }

  createEntryInTx(
    tx: Transaction,
    input: {
      memberId: string;
      actor: LoyaltyActorContext;
      type: LoyaltyTransactionType;
      status: LoyaltyTransactionStatus;
      points: number;
      balanceBefore: number;
      balanceAfter: number;
      channel: LoyaltyChannel;
      amountCents?: number;
      currency?: string;
      externalTransactionId?: string;
      idempotencyKeyHash?: string;
      originalTransactionId?: string;
      description?: string;
      reasonCode?: string;
      locationId?: string;
      metadata?: Record<string, string | number | boolean>;
    },
  ): LoyaltyTransaction {
    const ref = this.collection.doc();
    const entry: LoyaltyTransaction = {
      transactionId: ref.id,
      memberId: input.memberId,
      actorId: input.actor.actorId,
      actorType: input.actor.actorType,
      type: input.type,
      status: input.status,
      points: input.points,
      balanceBefore: input.balanceBefore,
      balanceAfter: input.balanceAfter,
      channel: input.channel,
      amountCents: input.amountCents,
      currency: input.currency,
      externalTransactionId: input.externalTransactionId,
      idempotencyKeyHash: input.idempotencyKeyHash,
      originalTransactionId: input.originalTransactionId,
      description: input.description,
      reasonCode: input.reasonCode,
      locationId: input.locationId,
      metadata: input.metadata,
      createdAt: admin.firestore.Timestamp.now(),
    };
    tx.set(ref, entry);
    return entry;
  }

  markReversedInTx(
    tx: Transaction,
    originalTransactionId: string,
    reversedPoints: number,
    partiallyReversed: boolean,
  ): void {
    tx.set(
      this.collection.doc(originalTransactionId),
      {
        reversedPoints,
        partiallyReversed,
        status: partiallyReversed
          ? LoyaltyTransactionStatus.CONFIRMED
          : LoyaltyTransactionStatus.REVERSED,
        updatedAt: admin.firestore.Timestamp.now(),
      },
      { merge: true },
    );
  }

  async listByMember(
    memberId: string,
    options: {
      limit: number;
      cursor?: string;
      type?: string;
      status?: string;
      from?: string;
      to?: string;
    },
  ): Promise<{ items: LoyaltyTransaction[]; nextCursor?: string }> {
    let query = this.collection
      .where("memberId", "==", memberId)
      .orderBy("createdAt", "desc")
      .limit(options.limit + 1);

    if (options.type) {
      query = query.where("type", "==", options.type);
    }
    if (options.status) {
      query = query.where("status", "==", options.status);
    }

    if (options.cursor) {
      const cursorSnap = await this.collection.doc(options.cursor).get();
      if (cursorSnap.exists) {
        query = query.startAfter(cursorSnap);
      }
    }

    const snap = await query.get();
    let docs = snap.docs;
    if (options.from || options.to) {
      const fromMs = options.from ? Date.parse(options.from) : null;
      const toMs = options.to ? Date.parse(options.to) : null;
      docs = docs.filter((doc) => {
        const createdAt = (doc.data().createdAt as Timestamp).toDate().getTime();
        if (fromMs !== null && createdAt < fromMs) return false;
        if (toMs !== null && createdAt > toMs) return false;
        return true;
      });
    }

    const hasMore = docs.length > options.limit;
    const page = hasMore ? docs.slice(0, options.limit) : docs;
    const items = page.map((doc) => ({
      ...(doc.data() as LoyaltyTransaction),
      transactionId: doc.id,
    }));
    return {
      items,
      nextCursor: hasMore ? page[page.length - 1]?.id : undefined,
    };
  }

  async listAdmin(options: {
    limit: number;
    cursor?: string;
    memberId?: string;
    actorId?: string;
    channel?: LoyaltyChannel;
  }): Promise<{ items: LoyaltyTransaction[]; nextCursor?: string }> {
    let query: FirebaseFirestore.Query = this.collection.orderBy(
      "createdAt",
      "desc",
    );

    if (options.memberId) {
      query = query.where("memberId", "==", options.memberId);
    }
    if (options.actorId) {
      query = query.where("actorId", "==", options.actorId);
    }
    if (options.channel) {
      query = query.where("channel", "==", options.channel);
    }

    query = query.limit(options.limit + 1);

    if (options.cursor) {
      const cursorSnap = await this.collection.doc(options.cursor).get();
      if (cursorSnap.exists) {
        query = query.startAfter(cursorSnap);
      }
    }

    const snap = await query.get();
    const hasMore = snap.docs.length > options.limit;
    const page = hasMore ? snap.docs.slice(0, options.limit) : snap.docs;
    const items = page.map((doc) => ({
      ...(doc.data() as LoyaltyTransaction),
      transactionId: doc.id,
    }));
    return {
      items,
      nextCursor: hasMore ? page[page.length - 1]?.id : undefined,
    };
  }

  toResponseDto(transaction: LoyaltyTransaction): TransactionResponseDto {
    return {
      transactionId: transaction.transactionId,
      memberId: transaction.memberId,
      type: transaction.type,
      status: transaction.status,
      points: transaction.points,
      balanceBefore: transaction.balanceBefore,
      balanceAfter: transaction.balanceAfter,
      channel: transaction.channel,
      amountCents: transaction.amountCents,
      currency: transaction.currency,
      externalTransactionId: transaction.externalTransactionId,
      originalTransactionId: transaction.originalTransactionId,
      description: transaction.description,
      reasonCode: transaction.reasonCode,
      actorId: transaction.actorId,
      createdAt: transaction.createdAt.toDate().toISOString(),
    };
  }
}

export const ledgerRepository = new LedgerRepository();
export default ledgerRepository;
