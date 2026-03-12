import { firestoreTienda } from "../../../config/firebase";
import { PolicyDocument } from "../../../models/ai/ai.model";
import AI_COLLECTIONS from "../collections";

class PolicyService {
  async getPolicyById(id: string): Promise<PolicyDocument | null> {
    const snapshot = await firestoreTienda.collection(AI_COLLECTIONS.policies).doc(id).get();
    if (!snapshot.exists) {
      return null;
    }

    const data = snapshot.data() as Omit<PolicyDocument, "id">;
    if (!data.active) {
      return null;
    }

    return { id: snapshot.id, ...data };
  }

  async getShippingPolicy(): Promise<PolicyDocument | null> {
    return this.getPolicyById("envios");
  }

  async getReturnPolicy(): Promise<PolicyDocument | null> {
    return this.getPolicyById("devoluciones");
  }
}

export const policyService = new PolicyService();
export default policyService;
