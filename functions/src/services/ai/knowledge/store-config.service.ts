import { firestoreTienda } from "../../../config/firebase";
import { ConfiguracionTienda } from "../../../models/configuracion.model";

class StoreConfigService {
  async getStoreConfig(): Promise<ConfiguracionTienda | null> {
    const snapshot = await firestoreTienda.collection("configuracion").doc("tienda").get();
    if (!snapshot.exists) {
      return null;
    }

    return {
      id: snapshot.id,
      ...(snapshot.data() as Omit<ConfiguracionTienda, "id">),
    };
  }
}

export const storeConfigService = new StoreConfigService();
export default storeConfigService;
