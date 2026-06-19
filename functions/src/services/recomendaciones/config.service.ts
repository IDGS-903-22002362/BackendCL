import { Timestamp } from "firebase-admin/firestore";
import { firestoreTienda } from "../../config/firebase";
import { RecomendacionConfigGlobal } from "../../models/recomendaciones.model";
import {
  buildDefaultConfig,
  RECOMENDACIONES_DEFAULT_CACHE_TTL_SECONDS,
} from "./recomendaciones.config";
import { recomendacionCollections } from "./collections";

function normalizeConfig(
  data?: Partial<RecomendacionConfigGlobal>,
): RecomendacionConfigGlobal {
  const defaults = buildDefaultConfig();
  const source = data ?? {};

  return {
    ...defaults,
    ...source,
    id: "global",
    secciones:
      Array.isArray(source.secciones) && source.secciones.length > 0
        ? source.secciones
        : defaults.secciones,
    pesos:
      Array.isArray(source.pesos) && source.pesos.length > 0
        ? source.pesos
        : defaults.pesos,
    exclusionGlobalProductoIds: source.exclusionGlobalProductoIds ?? [],
    retencionEventosDias:
      source.retencionEventosDias ?? defaults.retencionEventosDias,
    cacheTtlSegundos:
      source.cacheTtlSegundos ?? RECOMENDACIONES_DEFAULT_CACHE_TTL_SECONDS,
    diversificacionMaxPorCategoria:
      source.diversificacionMaxPorCategoria ??
      defaults.diversificacionMaxPorCategoria,
    diversificacionMaxPorLinea:
      source.diversificacionMaxPorLinea ?? defaults.diversificacionMaxPorLinea,
    updatedAt: source.updatedAt ?? Timestamp.now(),
  };
}

class ConfigService {
  async getConfig(): Promise<RecomendacionConfigGlobal> {
    const snapshot = await firestoreTienda
      .collection(recomendacionCollections.config)
      .doc("global")
      .get();

    if (!snapshot.exists) {
      const payload = normalizeConfig();
      await snapshot.ref.set(payload);
      return payload;
    }

    return normalizeConfig(snapshot.data() as Partial<RecomendacionConfigGlobal>);
  }

  async updateConfig(
    partial: Partial<RecomendacionConfigGlobal>,
    updatedBy?: string,
  ): Promise<RecomendacionConfigGlobal> {
    const current = await this.getConfig();
    const payload = normalizeConfig({
      ...current,
      ...partial,
      updatedBy,
    });

    await firestoreTienda
      .collection(recomendacionCollections.config)
      .doc("global")
      .set(payload, { merge: true });

    return payload;
  }
}

export default new ConfigService();