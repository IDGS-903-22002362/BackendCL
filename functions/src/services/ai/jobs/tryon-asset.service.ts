import { admin } from "../../../config/firebase.admin";
import { firestoreTienda } from "../../../config/firebase";
import { TryOnAsset, TryOnAssetKind } from "../../../models/ai/ai.model";
import AI_COLLECTIONS from "../collections";

class TryOnAssetService {
  async createAsset(input: Omit<TryOnAsset, "id" | "createdAt" | "updatedAt">): Promise<TryOnAsset> {
    const now = admin.firestore.Timestamp.now();
    const payload: Omit<TryOnAsset, "id"> = {
      ...input,
      createdAt: now,
      updatedAt: now,
    };

    const ref = await firestoreTienda.collection(AI_COLLECTIONS.tryOnAssets).add(payload);
    return { id: ref.id, ...payload };
  }

  async attachJob(assetId: string, jobId: string, kind?: TryOnAssetKind): Promise<void> {
    const patch: Record<string, unknown> = {
      jobId,
      updatedAt: admin.firestore.Timestamp.now(),
    };

    if (kind) {
      patch.kind = kind;
    }

    await firestoreTienda.collection(AI_COLLECTIONS.tryOnAssets).doc(assetId).update(patch);
  }

  async getAssetById(id: string): Promise<TryOnAsset | null> {
    const snapshot = await firestoreTienda.collection(AI_COLLECTIONS.tryOnAssets).doc(id).get();
    if (!snapshot.exists) {
      return null;
    }

    return { id: snapshot.id, ...(snapshot.data() as Omit<TryOnAsset, "id">) };
  }
}

export const tryOnAssetService = new TryOnAssetService();
export default tryOnAssetService;
