import { firestoreTienda } from "../../../config/firebase";
import { admin } from "../../../config/firebase.admin";
import { PromotionDocument } from "../../../models/ai/ai.model";
import AI_COLLECTIONS from "../collections";

class PromotionService {
  async listActivePromotions(): Promise<PromotionDocument[]> {
    const now = admin.firestore.Timestamp.now();
    const snapshot = await firestoreTienda
      .collection(AI_COLLECTIONS.promotions)
      .where("active", "==", true)
      .get();

    return snapshot.docs
      .map((doc) => ({
        id: doc.id,
        ...(doc.data() as Omit<PromotionDocument, "id">),
      }))
      .filter((promotion) => {
        const startsAt = promotion.startsAt;
        const endsAt = promotion.endsAt;

        if (startsAt && startsAt.toMillis() > now.toMillis()) {
          return false;
        }

        if (endsAt && endsAt.toMillis() < now.toMillis()) {
          return false;
        }

        return true;
      })
      .slice(0, 10);
  }
}

export const promotionService = new PromotionService();
export default promotionService;
