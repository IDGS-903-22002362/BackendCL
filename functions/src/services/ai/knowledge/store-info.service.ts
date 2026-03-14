import aiConfig from "../../../config/ai.config";
import { KnowledgeDocument } from "../../../models/ai/ai.model";
import storeConfigService from "./store-config.service";
import { firestoreTienda } from "../../../config/firebase";
import AI_COLLECTIONS from "../collections";

class StoreInfoService {
  async getStoreInfo(): Promise<Record<string, unknown>> {
    const [storeConfig, storeDocument] = await Promise.all([
      storeConfigService.getStoreConfig(),
      this.getKnowledgeDocument("store_info"),
    ]);

    return {
      name: storeConfig?.nombreTienda || "Tienda Oficial Club Leon",
      phone: storeConfig?.telefonoContacto || null,
      email: storeConfig?.emailContacto || null,
      openingHours: storeConfig?.horarioAtencion || null,
      shippingCost: storeConfig?.costoEnvio ?? null,
      freeShippingThreshold: storeConfig?.envioGratisMinimo ?? null,
      mapsUrl: aiConfig.storefront.mapsUrl,
      body: storeDocument?.body || null,
      metadata: storeDocument?.metadata || {},
    };
  }

  async getKnowledgeDocument(id: string): Promise<KnowledgeDocument | null> {
    const snapshot = await firestoreTienda
      .collection(AI_COLLECTIONS.knowledge)
      .doc(id)
      .get();

    if (!snapshot.exists) {
      return null;
    }

    const data = snapshot.data() as Omit<KnowledgeDocument, "id">;
    if (!data.active) {
      return null;
    }

    return { id: snapshot.id, ...data };
  }
}

export const storeInfoService = new StoreInfoService();
export default storeInfoService;
