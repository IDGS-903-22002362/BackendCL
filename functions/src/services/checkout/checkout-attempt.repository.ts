import { Timestamp } from "firebase-admin/firestore";
import { firestoreTienda } from "../../config/firebase";
import { admin } from "../../config/firebase.admin";
import {
  CheckoutAttempt,
  CheckoutAttemptStatus,
} from "../../models/checkout-attempt.model";
import { INVENTORY_RESERVATION_TTL_MINUTES } from "../../config/inventory.config";

const COLLECTION = "checkoutAttempts";

const ACTIVE_STATUSES: CheckoutAttemptStatus[] = [
  CheckoutAttemptStatus.CREATED,
  CheckoutAttemptStatus.PAYMENT_PENDING,
  CheckoutAttemptStatus.PROCESSING,
  CheckoutAttemptStatus.PAID,
];

export class CheckoutAttemptRepository {
  private readonly collection = firestoreTienda.collection(COLLECTION);

  async create(
    draft: Omit<CheckoutAttempt, "id" | "createdAt" | "updatedAt" | "expiresAt">,
  ): Promise<CheckoutAttempt> {
    const now = Timestamp.now();
    const expiresAt = Timestamp.fromDate(
      new Date(Date.now() + INVENTORY_RESERVATION_TTL_MINUTES * 60 * 1000),
    );
    const doc: Omit<CheckoutAttempt, "id"> = {
      ...draft,
      expiresAt,
      createdAt: now,
      updatedAt: now,
    };
    const ref = await this.collection.add(doc);
    return { id: ref.id, ...doc };
  }

  async getById(id: string): Promise<CheckoutAttempt | null> {
    const snap = await this.collection.doc(id).get();
    if (!snap.exists) {
      return null;
    }
    return { id: snap.id, ...(snap.data() as CheckoutAttempt) };
  }

  async update(
    id: string,
    patch: Partial<CheckoutAttempt>,
  ): Promise<CheckoutAttempt> {
    const ref = this.collection.doc(id);
    const now = Timestamp.now();
    await ref.set({ ...patch, updatedAt: now }, { merge: true });
    const updated = await ref.get();
    return { id: updated.id, ...(updated.data() as CheckoutAttempt) };
  }

  async findByIdempotencyKey(
    idempotencyKey: string,
  ): Promise<CheckoutAttempt | null> {
    const snap = await this.collection
      .where("idempotencyKey", "==", idempotencyKey)
      .limit(1)
      .get();
    if (snap.empty) {
      return null;
    }
    const doc = snap.docs[0];
    return { id: doc.id, ...(doc.data() as CheckoutAttempt) };
  }

  async findActiveByUserAndCart(
    userId: string,
    cartId: string,
  ): Promise<CheckoutAttempt | null> {
    const snap = await this.collection
      .where("userId", "==", userId)
      .where("cartId", "==", cartId)
      .where("status", "in", ACTIVE_STATUSES)
      .limit(5)
      .get();
    if (snap.empty) {
      return null;
    }
    const docs = snap.docs
      .map((doc) => ({ id: doc.id, ...(doc.data() as CheckoutAttempt) }))
      .sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis());
    const attempt = docs[0];
    if (attempt.expiresAt.toMillis() <= Date.now()) {
      return null;
    }
    return attempt;
  }

  async findPaymentPendingByUser(
    userId: string,
    limit = 10,
  ): Promise<CheckoutAttempt[]> {
    const snap = await this.collection
      .where("userId", "==", userId)
      .where("status", "==", CheckoutAttemptStatus.PAYMENT_PENDING)
      .limit(limit)
      .get();

    return snap.docs.map((doc) => ({
      id: doc.id,
      ...(doc.data() as CheckoutAttempt),
    }));
  }

  /** Intentos PAYMENT_PENDING sin actividad reciente (reconciliación backend). */
  async findStalePaymentPendingIds(
    staleMinutes: number,
    limit = 50,
  ): Promise<string[]> {
    const threshold = Timestamp.fromDate(
      new Date(Date.now() - staleMinutes * 60 * 1000),
    );
    const snap = await this.collection
      .where("status", "==", CheckoutAttemptStatus.PAYMENT_PENDING)
      .where("updatedAt", "<=", threshold)
      .limit(limit)
      .get();

    return snap.docs.map((doc) => doc.id);
  }

  /** Devuelve IDs de intentos vencidos sin mutar estado (releaseAttempt marca terminal). */
  async findDueAttemptIds(limit = 100): Promise<string[]> {
    const now = Timestamp.now();
    const snap = await this.collection
      .where("status", "in", [
        CheckoutAttemptStatus.CREATED,
        CheckoutAttemptStatus.PAYMENT_PENDING,
        CheckoutAttemptStatus.PROCESSING,
      ])
      .where("expiresAt", "<=", now)
      .limit(limit)
      .get();

    return snap.docs.map((doc) => doc.id);
  }

  async tryFinalize(
    id: string,
    operationId: string,
  ): Promise<{ acquired: boolean; attempt: CheckoutAttempt }> {
    const ref = this.collection.doc(id);
    return firestoreTienda.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) {
        throw new Error(`CheckoutAttempt ${id} no encontrado`);
      }
      const attempt = { id: snap.id, ...(snap.data() as CheckoutAttempt) };
      if (
        attempt.status === CheckoutAttemptStatus.FINALIZED &&
        attempt.orderId
      ) {
        return { acquired: false, attempt };
      }
      const lockField = `finalization_${operationId}`;
      const data = snap.data() as Record<string, unknown>;
      if (data[lockField]) {
        return { acquired: false, attempt };
      }
      tx.update(ref, {
        [lockField]: true,
        status: CheckoutAttemptStatus.PAID,
        updatedAt: admin.firestore.Timestamp.now(),
      });
      return {
        acquired: true,
        attempt: { ...attempt, status: CheckoutAttemptStatus.PAID },
      };
    });
  }
}

const checkoutAttemptRepository = new CheckoutAttemptRepository();
export default checkoutAttemptRepository;
