import { Timestamp } from "firebase-admin/firestore";
import { firestoreTienda } from "../../config/firebase";

const PAYMENT_REFUND_REQUESTS_COLLECTION = "paymentRefundRequests";

export type PaymentRefundRequestStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "processed";

export interface PaymentRefundRequestRecord {
  id?: string;
  provider: "aplazo";
  orderId: string;
  paymentAttemptId: string;
  userId: string;
  reason: string;
  status: PaymentRefundRequestStatus;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  approvedAt?: Timestamp;
  approvedBy?: string;
  approvedReason?: string;
  refundAmountMinor?: number;
  processedAt?: Timestamp;
  providerRefundId?: string;
  providerStatus?: string;
  providerResponse?: Record<string, unknown>;
  rejectedAt?: Timestamp;
  rejectedBy?: string;
  rejectionReason?: string;
  lastProcessingError?: Record<string, unknown>;
}

type CreateRefundRequestInput = {
  orderId: string;
  paymentAttemptId: string;
  userId: string;
  reason: string;
};

type ApproveRefundRequestInput = {
  id: string;
  approvedBy: string;
  refundAmountMinor: number;
  reason?: string;
};

type ProcessRefundRequestInput = {
  id: string;
  providerRefundId?: string;
  providerStatus?: string;
  providerResponse?: Record<string, unknown>;
};

type RejectRefundRequestInput = {
  id: string;
  rejectedBy: string;
  reason: string;
};

const toRefundRequestRecord = (
  id: string,
  data: FirebaseFirestore.DocumentData,
): PaymentRefundRequestRecord => ({
  id,
  ...(data as Omit<PaymentRefundRequestRecord, "id">),
});

const withoutUndefined = (
  value: Record<string, unknown>,
): Record<string, unknown> => {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  );
};

export class PaymentRefundRequestRepository {
  private readonly collection = firestoreTienda.collection(
    PAYMENT_REFUND_REQUESTS_COLLECTION,
  );

  async create(
    input: CreateRefundRequestInput,
  ): Promise<PaymentRefundRequestRecord> {
    const now = Timestamp.now();
    const draft: Omit<PaymentRefundRequestRecord, "id"> = {
      provider: "aplazo",
      orderId: input.orderId,
      paymentAttemptId: input.paymentAttemptId,
      userId: input.userId,
      reason: input.reason,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    };

    const docRef = await this.collection.add(draft);
    return {
      id: docRef.id,
      ...draft,
    };
  }

  async getById(id: string): Promise<PaymentRefundRequestRecord | null> {
    const snapshot = await this.collection.doc(id).get();
    if (!snapshot.exists) {
      return null;
    }

    return toRefundRequestRecord(snapshot.id, snapshot.data() || {});
  }

  async findOpenByPaymentAttempt(
    paymentAttemptId: string,
  ): Promise<PaymentRefundRequestRecord | null> {
    const snapshot = await this.collection
      .where("paymentAttemptId", "==", paymentAttemptId)
      .where("status", "in", ["pending", "approved"])
      .limit(1)
      .get();

    if (snapshot.empty) {
      return null;
    }

    return toRefundRequestRecord(snapshot.docs[0].id, snapshot.docs[0].data());
  }

  async listByUser(
    userId: string,
    input: { orderId?: string } = {},
  ): Promise<PaymentRefundRequestRecord[]> {
    let query = this.collection.where("userId", "==", userId);
    if (input.orderId) {
      query = query.where("orderId", "==", input.orderId);
    }

    const snapshot = await query.orderBy("createdAt", "desc").limit(50).get();
    return snapshot.docs.map((doc) =>
      toRefundRequestRecord(doc.id, doc.data()),
    );
  }

  async listForAdmin(
    input: { status?: PaymentRefundRequestStatus } = {},
  ): Promise<PaymentRefundRequestRecord[]> {
    const query = input.status
      ? this.collection.where("status", "==", input.status)
      : this.collection.where("provider", "==", "aplazo");

    const snapshot = await query.orderBy("createdAt", "desc").limit(100).get();
    return snapshot.docs.map((doc) =>
      toRefundRequestRecord(doc.id, doc.data()),
    );
  }

  async markApproved(
    input: ApproveRefundRequestInput,
  ): Promise<PaymentRefundRequestRecord> {
    const patch = withoutUndefined({
      status: "approved",
      approvedAt: Timestamp.now(),
      approvedBy: input.approvedBy,
      approvedReason: input.reason,
      refundAmountMinor: input.refundAmountMinor,
      updatedAt: Timestamp.now(),
      lastProcessingError: null,
    });

    await this.collection.doc(input.id).set(patch, { merge: true });
    const updated = await this.getById(input.id);
    if (!updated) {
      throw new Error(`Refund request ${input.id} no encontrada`);
    }

    return updated;
  }

  async markProcessed(
    input: ProcessRefundRequestInput,
  ): Promise<PaymentRefundRequestRecord> {
    const patch = withoutUndefined({
      status: "processed",
      processedAt: Timestamp.now(),
      providerRefundId: input.providerRefundId,
      providerStatus: input.providerStatus,
      providerResponse: input.providerResponse,
      updatedAt: Timestamp.now(),
      lastProcessingError: null,
    });

    await this.collection.doc(input.id).set(patch, { merge: true });
    const updated = await this.getById(input.id);
    if (!updated) {
      throw new Error(`Refund request ${input.id} no encontrada`);
    }

    return updated;
  }

  async markProcessingFailed(
    id: string,
    error: Record<string, unknown>,
  ): Promise<PaymentRefundRequestRecord> {
    await this.collection.doc(id).set(
      {
        status: "approved",
        lastProcessingError: error,
        updatedAt: Timestamp.now(),
      },
      { merge: true },
    );

    const updated = await this.getById(id);
    if (!updated) {
      throw new Error(`Refund request ${id} no encontrada`);
    }

    return updated;
  }

  async markRejected(
    input: RejectRefundRequestInput,
  ): Promise<PaymentRefundRequestRecord> {
    const patch = {
      status: "rejected",
      rejectedAt: Timestamp.now(),
      rejectedBy: input.rejectedBy,
      rejectionReason: input.reason,
      updatedAt: Timestamp.now(),
    };

    await this.collection.doc(input.id).set(patch, { merge: true });
    const updated = await this.getById(input.id);
    if (!updated) {
      throw new Error(`Refund request ${input.id} no encontrada`);
    }

    return updated;
  }
}

export const paymentRefundRequestRepository =
  new PaymentRefundRequestRepository();
export default paymentRefundRequestRepository;
