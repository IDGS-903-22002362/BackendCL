import { DocumentReference, Timestamp } from "firebase-admin/firestore";
import { firestoreTienda } from "../../config/firebase";
import {
  RecomendacionCacheDocumento,
  RecomendacionEstrategia,
} from "../../models/recomendaciones.model";
import { recomendacionCollections } from "./collections";

class CacheService {
  buildContextKey(parts: Record<string, unknown>): string {
    return Object.entries(parts)
      .filter(([, value]) => value !== undefined && value !== null && value !== "")
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `${key}:${Array.isArray(value) ? value.join(",") : String(value)}`)
      .join("|");
  }

  async getCachedProductIds(
    contextKey: string,
    estrategia: RecomendacionEstrategia,
  ): Promise<string[] | null> {
    const cacheId = `${estrategia}__${contextKey}`.slice(0, 500);
    const snapshot = await firestoreTienda
      .collection(recomendacionCollections.cache)
      .doc(cacheId)
      .get();

    if (!snapshot.exists) {
      return null;
    }

    const data = snapshot.data() as RecomendacionCacheDocumento;
    if (data.expiresAt.toMillis() <= Date.now()) {
      await snapshot.ref.delete();
      return null;
    }

    return data.productoIds;
  }

  async setCachedProductIds(params: {
    contextKey: string;
    estrategia: RecomendacionEstrategia;
    productoIds: string[];
    ttlSeconds: number;
  }): Promise<void> {
    const cacheId = `${params.estrategia}__${params.contextKey}`.slice(0, 500);
    const now = Timestamp.now();
    const payload: RecomendacionCacheDocumento = {
      id: cacheId,
      contextKey: params.contextKey,
      estrategia: params.estrategia,
      productoIds: params.productoIds,
      createdAt: now,
      expiresAt: Timestamp.fromDate(new Date(Date.now() + params.ttlSeconds * 1000)),
    };

    await firestoreTienda
      .collection(recomendacionCollections.cache)
      .doc(cacheId)
      .set(payload);
  }

  async invalidateByProductoId(productoId: string): Promise<void> {
    const [byContextKey, byProductIds] = await Promise.all([
      firestoreTienda
        .collection(recomendacionCollections.cache)
        .where("contextKey", ">=", `productoId:${productoId}`)
        .where("contextKey", "<=", `productoId:${productoId}\uf8ff`)
        .limit(50)
        .get(),
      firestoreTienda
        .collection(recomendacionCollections.cache)
        .where("productoIds", "array-contains", productoId)
        .limit(50)
        .get(),
    ]);

    const refs = new Map<string, DocumentReference>();
    byContextKey.docs.forEach((doc) => refs.set(doc.id, doc.ref));
    byProductIds.docs.forEach((doc) => refs.set(doc.id, doc.ref));

    if (refs.size === 0) {
      return;
    }

    const batch = firestoreTienda.batch();
    refs.forEach((ref) => batch.delete(ref));
    await batch.commit();
  }

  async invalidateByUsuarioId(usuarioId: string): Promise<void> {
    const snapshot = await firestoreTienda
      .collection(recomendacionCollections.cache)
      .where("contextKey", ">=", `usuarioId:${usuarioId}`)
      .where("contextKey", "<=", `usuarioId:${usuarioId}\uf8ff`)
      .limit(100)
      .get();

    if (snapshot.empty) {
      return;
    }

    const batch = firestoreTienda.batch();
    snapshot.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
  }

  async invalidateByEstrategias(estrategias: RecomendacionEstrategia[]): Promise<void> {
    if (estrategias.length === 0) {
      return;
    }

    const batch = firestoreTienda.batch();
    let writes = 0;

    for (const estrategia of estrategias) {
      const snapshot = await firestoreTienda
        .collection(recomendacionCollections.cache)
        .where("estrategia", "==", estrategia)
        .limit(100)
        .get();

      snapshot.docs.forEach((doc) => {
        batch.delete(doc.ref);
        writes += 1;
      });
    }

    if (writes === 0) {
      return;
    }

    await batch.commit();
  }

  async invalidateAll(batchSize = 200): Promise<number> {
    const snapshot = await firestoreTienda
      .collection(recomendacionCollections.cache)
      .limit(batchSize)
      .get();

    if (snapshot.empty) {
      return 0;
    }

    const batch = firestoreTienda.batch();
    snapshot.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
    return snapshot.size;
  }

  async cleanupExpired(batchSize = 200): Promise<number> {
    const now = Timestamp.now();
    const snapshot = await firestoreTienda
      .collection(recomendacionCollections.cache)
      .where("expiresAt", "<=", now)
      .limit(batchSize)
      .get();

    if (snapshot.empty) {
      return 0;
    }

    const batch = firestoreTienda.batch();
    snapshot.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
    return snapshot.size;
  }
}

export default new CacheService();
