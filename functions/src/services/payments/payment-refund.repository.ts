import { Timestamp } from "firebase-admin/firestore";
import { firestoreTienda } from "../../config/firebase";
import { EstadoPago, PaymentStatus } from "../../models/pago.model";
import { PaymentApiError } from "./payment-api-error";
import {
  PaymentAttempt,
  PaymentRefundRecord,
} from "./payment-domain.types";

const PAYMENT_REFUNDS_COLLECTION = "paymentRefunds";
const PAYMENTS_COLLECTION = "pagos";
const ORDERS_COLLECTION = "ordenes";

type CreateProcessingRefundInput = {
  paymentAttemptId: string;
  amountMinor: number;
  reason?: string;
  requestedBy: string;
};

type CompleteRefundInput = {
  operationId: string;
  paymentAttemptId: string;
  orderId?: string;
  providerRefundId?: string;
  providerResponse?: Record<string, unknown>;
  nextPaymentStatus: PaymentStatus;
  refundTotalMinor: number;
  refundRemainingMinor: number;
  refundsCount: number;
  reason?: string;
  refundAmountMinor: number;
  refundAmountMajor: number;
  providerStatus?: string;
};

type FailRefundInput = {
  operationId: string;
  paymentAttemptId: string;
  failedReason: string;
  providerResponse?: Record<string, unknown>;
};

const toRefundRecord = (
  id: string,
  data: FirebaseFirestore.DocumentData,
): PaymentRefundRecord => ({
  id,
  ...(data as Omit<PaymentRefundRecord, "id">),
});

const withoutUndefined = (
  value: Record<string, unknown>,
): Record<string, unknown> => {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  );
};

export class PaymentRefundRepository {
  private readonly refundsCollection = firestoreTienda.collection(
    PAYMENT_REFUNDS_COLLECTION,
  );

  private readonly paymentsCollection = firestoreTienda.collection(
    PAYMENTS_COLLECTION,
  );

  private readonly ordersCollection = firestoreTienda.collection(
    ORDERS_COLLECTION,
  );

  async createProcessingRefund(
    input: CreateProcessingRefundInput,
  ): Promise<PaymentRefundRecord> {
    const operationId = `${input.paymentAttemptId}_refund_${Date.now()}_${Math.random()
      .toString(36)
      .slice(2, 10)}`;
    const paymentRef = this.paymentsCollection.doc(input.paymentAttemptId);
    const refundRef = this.refundsCollection.doc(operationId);
    const now = Timestamp.now();
    let created: PaymentRefundRecord | null = null;

    await firestoreTienda.runTransaction(async (transaction) => {
      const paymentSnapshot = await transaction.get(paymentRef);
      if (!paymentSnapshot.exists) {
        throw new PaymentApiError(
          404,
          "PAYMENT_ATTEMPT_NOT_FOUND",
          `PaymentAttempt ${input.paymentAttemptId} no encontrado`,
        );
      }

      const paymentAttempt = paymentSnapshot.data() as PaymentAttempt;
      if (paymentAttempt.currentRefundOperationId) {
        throw new PaymentApiError(
          409,
          "REFUND_ALREADY_PROCESSING",
          "Ya existe un refund Aplazo en proceso para este intento de pago",
          {
            paymentAttemptId: input.paymentAttemptId,
            operationId: paymentAttempt.currentRefundOperationId,
          },
        );
      }

      const record: PaymentRefundRecord = {
        paymentAttemptId: input.paymentAttemptId,
        amountMinor: input.amountMinor,
        requestedBy: input.requestedBy,
        requestedAt: now,
        status: "processing",
        provider: "aplazo",
        createdAt: now,
        updatedAt: now,
        ...(input.reason ? { reason: input.reason } : {}),
      };

      transaction.create(refundRef, record);
      transaction.set(
        paymentRef,
        {
          currentRefundOperationId: operationId,
          refundState: "processing",
          updatedAt: now,
        },
        { merge: true },
      );
      created = { id: operationId, ...record };
    });

    if (!created) {
      throw new PaymentApiError(
        500,
        "PAYMENT_INTERNAL_ERROR",
        "No fue posible crear la operación de refund",
      );
    }

    return created;
  }

  async markSucceeded(input: CompleteRefundInput): Promise<void> {
    const now = Timestamp.now();
    const refundPatch = withoutUndefined({
      status: "succeeded",
      providerRefundId: input.providerRefundId,
      providerResponse: input.providerResponse,
      updatedAt: now,
    });
    const paymentPatch = withoutUndefined({
      currentRefundOperationId: null,
      refundState: "succeeded",
      status: input.nextPaymentStatus,
      estado: EstadoPago.REEMBOLSADO,
      providerStatus: input.providerStatus,
      refundId: input.providerRefundId,
      refundAmount: input.refundAmountMajor,
      refundReason: input.reason,
      refundTotalMinor: input.refundTotalMinor,
      refundRemainingMinor: input.refundRemainingMinor,
      refundsCount: input.refundsCount,
      lastRefundAt: now,
      lastRefundReason: input.reason,
      updatedAt: now,
    });

    await firestoreTienda.runTransaction(async (transaction) => {
      const paymentRef = this.paymentsCollection.doc(input.paymentAttemptId);
      const refundRef = this.refundsCollection.doc(input.operationId);
      const orderRef = input.orderId
        ? this.ordersCollection.doc(input.orderId)
        : undefined;
      const orderSnapshot = orderRef ? await transaction.get(orderRef) : undefined;
      transaction.set(refundRef, refundPatch, { merge: true });
      transaction.set(paymentRef, paymentPatch, { merge: true });
      if (orderRef && orderSnapshot?.exists) {
        const order = orderSnapshot.data() as {
          paymentMetadata?: Record<string, unknown>;
        };
        transaction.set(
          orderRef,
          {
            paymentMetadata: {
              ...(order.paymentMetadata || {}),
              paymentStatus: input.nextPaymentStatus,
              lastRefundAt: now,
              lastRefundAmountMinor: input.refundAmountMinor,
              lastRefundId: input.providerRefundId,
            },
            updatedAt: now,
          },
          { merge: true },
        );
      }
    });
  }

  async markFailed(input: FailRefundInput): Promise<void> {
    const now = Timestamp.now();
    const refundPatch = withoutUndefined({
      status: "failed",
      failedReason: input.failedReason,
      providerResponse: input.providerResponse,
      updatedAt: now,
    });
    await firestoreTienda.runTransaction(async (transaction) => {
      const paymentRef = this.paymentsCollection.doc(input.paymentAttemptId);
      const refundRef = this.refundsCollection.doc(input.operationId);
      transaction.set(refundRef, refundPatch, { merge: true });
      transaction.set(
        paymentRef,
        {
          currentRefundOperationId: null,
          refundState: "failed",
          updatedAt: now,
        },
        { merge: true },
      );
    });
  }

  async listByPaymentAttempt(
    paymentAttemptId: string,
    limit = 50,
  ): Promise<PaymentRefundRecord[]> {
    const snapshot = await this.refundsCollection
      .where("paymentAttemptId", "==", paymentAttemptId)
      .limit(limit)
      .get();

    return snapshot.docs.map((doc) => toRefundRecord(doc.id, doc.data()));
  }
}

export const paymentRefundRepository = new PaymentRefundRepository();
export default paymentRefundRepository;
