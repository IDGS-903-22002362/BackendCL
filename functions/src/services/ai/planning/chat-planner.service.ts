import { zodToJsonSchema } from "zod-to-json-schema";
import aiConfig from "../../../config/ai.config";
import { ChatPlan, ConversationState } from "../../../models/ai/ai.model";
import logger from "../../../utils/logger";
import { AI_PLANNER_INSTRUCTIONS } from "../ai.prompts";
import geminiAdapter from "../adapters/gemini.adapter";
import { RuntimeAiToolDefinition } from "../tools/types";
import {
  NormalizedChatMessage,
  chatNormalizerService,
} from "../nlu/chat-normalizer.service";
import { chatPlanSchema } from "./chat-plan.schema";

export interface PlanChatInput {
  message: string;
  sessionState?: ConversationState;
  allowedTools: RuntimeAiToolDefinition[];
  sessionMode: "authenticated" | "guest";
  requestId?: string;
}

class ChatPlannerService {
  private readonly baseLogger = logger.child({ component: "chat-planner" });

  async plan(input: PlanChatInput): Promise<{
    normalized: NormalizedChatMessage;
    plan: ChatPlan;
  }> {
    const normalized = chatNormalizerService.normalize(
      input.message,
      input.sessionState,
    );
    const fallbackPlan = this.buildFallbackPlan({
      normalized,
      sessionState: input.sessionState,
      allowedTools: input.allowedTools,
      sessionMode: input.sessionMode,
    });

    try {
      const responseJsonSchema = zodToJsonSchema(chatPlanSchema, {
        target: "jsonSchema7",
        $refStrategy: "none",
      }) as Record<string, unknown>;
      delete responseJsonSchema.$schema;
      delete responseJsonSchema.definitions;
      delete responseJsonSchema.$defs;

      const toolSummary = input.allowedTools.map((tool) => ({
        name: tool.name,
        description: tool.description,
      }));

      const rawPlan = await geminiAdapter.generateStructured<ChatPlan>({
        model: aiConfig.gemini.fastModel,
        systemInstruction: AI_PLANNER_INSTRUCTIONS,
        prompt: JSON.stringify(
          {
            sessionMode: input.sessionMode,
            message: input.message,
            normalized,
            sessionState: input.sessionState || {},
            allowedTools: toolSummary,
            fallbackGuidance: fallbackPlan,
          },
          null,
          2,
        ),
        responseJsonSchema,
      });

      const parsed = chatPlanSchema.parse(rawPlan);
      return {
        normalized,
        plan: parsed,
      };
    } catch (error) {
      this.baseLogger.warn("chat_planner_fallback", {
        requestId: input.requestId,
        message: error instanceof Error ? error.message : String(error),
      });

      return {
        normalized,
        plan: fallbackPlan,
      };
    }
  }

  private buildFallbackPlan(input: {
    normalized: NormalizedChatMessage;
    sessionState?: ConversationState;
    allowedTools: RuntimeAiToolDefinition[];
    sessionMode: "authenticated" | "guest";
  }): ChatPlan {
    const toolCalls: ChatPlan["toolCalls"] = [];
    const hasTool = (toolName: string) =>
      input.allowedTools.some((tool) => tool.name === toolName);
    const firstResolvedProductId =
      input.normalized.references.find((reference) => reference.resolvedId)
        ?.resolvedId || input.sessionState?.lastResolvedProductId;
    const orderIdMatch = input.normalized.originalText.match(
      /\b[a-zA-Z0-9_-]{6,}\b/,
    );
    const candidateOrderId = orderIdMatch?.[0];
    const needsProductContext =
      input.normalized.filters.sizeIds?.length ||
      input.normalized.mentionsImage ||
      input.normalized.asksForComparison;

    if (input.normalized.topics.includes("store") || input.normalized.asksForStoreLocation) {
      if (hasTool("get_store_info")) {
        toolCalls.push({ toolName: "get_store_info", arguments: {} });
      }
    }

    if (input.normalized.topics.includes("promotions")) {
      if (hasTool("get_promotions")) {
        toolCalls.push({ toolName: "get_promotions", arguments: { activeOnly: true } });
      }
    }

    if (input.normalized.topics.includes("shipping")) {
      if (hasTool("get_shipping_info")) {
        toolCalls.push({ toolName: "get_shipping_info", arguments: {} });
      }
    }

    if (input.normalized.topics.includes("returns")) {
      if (hasTool("get_return_policy")) {
        toolCalls.push({ toolName: "get_return_policy", arguments: {} });
      }
    }

    if (input.normalized.topics.includes("payments")) {
      if (hasTool("get_payment_methods")) {
        toolCalls.push({ toolName: "get_payment_methods", arguments: {} });
      }
    }

    if (input.normalized.topics.includes("tracking")) {
      if (candidateOrderId && hasTool("get_order_status")) {
        toolCalls.push({
          toolName: "get_order_status",
          arguments: { orderId: candidateOrderId },
        });
      }
    }

    if (
      input.normalized.filters.categoryIds?.length ||
      input.normalized.filters.colors?.length ||
      input.normalized.asksForRecommendation
    ) {
      if (hasTool("search_products")) {
        toolCalls.push({
          toolName: "search_products",
          arguments: {
            query:
              input.normalized.originalText,
            filters: input.normalized.filters,
          },
        });
      }
    }

    if (needsProductContext && firstResolvedProductId) {
      if (hasTool("get_product_detail")) {
        toolCalls.push({
          toolName: "get_product_detail",
          arguments: { productId: firstResolvedProductId },
        });
      }
      if (input.normalized.filters.sizeIds?.length && hasTool("get_product_stock")) {
        toolCalls.push({
          toolName: "get_product_stock",
          arguments: {
            productId: firstResolvedProductId,
            sizeId: input.normalized.filters.sizeIds[0],
          },
        });
      }
    }

    if (
      input.normalized.mentionsImage &&
      hasTool("detect_image_referenced_product")
    ) {
      toolCalls.push({
        toolName: "detect_image_referenced_product",
        arguments: {},
      });
    }

    const needsClarification =
      (toolCalls.length === 0 &&
        needsProductContext &&
        !firstResolvedProductId) ||
      (input.normalized.topics.includes("tracking") && !candidateOrderId);
    const clarificationQuestion = input.normalized.topics.includes("tracking")
      ? candidateOrderId
        ? null
        : "Claro. Para revisar tu pedido comparteme el ID del pedido y, si no has iniciado sesion, tambien el telefono asociado."
      : needsClarification
        ? "Te ayudo. ¿De cual producto hablas exactamente: el jersey local, visitante, infantil u otra opcion?"
        : null;

    return {
      intent: this.resolveIntent(input.normalized),
      confidence: needsClarification ? 0.45 : 0.78,
      requiresTools: toolCalls.length > 0,
      toolCalls,
      needsClarification,
      clarificationQuestion,
      sessionUpdates: {
        currentIntent: this.resolveIntent(input.normalized),
        activeFilters: input.normalized.filters,
        lastCategoryId: input.normalized.filters.categoryIds?.[0],
        lastMentionedSizeId: input.normalized.filters.sizeIds?.[0],
        lastMentionedColor: input.normalized.filters.colors?.[0],
        lastResolvedProductId: firstResolvedProductId,
        pendingClarification: clarificationQuestion
          ? {
              type: "product",
              question: clarificationQuestion,
            }
          : null,
        preferredLanguage: "es-MX",
        tone: input.normalized.topics.includes("tracking") ? "support" : "commercial",
      },
      finalAnswer:
        clarificationQuestion ||
        "Voy a revisar informacion real de la tienda para responderte con precision.",
    };
  }

  private resolveIntent(normalized: NormalizedChatMessage): string {
    if (normalized.topics.includes("tracking")) {
      return "order_status";
    }
    if (normalized.topics.includes("shipping")) {
      return "shipping_policy";
    }
    if (normalized.topics.includes("returns")) {
      return "return_policy";
    }
    if (normalized.topics.includes("payments")) {
      return "payment_methods";
    }
    if (normalized.topics.includes("promotions")) {
      return "promotions";
    }
    if (normalized.asksForRecommendation) {
      return "product_recommendation";
    }
    if (normalized.filters.sizeIds?.length) {
      return "inventory_check";
    }
    if (normalized.filters.categoryIds?.length || normalized.filters.colors?.length) {
      return "product_search";
    }
    return "general_assistance";
  }
}

export const chatPlannerService = new ChatPlannerService();
export default chatPlannerService;
