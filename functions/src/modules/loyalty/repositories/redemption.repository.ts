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
  private collection = firestoreApp.collection(LOYALTY_COLLECTIONS.REDEMPTIONS);

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
    },
  ): LoyaltyRedemption {
    const ref = this.collection.doc();
    const now = admin.firestore.Timestamp.now();
    const expiresAt = Timestamp.fromMillis(
      now.toMillis() + LOYALTY_DEFAULTS.REDEMPTION_HOLD_TTL_MS,
    );
    const redemption: LoyaltyRedemption = {
      redemptionId: ref.id,
      memberId: input.memberId,
      points: input.points,
      holdTransactionId: input.holdTransactionId,
      status: LoyaltyRedemptionStatus.PENDING,
      expiresAt,
      createdAt: now,
      updatedAt: now,
    };
    tx.set(ref, redemption);
    return redemption;
  }

  updateStatusInTx(
    tx: Transaction,
    redemptionId: string,
    status: LoyaltyRedemptionStatus,
  ): void {
    tx.set(
      this.collection.doc(redemptionId),
      {
        status,
        updatedAt: admin.firestore.Timestamp.now(),
      },
      { merge: true },
    );
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
