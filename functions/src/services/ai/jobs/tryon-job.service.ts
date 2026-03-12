import { admin } from "../../../config/firebase.admin";
import { firestoreTienda } from "../../../config/firebase";
import { RolUsuario } from "../../../models/usuario.model";
import { TryOnJob, TryOnJobStatus } from "../../../models/ai/ai.model";
import AI_COLLECTIONS from "../collections";

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
    consentAccepted: boolean;
    requestedByRole: RolUsuario;
  }): Promise<TryOnJob> {
    const now = admin.firestore.Timestamp.now();
    const payload: Omit<TryOnJob, "id"> = {
      ...input,
      status: TryOnJobStatus.QUEUED,
      createdAt: now,
      updatedAt: now,
    };

    const ref = await firestoreTienda.collection(AI_COLLECTIONS.tryOnJobs).add(payload);
    return { id: ref.id, ...payload };
  }

  async getJobById(id: string): Promise<TryOnJob | null> {
    const snapshot = await firestoreTienda.collection(AI_COLLECTIONS.tryOnJobs).doc(id).get();
    if (!snapshot.exists) {
      return null;
    }

    return { id: snapshot.id, ...(snapshot.data() as Omit<TryOnJob, "id">) };
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
