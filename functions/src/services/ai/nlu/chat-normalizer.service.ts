import {
  ConversationFilters,
  ConversationState,
  ResolvedReference,
} from "../../../models/ai/ai.model";
import {
  AUDIENCE_SYNONYMS,
  COLOR_SYNONYMS,
  POLICY_TOPICS,
  PRODUCT_PROFILE_TERMS,
  PRODUCT_TYPE_SYNONYMS,
  REFERENCE_TERMS,
  SIZE_SYNONYMS,
  normalizeLexiconTerm,
} from "./domain-lexicon";

export interface NormalizedChatMessage {
  originalText: string;
  normalizedText: string;
  tokens: string[];
  filters: ConversationFilters;
  references: ResolvedReference[];
  topics: string[];
  asksForRecommendation: boolean;
  asksForComparison: boolean;
  asksForStoreLocation: boolean;
  mentionsImage: boolean;
}

const collapseWhitespace = (value: string): string =>
  value.replace(/\s+/g, " ").trim();

const normalizeText = (value: string): string =>
  collapseWhitespace(
    normalizeLexiconTerm(value).replace(/[^\w\s]/g, " "),
  );

const includesTerm = (text: string, term: string): boolean =>
  text.includes(` ${term} `) ||
  text.startsWith(`${term} `) ||
  text.endsWith(` ${term}`) ||
  text === term;

const collectMatches = (
  text: string,
  source: Record<string, string[]>,
): string[] => {
  const matches = new Set<string>();

  for (const [canonical, aliases] of Object.entries(source)) {
    if (
      aliases.some((alias) => includesTerm(text, normalizeLexiconTerm(alias)))
    ) {
      matches.add(canonical);
    }
  }

  return Array.from(matches);
};

const resolvePricePreference = (
  normalizedText: string,
): ConversationFilters["pricePreference"] | undefined => {
  if (
    includesTerm(normalizedText, "barata") ||
    includesTerm(normalizedText, "economica") ||
    includesTerm(normalizedText, "economico")
  ) {
    return "lowest";
  }

  if (
    includesTerm(normalizedText, "premium") ||
    includesTerm(normalizedText, "elite")
  ) {
    return "premium";
  }

  return undefined;
};

const resolveReferences = (
  normalizedText: string,
  state?: ConversationState,
): ResolvedReference[] => {
  const references: ResolvedReference[] = [];

  if (
    REFERENCE_TERMS.recentProduct.some((term) =>
      includesTerm(normalizedText, normalizeLexiconTerm(term)),
    ) &&
    state?.recentProducts?.[0]
  ) {
    references.push({
      type: "product",
      sourceText: "recent_product_reference",
      resolvedId: state.recentProducts[0].productId,
      confidence: 0.92,
    });
  }

  if (includesTerm(normalizedText, "la primera") && state?.recentProducts?.[0]) {
    references.push({
      type: "product",
      sourceText: "la primera",
      resolvedId: state.recentProducts[0].productId,
      confidence: 0.88,
    });
  }

  if (includesTerm(normalizedText, "la segunda") && state?.recentProducts?.[1]) {
    references.push({
      type: "product",
      sourceText: "la segunda",
      resolvedId: state.recentProducts[1].productId,
      confidence: 0.88,
    });
  }

  if (
    REFERENCE_TERMS.priceSuperlative.some((term) =>
      includesTerm(normalizedText, normalizeLexiconTerm(term)),
    )
  ) {
    references.push({
      type: "product_list",
      sourceText: "lowest_price_reference",
      resolvedValue: "lowest_price",
      confidence: 0.8,
    });
  }

  if (includesTerm(normalizedText, "imagen")) {
    references.push({
      type: "image",
      sourceText: "imagen",
      confidence: state?.recentAttachments?.length ? 0.9 : 0.4,
    });
  }

  return references;
};

const detectTopics = (normalizedText: string): string[] => {
  const topics: string[] = [];

  for (const [topic, aliases] of Object.entries(POLICY_TOPICS)) {
    if (aliases.some((alias) => includesTerm(normalizedText, alias))) {
      topics.push(topic);
    }
  }

  return topics;
};

class ChatNormalizerService {
  normalize(
    message: string,
    state?: ConversationState,
  ): NormalizedChatMessage {
    const normalizedText = ` ${normalizeText(message)} `;
    const filters: ConversationFilters = {};

    const categoryIds = collectMatches(normalizedText, PRODUCT_TYPE_SYNONYMS);
    if (categoryIds.length > 0) {
      filters.categoryIds = categoryIds;
    }

    const audience = collectMatches(normalizedText, AUDIENCE_SYNONYMS);
    if (audience.length > 0) {
      filters.audience = audience;
      filters.lineIds = audience;
    }

    const colors = collectMatches(normalizedText, COLOR_SYNONYMS);
    if (colors.length > 0) {
      filters.colors = colors;
    }

    const sizeIds = collectMatches(normalizedText, SIZE_SYNONYMS);
    if (sizeIds.length > 0) {
      filters.sizeIds = sizeIds;
    } else if (state?.lastMentionedSizeId && includesTerm(normalizedText, "en")) {
      filters.sizeIds = [state.lastMentionedSizeId];
    }

    const profileTerms = collectMatches(normalizedText, PRODUCT_PROFILE_TERMS);
    const pricePreference = resolvePricePreference(normalizedText);
    if (pricePreference) {
      filters.pricePreference = pricePreference;
    }

    if (
      normalizedText.includes(" hay ") ||
      normalizedText.includes(" tienes ") ||
      normalizedText.includes(" disponible ")
    ) {
      filters.availability = "in_stock";
    }

    const normalizedQueryParts = [
      ...categoryIds,
      ...colors,
      ...profileTerms,
      ...audience,
    ];
    if (normalizedQueryParts.length > 0) {
      filters.normalizedQuery = normalizedQueryParts.join(" ");
    }

    const references = resolveReferences(normalizedText, state);
    const topics = detectTopics(normalizedText);

    return {
      originalText: message,
      normalizedText: normalizedText.trim(),
      tokens: normalizedText.trim().split(/\s+/).filter(Boolean),
      filters,
      references,
      topics,
      asksForRecommendation:
        normalizedText.includes(" recomend") || normalizedText.includes(" regalo "),
      asksForComparison:
        normalizedText.includes(" diferencia ") ||
        normalizedText.includes(" comparar "),
      asksForStoreLocation:
        normalizedText.includes(" donde ") ||
        normalizedText.includes(" ubicacion ") ||
        normalizedText.includes(" maps "),
      mentionsImage:
        normalizedText.includes(" imagen ") ||
        normalizedText.includes(" foto "),
    };
  }
}

export const chatNormalizerService = new ChatNormalizerService();
export default chatNormalizerService;
