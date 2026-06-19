import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { firestoreTienda } from "../../config/firebase";
import { RecomendacionVisitante } from "../../models/recomendaciones.model";
import { recomendacionCollections } from "./collections";

class VisitorService {
  private buildVisitanteId(sessionId?: string, usuarioId?: string | null): string {
    if (usuarioId) {
      return `user:${usuarioId}`;
    }

    if (sessionId) {
      return `anon:${sessionId}`;
    }

    return `anon:unknown_${Date.now()}`;
  }

  async resolveVisitante(params: {
    sessionId?: string;
    usuarioId?: string | null;
  }): Promise<{ visitanteId: string; docId: string }> {
    const visitanteId = this.buildVisitanteId(params.sessionId, params.usuarioId);
    const docRef = firestoreTienda
      .collection(recomendacionCollections.visitantes)
      .doc(visitanteId);

    const snapshot = await docRef.get();
    const now = Timestamp.now();

    if (!snapshot.exists) {
      const payload: RecomendacionVisitante = {
        visitanteId,
        sessionIds: params.sessionId ? [params.sessionId] : [],
        usuarioId: params.usuarioId ?? null,
        mergedAt: null,
        ultimoEventoAt: now,
        createdAt: now,
        updatedAt: now,
      };

      await docRef.set(payload);
      return { visitanteId, docId: visitanteId };
    }

    const updates: Record<string, unknown> = {
      updatedAt: now,
      ultimoEventoAt: now,
    };

    if (params.sessionId) {
      updates.sessionIds = FieldValue.arrayUnion(params.sessionId);
    }

    if (params.usuarioId) {
      updates.usuarioId = params.usuarioId;
    }

    await docRef.update(updates);
    return { visitanteId, docId: visitanteId };
  }

  async mergeAnonymousToUser(params: {
    sessionId: string;
    usuarioId: string;
  }): Promise<void> {
    const anonId = this.buildVisitanteId(params.sessionId, null);
    const userId = this.buildVisitanteId(undefined, params.usuarioId);
    const now = Timestamp.now();

    const [anonDoc, userDoc] = await Promise.all([
      firestoreTienda.collection(recomendacionCollections.visitantes).doc(anonId).get(),
      firestoreTienda.collection(recomendacionCollections.visitantes).doc(userId).get(),
    ]);

    if (!anonDoc.exists) {
      await this.resolveVisitante({
        sessionId: params.sessionId,
        usuarioId: params.usuarioId,
      });
      return;
    }

    const anonData = anonDoc.data() as RecomendacionVisitante;
    const userData = userDoc.exists
      ? (userDoc.data() as RecomendacionVisitante)
      : null;

    const mergedSessionIds = Array.from(
      new Set([
        ...(userData?.sessionIds ?? []),
        ...(anonData.sessionIds ?? []),
        params.sessionId,
      ]),
    );

    await firestoreTienda
      .collection(recomendacionCollections.visitantes)
      .doc(userId)
      .set(
        {
          visitanteId: userId,
          sessionIds: mergedSessionIds,
          usuarioId: params.usuarioId,
          mergedAt: now,
          ultimoEventoAt: now,
          createdAt: userData?.createdAt ?? now,
          updatedAt: now,
        },
        { merge: true },
      );

    await firestoreTienda
      .collection(recomendacionCollections.eventos)
      .where("visitanteId", "==", anonId)
      .limit(200)
      .get()
      .then(async (snapshot) => {
        if (snapshot.empty) {
          return;
        }

        const batch = firestoreTienda.batch();
        snapshot.docs.forEach((doc) => {
          batch.update(doc.ref, {
            visitanteId: userId,
            usuarioId: params.usuarioId,
          });
        });
        await batch.commit();
      });
  }
}

export default new VisitorService();
