import { Timestamp } from "firebase-admin/firestore";
import { createHash } from "crypto";
import { firestoreTienda } from "../../config/firebase";
import { admin } from "../../config/firebase.admin";
import { ProveedorPago } from "../../models/pago.model";
import logger from "../../utils/logger";
import { PaymentEventLogRecord } from "./payment-domain.types";

export const PAYMENT_EVENT_LOGS_COLLECTION = "paymentEventLogs";

const paymentEventLogger = logger.child({
  component: "payment-event-log-repository",
});

const buildLogId = (provider: ProveedorPago, dedupeKey: string): string => {
  const digest = createHash("sha256")
    .update(`${provider}:${dedupeKey}`)
    .digest("hex");
  return `${provider.toLowerCase()}_${digest.slice(0, 48)}`;
};

export class PaymentEventLogRepository {
  private readonly collection = firestoreTienda.collection(
    PAYMENT_EVENT_LOGS_COLLECTION,
  );

  async reserve(
    input: Omit<PaymentEventLogRecord, "id" | "processed" | "createdAt" | "updatedAt">,
  ): Promise<{ created: boolean; record: PaymentEventLogRecord }> {
    const id = buildLogId(input.provider, input.dedupeKey);
    const now = Timestamp.now();
    const payload: PaymentEventLogRecord = {
      id,
      ...input,
      processed: false,
      createdAt: now,
      updatedAt: now,
    };

    try {
      await this.collection.doc(id).create(payload);
      return { created: true, record: payload };
    } catch (error) {
      const firestoreError = error as { code?: string | number };
      if (String(firestoreError?.code) !== "6" &&
          String(firestoreError?.code) !== "already-exists") {
        throw error;
      }

      const existing = await this.getById(id);
      if (!existing) {
        throw error;
      }

      return { created: false, record: existing };
    }
  }

  async getById(id: string): Promise<PaymentEventLogRecord | null> {
    const snapshot = await this.collection.doc(id).get();
    if (!snapshot.exists) {
      return null;
    }

    return {
      id: snapshot.id,
      ...(snapshot.data() as PaymentEventLogRecord),
    };
  }

  async markProcessing(id: string): Promise<PaymentEventLogRecord | null> {
    const docRef = this.collection.doc(id);
    let captured: PaymentEventLogRecord | null = null;

    await firestoreTienda.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(docRef);
      if (!snapshot.exists) {
        return;
      }

      const record = {
        id: snapshot.id,
        ...(snapshot.data() as PaymentEventLogRecord),
      };

      if (
        record.status === "processing" ||
        record.status === "processed" ||
        record.status === "duplicate"
      ) {
        captured = record;
        return;
      }

      transaction.set(
        docRef,
        {
          status: "processing",
          updatedAt: Timestamp.now(),
        },
        { merge: true },
      );

      captured = {
        ...record,
        status: "processing",
        updatedAt: Timestamp.now(),
      };
    });

    return captured;
  }

  async markStatus(
    id: string,
    status: PaymentEventLogRecord["status"],
    patch?: Partial<PaymentEventLogRecord>,
  ): Promise<void> {
    if (status === "failed") {
      paymentEventLogger.warn("payment_event_failed", {
        paymentEventLogId: id,
        errorMessage: patch?.errorMessage,
      });
    }

    await this.collection.doc(id).set(
      {
        ...patch,
        status,
        processed: status === "processed" || status === "duplicate",
        processedAt:
          status === "processed" || status === "duplicate"
            ? Timestamp.now()
            : patch?.processedAt,
        updatedAt: Timestamp.now(),
        retryCount:
          patch?.retryCount ??
          (status === "failed" ? admin.firestore.FieldValue.increment(1) : undefined),
      },
      { merge: true },
    );
  }

  async listPendingMatch(limit = 50): Promise<PaymentEventLogRecord[]> {
    const snapshot = await this.collection
      .where("status", "==", "pending_match")
      .orderBy("createdAt", "asc")
      .limit(limit)
      .get();

    return snapshot.docs.map((doc) => ({
      id: doc.id,
      ...(doc.data() as PaymentEventLogRecord),
    }));
  }
}

export const paymentEventLogRepository = new PaymentEventLogRepository();
export default paymentEventLogRepository;
