import { firestoreTienda } from "../../../config/firebase";
import { FaqEntry } from "../../../models/ai/ai.model";
import AI_COLLECTIONS from "../collections";

class FaqService {
  async search(term: string): Promise<FaqEntry[]> {
    const normalized = term.trim().toLowerCase();
    const snapshot = await firestoreTienda
      .collection(AI_COLLECTIONS.faq)
      .where("active", "==", true)
      .get();

    return snapshot.docs
      .map((doc) => ({ id: doc.id, ...(doc.data() as Omit<FaqEntry, "id">) }))
      .filter((entry) => {
        return entry.question.toLowerCase().includes(normalized) ||
          entry.answer.toLowerCase().includes(normalized) ||
          entry.tags.some((tag) => tag.toLowerCase().includes(normalized));
      })
      .slice(0, 10);
  }
}

export const faqService = new FaqService();
export default faqService;
