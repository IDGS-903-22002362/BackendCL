import { Timestamp } from "firebase-admin/firestore";
import { firestoreTienda } from "../../config/firebase";
import { RecomendacionConfigGlobal } from "../../models/recomendaciones.model";
import { buildDefaultConfig } from "./recomendaciones.config";
import { recomendacionCollections } from "./collections";

class ConfigService {
  async getConfig(): Promise<RecomendacionConfigGlobal> {
    const snapshot = await firestoreTienda
      .collection(recomendacionCollections.config)
      .doc("global")
      .get();

    if (!snapshot.exists) {
      const defaults = buildDefaultConfig();
      const payload: RecomendacionConfigGlobal = {
        ...defaults,
        updatedAt: Timestamp.now(),
      };
      await snapshot.ref.set(payload);
      return payload;
    }

    return snapshot.data() as RecomendacionConfigGlobal;
  }

  async updateConfig(
    partial: Partial<RecomendacionConfigGlobal>,
    updatedBy?: string,
  ): Promise<RecomendacionConfigGlobal> {
    const current = await this.getConfig();
    const payload: RecomendacionConfigGlobal = {
      ...current,
      ...partial,
      id: "global",
      updatedAt: Timestamp.now(),
      updatedBy,
    };

    await firestoreTienda
      .collection(recomendacionCollections.config)
      .doc("global")
      .set(payload, { merge: true });

    return payload;
  }
}

export default new ConfigService();
