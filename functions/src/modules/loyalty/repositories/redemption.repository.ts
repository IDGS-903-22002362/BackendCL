import { Timestamp, Transaction } from "firebase-admin/firestore";
import { firestoreApp } from "../../../config/app.firebase";
import { admin } from "../../../config/firebase.admin";
import {
  LOYALTY_COLLECTIONS,
  LOYALTY_DEFAULTS,
} from "../constants/loyalty.constants";
import { LoyaltyRedemptionStatus } from "../models/loyalty.enums";
import { LoyaltyRedemption } from "../models/loyalty.types";

export class RedemptionRepository {
  private get collection() {
    return firestoreApp.collection(LOYALTY_COLLECTIONS.REDEMPTIONS);
  }

  async getById(redemptionId: string): Promise<LoyaltyRedemption | null> {
    const snap = await this.collection.doc(redemptionId).get();
    if (!snap.exists) return null;
    return { ...(snap.data() as LoyaltyRedemption), redemptionId: snap.id };
  }

  createInTx(
    tx: Transaction,
    input: {
      memberId: string;
      points: number;
      holdTransactionId: string;
      redemptionId?: string;
      externalReference?: string;
      metadata?: Record<string, string | number | boolean>;
      holdTtlMs?: number;
    },
  ): LoyaltyRedemption {
    const ref = input.redemptionId
      ? this.collection.doc(input.redemptionId)
      : this.collection.doc();
    const now = admin.firestore.Timestamp.now();
    const holdTtlMs =
      typeof input.holdTtlMs === "number" &&
      Number.isFinite(input.holdTtlMs) &&
      input.holdTtlMs > 0
        ? Math.trunc(input.holdTtlMs)
        : LOYALTY_DEFAULTS.REDEMPTION_HOLD_TTL_MS;
    const expiresAt = Timestamp.fromMillis(now.toMillis() + holdTtlMs);
    const redemption: LoyaltyRedemption = {
      redemptionId: ref.id,
      memberId: input.memberId,
      points: input.points,
      holdTransactionId: input.holdTransactionId,
      status: LoyaltyRedemptionStatus.PENDING,
      expiresAt,
      createdAt: now,
      updatedAt: now,
      ...(input.externalReference
        ? { externalReference: input.externalReference }
        : {}),
      ...(input.metadata ? { metadata: input.metadata } : {}),
    };
    tx.create(ref, redemption);
    return redemption;
  }

  updateStatusInTx(
    tx: Transaction,
    redemptionId: string,
    status: LoyaltyRedemptionStatus,
    patch?: Partial<LoyaltyRedemption>,
  ): void {
    tx.set(
      this.collection.doc(redemptionId),
      {
        status,
        ...(patch || {}),
        updatedAt: admin.firestore.Timestamp.now(),
      },
      { merge: true },
    );
  }

  async findByExternalReference(
    externalReference: string,
  ): Promise<LoyaltyRedemption | null> {
    const snap = await this.collection
      .where("externalReference", "==", externalReference)
      .limit(1)
      .get();
    if (snap.empty) return null;
    const doc = snap.docs[0];
    return { ...(doc.data() as LoyaltyRedemption), redemptionId: doc.id };
  }

  async listExpiredPending(limit: number): Promise<LoyaltyRedemption[]> {
    const now = admin.firestore.Timestamp.now();
    const snap = await this.collection
      .where("status", "==", LoyaltyRedemptionStatus.PENDING)
      .where("expiresAt", "<=", now)
      .limit(limit)
      .get();
    return snap.docs.map((doc) => ({
      ...(doc.data() as LoyaltyRedemption),
      redemptionId: doc.id,
    }));
  }
}

export const redemptionRepository = new RedemptionRepository();
export default redemptionRepository;
