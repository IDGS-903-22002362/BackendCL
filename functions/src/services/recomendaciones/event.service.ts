import { Timestamp } from "firebase-admin/firestore";
import { firestoreTienda } from "../../config/firebase";
import {
  RecomendacionEvento,
  RecomendacionEventoTipo,
  RecomendacionEstrategia,
} from "../../models/recomendaciones.model";
import {
  RECOMENDACIONES_DEFAULT_RETENTION_DAYS,
  RECOMENDACIONES_MAX_EVENTOS_POR_MINUTO,
} from "./recomendaciones.config";
import { recomendacionCollections } from "./collections";
import visitorService from "./visitor.service";
import metricsService from "./metrics.service";
import configService from "./config.service";
import cacheService from "./cache.service";

type TrackEventInput = Omit<
  RecomendacionEvento,
  "id" | "createdAt" | "expiresAt" | "visitanteId"
> & {
  sessionId?: string;
};

class EventService {
  private readonly rateLimitStore = new Map<string, { count: number; expiresAt: number }>();

  private isRateLimited(key: string): boolean {
    const now = Date.now();
    const current = this.rateLimitStore.get(key);

    if (!current || current.expiresAt <= now) {
      this.rateLimitStore.set(key, {
        count: 1,
        expiresAt: now + 60_000,
      });
      return false;
    }

    if (current.count >= RECOMENDACIONES_MAX_EVENTOS_POR_MINUTO) {
      return true;
    }

    current.count += 1;
    this.rateLimitStore.set(key, current);
    return false;
  }

  async trackEvent(input: TrackEventInput): Promise<{ accepted: boolean }> {
    const rateKey = `${input.usuarioId || input.sessionId || "unknown"}:${input.tipo}`;
    if (this.isRateLimited(rateKey)) {
      return { accepted: false };
    }

    const config = await configService.getConfig();
    const { visitanteId } = await visitorService.resolveVisitante({
      sessionId: input.sessionId,
      usuarioId: input.usuarioId,
    });

    const now = Timestamp.now();
    const retentionDays = config.retencionEventosDias || RECOMENDACIONES_DEFAULT_RETENTION_DAYS;
    const expiresAt = Timestamp.fromDate(
      new Date(Date.now() + retentionDays * 24 * 60 * 60 * 1000),
    );

    const payload: RecomendacionEvento = {
      ...input,
      visitanteId,
      createdAt: now,
      expiresAt,
    };

    await firestoreTienda.collection(recomendacionCollections.eventos).add(payload);
    await metricsService.incrementFromEvent(payload);

    if (input.tipo === RecomendacionEventoTipo.VISTA_PRODUCTO) {
      await cacheService.invalidateByEstrategias([
        RecomendacionEstrategia.RECIENTEMENTE_VISTOS,
        RecomendacionEstrategia.PARA_TI,
      ]);
    }

    return { accepted: true };
  }

  async trackEventsBatch(
    events: TrackEventInput[],
  ): Promise<{ accepted: number; rejected: number }> {
    let accepted = 0;
    let rejected = 0;

    for (const event of events.slice(0, 20)) {
      const result = await this.trackEvent(event);
      if (result.accepted) {
        accepted += 1;
      } else {
        rejected += 1;
      }
    }

    return { accepted, rejected };
  }

  async listRecentProductIds(params: {
    visitanteId?: string;
    usuarioId?: string | null;
    tipos?: RecomendacionEventoTipo[];
    limit?: number;
    days?: number;
  }): Promise<string[]> {
    const limit = params.limit ?? 20;
    const days = params.days ?? 30;
    const cutoff = Timestamp.fromDate(new Date(Date.now() - days * 24 * 60 * 60 * 1000));
    const tipos = params.tipos ?? [
      RecomendacionEventoTipo.VISTA_PRODUCTO,
      RecomendacionEventoTipo.CLIC_PRODUCTO,
      RecomendacionEventoTipo.CLIC_RECOMENDACION,
    ];

    let query = firestoreTienda
      .collection(recomendacionCollections.eventos)
      .where("createdAt", ">=", cutoff)
      .orderBy("createdAt", "desc")
      .limit(100);

    if (params.visitanteId) {
      query = firestoreTienda
        .collection(recomendacionCollections.eventos)
        .where("visitanteId", "==", params.visitanteId)
        .where("createdAt", ">=", cutoff)
        .orderBy("createdAt", "desc")
        .limit(100);
    } else if (params.usuarioId) {
      query = firestoreTienda
        .collection(recomendacionCollections.eventos)
        .where("usuarioId", "==", params.usuarioId)
        .where("createdAt", ">=", cutoff)
        .orderBy("createdAt", "desc")
        .limit(100);
    }

    const snapshot = await query.get();
    const productIds: string[] = [];

    for (const doc of snapshot.docs) {
      const data = doc.data() as RecomendacionEvento;
      if (!tipos.includes(data.tipo)) {
        continue;
      }

      if (data.productoId) {
        productIds.push(String(data.productoId));
      }

      if (Array.isArray(data.productoIds)) {
        productIds.push(...data.productoIds.map(String));
      }
    }

    return Array.from(new Set(productIds)).slice(0, limit);
  }

  async clearViewHistory(params: {
    usuarioId?: string | null;
    sessionId?: string;
  }): Promise<{ deleted: number }> {
    const { visitanteId } = await visitorService.resolveVisitante({
      sessionId: params.sessionId,
      usuarioId: params.usuarioId,
    });

    const viewTipos = [
      RecomendacionEventoTipo.VISTA_PRODUCTO,
      RecomendacionEventoTipo.CLIC_PRODUCTO,
      RecomendacionEventoTipo.CLIC_RECOMENDACION,
    ];

    let deleted = 0;
    let hasMore = true;

    while (hasMore) {
      let query = firestoreTienda
        .collection(recomendacionCollections.eventos)
        .where("visitanteId", "==", visitanteId)
        .limit(100);

      if (params.usuarioId) {
        query = firestoreTienda
          .collection(recomendacionCollections.eventos)
          .where("usuarioId", "==", params.usuarioId)
          .limit(100);
      }

      const snapshot = await query.get();
      if (snapshot.empty) {
        break;
      }

      const batch = firestoreTienda.batch();
      let batchDeletes = 0;

      snapshot.docs.forEach((doc) => {
        const data = doc.data() as RecomendacionEvento;
        if (viewTipos.includes(data.tipo)) {
          batch.delete(doc.ref);
          batchDeletes += 1;
        }
      });

      if (batchDeletes === 0) {
        hasMore = false;
        break;
      }

      await batch.commit();
      deleted += batchDeletes;
      hasMore = snapshot.size >= 100;
    }

    return { deleted };
  }

  async cleanupExpiredEvents(batchSize = 300): Promise<number> {
    const now = Timestamp.now();
    const snapshot = await firestoreTienda
      .collection(recomendacionCollections.eventos)
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

export default new EventService();
