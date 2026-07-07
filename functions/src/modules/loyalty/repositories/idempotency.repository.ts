import { Transaction } from "firebase-admin/firestore";
import { firestoreApp } from "../../../config/app.firebase";
import { admin } from "../../../config/firebase.admin";
import { LOYALTY_COLLECTIONS } from "../constants/loyalty.constants";
import {
  ExternalTxnIndexRecord,
  IdempotencyRecord,
} from "../models/loyalty.types";

export class IdempotencyRepository {
  private collection = firestoreApp.collection(LOYALTY_COLLECTIONS.IDEMPOTENCY);

  buildDocId(operation: string, actorId: string, idempotencyKeyHash: string): string {
    const safeOperation = encodeURIComponent(operation.trim());
    const safeActorId = encodeURIComponent(actorId.trim());
    return `${safeOperation}:${safeActorId}:${idempotencyKeyHash}`;
  }

  docRef(docId: string) {
    return this.collection.doc(docId);
  }

  async get(docId: string): Promise<IdempotencyRecord | null> {
    const snap = await this.collection.doc(docId).get();
    if (!snap.exists) return null;
    return snap.data() as IdempotencyRecord;
  }

  async getInTx(tx: Transaction, docId: string): Promise<IdempotencyRecord | null> {
    const snap = await tx.get(this.collection.doc(docId));
    if (!snap.exists) return null;
    return snap.data() as IdempotencyRecord;
  }

  saveInTx(
    tx: Transaction,
    docId: string,
    record: Omit<IdempotencyRecord, "createdAt">,
  ): void {
    tx.create(this.collection.doc(docId), {
      ...record,
      createdAt: admin.firestore.Timestamp.now(),
    });
  }

  async save(
    docId: string,
    record: Omit<IdempotencyRecord, "createdAt">,
  ): Promise<boolean> {
    try {
      await this.collection.doc(docId).create({
        ...record,
        createdAt: admin.firestore.Timestamp.now(),
      });
      return true;
    } catch (error) {
      const code = (error as { code?: number }).code;
      if (code === 6 || code === 409) {
        return false;
      }
      throw error;
    }
  }
}

export class ExternalTxnRepository {
  private collection = firestoreApp.collection(
    LOYALTY_COLLECTIONS.EXTERNAL_TXN_INDEX,
  );

  docRef(key: string) {
    return this.collection.doc(key);
  }

  async get(key: string): Promise<ExternalTxnIndexRecord | null> {
    const snap = await this.collection.doc(key).get();
    if (!snap.exists) return null;
    return snap.data() as ExternalTxnIndexRecord;
  }

  async getInTx(
    tx: Transaction,
    key: string,
  ): Promise<ExternalTxnIndexRecord | null> {
    const snap = await tx.get(this.collection.doc(key));
    if (!snap.exists) return null;
    return snap.data() as ExternalTxnIndexRecord;
  }

  createInTx(
    tx: Transaction,
    key: string,
    payload: ExternalTxnIndexRecord,
  ): void {
    tx.create(this.collection.doc(key), payload);
  }

  async claim(
    key: string,
    payload: ExternalTxnIndexRecord,
  ): Promise<"claimed" | "duplicate"> {
    try {
      await this.collection.doc(key).create(payload);
      return "claimed";
    } catch (error) {
      const code = (error as { code?: number }).code;
      if (code === 6 || code === 409) {
        return "duplicate";
      }
      throw error;
    }
  }

  setInTx(
    tx: Transaction,
    key: string,
    payload: ExternalTxnIndexRecord,
  ): void {
    tx.set(this.collection.doc(key), payload, { merge: true });
  }
}

export const idempotencyRepository = new IdempotencyRepository();
export const externalTxnRepository = new ExternalTxnRepository();
export default idempotencyRepository;
