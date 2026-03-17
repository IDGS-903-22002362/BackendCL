import { firestoreTienda } from "../../../config/firebase";
import {
  FaqEntry,
  KnowledgeDocument,
  PolicyDocument,
  PromotionDocument,
} from "../../../models/ai/ai.model";
import AI_COLLECTIONS from "../collections";
import faqService from "./faq.service";
import policyService from "./policy.service";
import promotionService from "./promotion.service";
import storeInfoService from "./store-info.service";

export interface RetrievedKnowledgeBundle {
  faq: FaqEntry[];
  policies: PolicyDocument[];
  knowledge: KnowledgeDocument[];
  promotions: PromotionDocument[];
  storeInfo?: Record<string, unknown>;
}

class KnowledgeRetrievalService {
  async findRelevantKnowledge(query: string): Promise<RetrievedKnowledgeBundle> {
    const normalizedQuery = query.trim();
    const [faq, shippingPolicy, returnPolicy, knowledge, promotions, storeInfo] =
      await Promise.all([
        faqService.search(normalizedQuery),
        policyService.getShippingPolicy(),
        policyService.getReturnPolicy(),
        this.searchKnowledgeDocuments(normalizedQuery),
        promotionService.listActivePromotions(),
        storeInfoService.getStoreInfo(),
      ]);

    return {
      faq,
      policies: [shippingPolicy, returnPolicy].filter(
        (item): item is PolicyDocument => item !== null,
      ),
      knowledge,
      promotions: promotions.filter((promotion) =>
        this.matchesText(
          normalizedQuery,
          `${promotion.title} ${promotion.description} ${promotion.tags.join(" ")}`,
        ),
      ),
      storeInfo,
    };
  }

  async searchKnowledgeDocuments(query: string): Promise<KnowledgeDocument[]> {
    const snapshot = await firestoreTienda
      .collection(AI_COLLECTIONS.knowledge)
      .where("active", "==", true)
      .get();

    return snapshot.docs
      .map((doc) => ({
        id: doc.id,
        ...(doc.data() as Omit<KnowledgeDocument, "id">),
      }))
      .filter((doc) =>
        this.matchesText(
          query,
          `${doc.title} ${doc.body} ${doc.tags.join(" ")}`,
        ),
      )
      .slice(0, 8);
  }

  private matchesText(query: string, content: string): boolean {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return true;
    }

    const normalizedContent = content.toLowerCase();
    return normalizedQuery
      .split(/\s+/)
      .filter(Boolean)
      .every((token) => normalizedContent.includes(token));
  }
}

export const knowledgeRetrievalService = new KnowledgeRetrievalService();
export default knowledgeRetrievalService;
