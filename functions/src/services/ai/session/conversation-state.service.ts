import {
  AiAttachment,
  ChatPlanSessionUpdates,
  ConversationState,
  ProductCandidateReference,
} from "../../../models/ai/ai.model";
import { NormalizedChatMessage } from "../nlu/chat-normalizer.service";

type ToolOutputSummary = {
  toolName: string;
  output?: Record<string, unknown>;
};

const uniqueProducts = (
  products: ProductCandidateReference[],
): ProductCandidateReference[] => {
  const seen = new Set<string>();
  const result: ProductCandidateReference[] = [];

  for (const product of products) {
    if (seen.has(product.productId)) {
      continue;
    }
    seen.add(product.productId);
    result.push(product);
  }

  return result.slice(0, 6);
};

class ConversationStateService {
  merge(input: {
    previous?: ConversationState;
    normalized: NormalizedChatMessage;
    sessionUpdates?: ChatPlanSessionUpdates;
    attachments?: AiAttachment[];
    toolOutputs?: ToolOutputSummary[];
  }): ConversationState {
    const previous = input.previous || {};
    const next: ConversationState = {
      ...previous,
      lastUserMessage: input.normalized.originalText,
      lastNormalizedMessage: input.normalized.normalizedText,
      activeFilters: {
        ...(previous.activeFilters || {}),
        ...(input.normalized.filters || {}),
        ...(input.sessionUpdates?.activeFilters || {}),
      },
      preferredLanguage:
        input.sessionUpdates?.preferredLanguage || previous.preferredLanguage || "es-MX",
      tone: input.sessionUpdates?.tone || previous.tone || "commercial",
    };

    if (input.sessionUpdates?.currentIntent) {
      next.currentIntent = input.sessionUpdates.currentIntent;
    }

    if (input.sessionUpdates?.lastCategoryId) {
      next.lastCategoryId = input.sessionUpdates.lastCategoryId;
    } else if (input.normalized.filters.categoryIds?.[0]) {
      next.lastCategoryId = input.normalized.filters.categoryIds[0];
    }

    if (input.sessionUpdates?.lastCollectionId) {
      next.lastCollectionId = input.sessionUpdates.lastCollectionId;
    }

    if (input.sessionUpdates?.lastMentionedColor) {
      next.lastMentionedColor = input.sessionUpdates.lastMentionedColor;
    } else if (input.normalized.filters.colors?.[0]) {
      next.lastMentionedColor = input.normalized.filters.colors[0];
    }

    if (input.sessionUpdates?.lastMentionedSizeId) {
      next.lastMentionedSizeId = input.sessionUpdates.lastMentionedSizeId;
    } else if (input.normalized.filters.sizeIds?.[0]) {
      next.lastMentionedSizeId = input.normalized.filters.sizeIds[0];
    }

    if (input.sessionUpdates?.lastResolvedProductId) {
      next.lastResolvedProductId = input.sessionUpdates.lastResolvedProductId;
    } else if (input.normalized.references[0]?.resolvedId) {
      next.lastResolvedProductId = input.normalized.references[0].resolvedId;
    }

    next.pendingClarification =
      input.sessionUpdates?.pendingClarification !== undefined
        ? input.sessionUpdates.pendingClarification
        : previous.pendingClarification || null;

    if (input.attachments?.length) {
      next.recentAttachments = input.attachments.slice(-3);
    }

    const recentProducts: ProductCandidateReference[] = [
      ...(previous.recentProducts || []),
      ...this.extractProductsFromToolOutputs(input.toolOutputs || []),
    ];
    if (recentProducts.length > 0) {
      next.recentProducts = uniqueProducts(recentProducts.reverse()).reverse();
      if (!next.lastResolvedProductId && next.recentProducts[0]) {
        next.lastResolvedProductId = next.recentProducts[0].productId;
      }
    }

    const topics = new Set<string>([
      ...(previous.recentKnowledgeTopics || []),
      ...input.normalized.topics,
    ]);
    next.recentKnowledgeTopics = Array.from(topics).slice(-8);

    return next;
  }

  private extractProductsFromToolOutputs(
    toolOutputs: ToolOutputSummary[],
  ): ProductCandidateReference[] {
    const products: ProductCandidateReference[] = [];

    for (const toolOutput of toolOutputs) {
      if (!toolOutput.output) {
        continue;
      }

      const candidates = [
        ...this.toProductRefs(toolOutput.output.product),
        ...this.toProductRefs(toolOutput.output.products),
        ...this.toProductRefs(toolOutput.output.recommendations),
      ];
      products.push(...candidates);
    }

    return products;
  }

  private toProductRefs(value: unknown): ProductCandidateReference[] {
    if (!value) {
      return [];
    }

    const values = Array.isArray(value) ? value : [value];
    return values
      .map((item) => {
        if (typeof item !== "object" || item === null) {
          return null;
        }

        const record = item as Record<string, unknown>;
        const productId =
          typeof record.productId === "string"
            ? record.productId
            : typeof record.id === "string"
              ? record.id
              : undefined;

        if (!productId) {
          return null;
        }

        const candidate: ProductCandidateReference = {
          productId,
          score:
            typeof record.score === "number" ? record.score : undefined,
          reason:
            typeof record.reason === "string" ? record.reason : undefined,
          canonicalLink:
            typeof record.canonicalLink === "string"
              ? record.canonicalLink
              : typeof record.url === "string"
                ? record.url
                : null,
          price:
            typeof record.precioPublico === "number"
              ? record.precioPublico
              : typeof record.price === "number"
                ? record.price
                : undefined,
          inStock:
            typeof record.inStock === "boolean"
              ? record.inStock
              : undefined,
        };

        return candidate;
      })
      .filter((item): item is ProductCandidateReference => item !== null);
  }
}

export const conversationStateService = new ConversationStateService();
export default conversationStateService;
