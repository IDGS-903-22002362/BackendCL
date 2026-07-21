import { createHash } from "crypto";
import { admin } from "../../../config/firebase.admin";
import { firestoreTienda } from "../../../config/firebase";
import {
  AiSession,
  AiSessionStatus,
  ProductCategorySnapshot,
  ProductPreviewClassificationSource,
  ProductPreviewMode,
  ProductPreviewType,
  TryOnJob,
  TryOnJobStatus,
  TryOnAsset,
  TryOnAssetKind,
} from "../../../models/ai/ai.model";
import { RolUsuario } from "../../../models/usuario.model";
import AI_COLLECTIONS from "../collections";
import { AiRuntimeError, AI_TRYON_ASSET_UNAVAILABLE_CODE, AI_TRYON_IDEMPOTENCY_CONFLICT_CODE, AI_TRYON_SESSION_UNAVAILABLE_CODE } from "../ai.error";

const jobIdFor = (userId: string, key: string): string =>
  createHash("sha256").update(`${userId}\0${key}`).digest("hex");

class TryOnJobService {
  async createJob(input: {
    userId: string;
    sessionId: string;
    productId: string;
    variantId?: string;
    sku?: string;
    inputUserImageAssetId: string;
    inputUserImageUrl?: string;
    inputProductImageUrl: string;
    inputUserImageGeneration: string;
    inputProductImageGeneration: string;
    consentAccepted: boolean;
    consentVersion?: string;
    consentAcceptedAt?: FirebaseFirestore.Timestamp;
    idempotencyKey?: string;
    requestedByRole: RolUsuario;
    previewMode: ProductPreviewMode;
    productPreviewType: ProductPreviewType;
    classificationSource: ProductPreviewClassificationSource;
    productCategorySnapshot: ProductCategorySnapshot;
  }): Promise<TryOnJob> {
    const now = admin.firestore.Timestamp.now();
    const payload: Omit<TryOnJob, "id"> = {
      ...input,
      status: TryOnJobStatus.QUEUED,
      createdAt: now,
      updatedAt: now,
    };

    const jobs = firestoreTienda.collection(AI_COLLECTIONS.tryOnJobs);
    const ref = input.idempotencyKey
      ? jobs.doc(jobIdFor(input.userId, input.idempotencyKey))
      : jobs.doc();
    return firestoreTienda.runTransaction(async (transaction) => {
      const sessionRef = firestoreTienda.collection(AI_COLLECTIONS.sessions).doc(input.sessionId);
      const assetRef = firestoreTienda.collection(AI_COLLECTIONS.tryOnAssets).doc(input.inputUserImageAssetId);
      const [sessionSnap, jobSnap] = await Promise.all([
        transaction.get(sessionRef), transaction.get(ref),
      ]);
      const session = sessionSnap.data() as Omit<AiSession, "id"> | undefined;
      if (!sessionSnap.exists || session?.userId !== input.userId || session.status !== AiSessionStatus.ACTIVE) {
        throw new AiRuntimeError(AI_TRYON_SESSION_UNAVAILABLE_CODE, "Sesion AI no disponible para probador virtual", 404);
      }
      if (jobSnap.exists) {
        const existing = { id: ref.id, ...(jobSnap.data() as Omit<TryOnJob, "id">) };
        const exact = existing.userId === input.userId && existing.sessionId === input.sessionId &&
          existing.productId === input.productId && existing.inputUserImageAssetId === input.inputUserImageAssetId &&
          (existing.variantId ?? undefined) === (input.variantId ?? undefined) &&
          existing.consentAccepted === input.consentAccepted && existing.requestedByRole === input.requestedByRole &&
          existing.idempotencyKey === input.idempotencyKey;
        if (!exact) throw new AiRuntimeError(AI_TRYON_IDEMPOTENCY_CONFLICT_CODE, "La llave de idempotencia ya fue utilizada con otra solicitud", 409);
        return existing;
      }
      const assetSnap = await transaction.get(assetRef);
      const asset = assetSnap.data() as Omit<TryOnAsset, "id"> | undefined;
      if (!assetSnap.exists || asset?.userId !== input.userId || asset.sessionId !== input.sessionId ||
        asset.kind !== TryOnAssetKind.USER_UPLOAD || asset.jobId) {
        throw new AiRuntimeError(AI_TRYON_ASSET_UNAVAILABLE_CODE, "Imagen de usuario no disponible para probador virtual", 404);
      }
      transaction.set(ref, payload);
      transaction.update(assetRef, { jobId: ref.id, updatedAt: now });
      return { id: ref.id, ...payload };
    });
  }

  async getJobById(id: string): Promise<TryOnJob | null> {
    const snapshot = await firestoreTienda.collection(AI_COLLECTIONS.tryOnJobs).doc(id).get();
    if (!snapshot.exists) {
      return null;
    }

    return { id: snapshot.id, ...(snapshot.data() as Omit<TryOnJob, "id">) };
  }

  async findRecentJobByIdempotencyKey(
    userId: string,
    idempotencyKey: string,
    since: FirebaseFirestore.Timestamp,
  ): Promise<TryOnJob | null> {
    const snapshot = await firestoreTienda
      .collection(AI_COLLECTIONS.tryOnJobs)
      .where("userId", "==", userId)
      .where("idempotencyKey", "==", idempotencyKey)
      .where("createdAt", ">=", since)
      .orderBy("createdAt", "desc")
      .limit(1)
      .get();

    if (snapshot.empty) {
      return null;
    }

    const doc = snapshot.docs[0];
    return { id: doc.id, ...(doc.data() as Omit<TryOnJob, "id">) };
  }

  async listJobsByUser(userId: string): Promise<TryOnJob[]> {
    const snapshot = await firestoreTienda
      .collection(AI_COLLECTIONS.tryOnJobs)
      .where("userId", "==", userId)
      .orderBy("createdAt", "desc")
      .limit(50)
      .get();

    return snapshot.docs.map((doc) => ({
      id: doc.id,
      ...(doc.data() as Omit<TryOnJob, "id">),
    }));
  }

  async claimJobForProcessing(jobId: string): Promise<TryOnJob | null> {
    const ref = firestoreTienda.collection(AI_COLLECTIONS.tryOnJobs).doc(jobId);

    return firestoreTienda.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) {
        return null;
      }

      const job = {
        id: snapshot.id,
        ...(snapshot.data() as Omit<TryOnJob, "id">),
      };

      if (job.status !== TryOnJobStatus.QUEUED) {
        return null;
      }

      const now = admin.firestore.Timestamp.now();
      transaction.update(ref, {
        status: TryOnJobStatus.PROCESSING,
        errorCode: admin.firestore.FieldValue.delete(),
        errorMessage: admin.firestore.FieldValue.delete(),
        updatedAt: now,
      });

      return {
        ...job,
        status: TryOnJobStatus.PROCESSING,
        updatedAt: now,
      };
    });
  }

  async markProcessing(jobId: string, providerJobId?: string): Promise<void> {
    await firestoreTienda.collection(AI_COLLECTIONS.tryOnJobs).doc(jobId).update({
      status: TryOnJobStatus.PROCESSING,
      providerJobId,
      errorCode: admin.firestore.FieldValue.delete(),
      errorMessage: admin.firestore.FieldValue.delete(),
      updatedAt: admin.firestore.Timestamp.now(),
    });
  }

  async markCompleted(jobId: string, outputAssetId: string, outputImageUrl: string): Promise<void> {
    const now = admin.firestore.Timestamp.now();
    await firestoreTienda.collection(AI_COLLECTIONS.tryOnJobs).doc(jobId).update({
      status: TryOnJobStatus.COMPLETED,
      outputAssetId,
      outputImageUrl,
      errorCode: admin.firestore.FieldValue.delete(),
      errorMessage: admin.firestore.FieldValue.delete(),
      updatedAt: now,
      completedAt: now,
    });
  }

  async markFailed(jobId: string, errorCode: string, errorMessage: string): Promise<void> {
    await firestoreTienda.collection(AI_COLLECTIONS.tryOnJobs).doc(jobId).update({
      status: TryOnJobStatus.FAILED,
      errorCode,
      errorMessage,
      updatedAt: admin.firestore.Timestamp.now(),
    });
  }
}

export const tryOnJobService = new TryOnJobService();
export default tryOnJobService;
