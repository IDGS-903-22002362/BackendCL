import aiConfig from "../../../config/ai.config";
import {
  AiAttachment,
  AiMessageRole,
  AiSessionMode,
  AiToolCallStatus,
  ChatPlan,
} from "../../../models/ai/ai.model";
import logger from "../../../utils/logger";
import {
  AI_RESPONDER_INSTRUCTIONS,
} from "../ai.prompts";
import geminiAdapter from "./gemini.adapter";
import toolRegistryService from "../rbac/tool-registry.service";
import roleToolMapperService from "../rbac/role-tool-mapper.service";
import aiMessageService from "../memory/message.service";
import aiSessionService from "../memory/session.service";
import aiToolCallService from "../memory/tool-call.service";
import { RolUsuario } from "../../../models/usuario.model";
import { AI_INVALID_CONFIGURATION_CODE, isAiRuntimeError } from "../ai.error";
import chatPlannerService from "../planning/chat-planner.service";
import conversationStateService from "../session/conversation-state.service";

export interface OrchestrateAiMessageInput {
  sessionId: string;
  userId: string;
  role: RolUsuario;
  message: string;
  attachments?: AiAttachment[];
  clientContext?: Record<string, unknown>;
  aiToolScopes?: string[];
  requestId?: string;
  sessionMode: AiSessionMode;
}

export interface OrchestrateAiMessageResult {
  text: string;
  suggestedProducts?: unknown[];
  toolCalls: Array<{ id: string; toolName: string; status: string }>;
  model: string;
  latencyMs: number;
}

export const AI_ASSISTANT_USER_ID = "ai-assistant";

const buildFallbackAnswer = (input: {
  plan: ChatPlan;
  toolOutputs: Array<{ toolName: string; output?: Record<string, unknown> }>;
}): string => {
  if (input.plan.needsClarification && input.plan.clarificationQuestion) {
    return input.plan.clarificationQuestion;
  }

  const searchProductsOutput = input.toolOutputs.find(
    (tool) => tool.toolName === "search_products",
  )?.output;
  const searchProductsValue = searchProductsOutput?.products;
  const products: unknown[] = Array.isArray(searchProductsValue)
    ? searchProductsValue
    : [];
  if (products.length > 0) {
    const first = products[0] as Record<string, unknown>;
    const name =
      typeof first.descripcion === "string"
        ? first.descripcion
        : "una opcion disponible";
    const price =
      typeof first.precioPublico === "number"
        ? ` por $${first.precioPublico} MXN`
        : "";
    const link =
      typeof first.canonicalLink === "string"
        ? ` Aqui lo puedes ver: ${first.canonicalLink}`
        : "";
    return `Encontre ${products.length} opciones. La primera es ${name}${price}.${link}`.trim();
  }

  const promotionsOutput = input.toolOutputs.find(
    (tool) => tool.toolName === "get_promotions",
  )?.output;
  const promotionsValue = promotionsOutput?.promotions;
  const promotions: unknown[] = Array.isArray(promotionsValue)
    ? promotionsValue
    : [];
  if (promotions.length > 0) {
    const first = promotions[0] as Record<string, unknown>;
    return `La promocion activa destacada es ${String(first.title || "una promocion vigente")}: ${String(first.description || "")}`.trim();
  }

  const storeOutput = input.toolOutputs.find(
    (tool) => tool.toolName === "get_store_info",
  )?.output;
  if (storeOutput?.store && typeof storeOutput.store === "object") {
    const store = storeOutput.store as Record<string, unknown>;
    return `La tienda oficial atiende en ${String(store.openingHours || "horario por confirmar")}. Ubicacion: ${String(store.mapsUrl || "no disponible")}`;
  }

  return input.plan.finalAnswer || "No pude resolverlo con precision en este momento.";
};

class AiOrchestrator {
  private readonly baseLogger = logger.child({ component: "ai-orchestrator" });

  private async composeAnswer(input: {
    plan: ChatPlan;
    toolOutputs: Array<{ toolName: string; output?: Record<string, unknown> }>;
    historyText: string;
    sessionSummary?: string;
    requestId?: string;
  }): Promise<string> {
    if (input.plan.needsClarification && input.plan.clarificationQuestion) {
      return input.plan.clarificationQuestion;
    }

    try {
      const response = await geminiAdapter.generate({
        model: aiConfig.gemini.primaryModel,
        systemInstruction: AI_RESPONDER_INSTRUCTIONS,
        prompt: JSON.stringify(
          {
            sessionSummary: input.sessionSummary || "",
            history: input.historyText,
            plan: input.plan,
            toolOutputs: input.toolOutputs,
          },
          null,
          2,
        ),
      });

      if (response.text.trim()) {
        return response.text.trim();
      }
    } catch (error) {
      const canFallback =
        isAiRuntimeError(error) &&
        error.code === AI_INVALID_CONFIGURATION_CODE;
      this.baseLogger.warn("ai_responder_fallback", {
        requestId: input.requestId,
        message: error instanceof Error ? error.message : String(error),
        canFallback,
      });
    }

    return buildFallbackAnswer({
      plan: input.plan,
      toolOutputs: input.toolOutputs,
    });
  }

  async handleMessage(
    input: OrchestrateAiMessageInput,
  ): Promise<OrchestrateAiMessageResult> {
    const session = await aiSessionService.getSessionById(input.sessionId);
    if (!session) {
      throw new Error("Sesion AI no encontrada");
    }

    const startedAt = Date.now();
    const capabilities = roleToolMapperService.getCapabilities(
      input.role,
      input.aiToolScopes || [],
    );
    const allowedTools = toolRegistryService.getAllowedTools(
      input.role,
      input.aiToolScopes || [],
      { publicOnly: input.sessionMode === AiSessionMode.GUEST },
    );

    const userMessage = await aiMessageService.createMessage({
      sessionId: input.sessionId,
      userId: input.userId,
      role: AiMessageRole.USER,
      content: input.message,
      attachments: input.attachments || [],
    });

    const messageHistory = await aiMessageService.listMessagesBySession(
      input.sessionId,
      aiConfig.gemini.maxContextMessages,
    );
    const historyText = messageHistory
      .map((message) => `${message.role}: ${message.content}`)
      .join("\n");

    const { normalized, plan } = await chatPlannerService.plan({
      message: input.message,
      sessionState: session.conversationState,
      allowedTools,
      sessionMode: input.sessionMode,
      requestId: input.requestId,
    });

    this.baseLogger.info("ai_message_planned", {
      requestId: input.requestId,
      sessionId: input.sessionId,
      sessionMode: input.sessionMode,
      intent: plan.intent,
      confidence: plan.confidence,
      requiresTools: plan.requiresTools,
      needsClarification: plan.needsClarification,
      toolCount: plan.toolCalls.length,
      normalizedMessage: normalized.normalizedText,
    });

    const toolCallSummaries: Array<{
      id: string;
      toolName: string;
      status: string;
    }> = [];
    const toolOutputs: Array<{ toolName: string; output?: Record<string, unknown> }> = [];

    for (const plannedTool of plan.toolCalls) {
      const tool = toolRegistryService.getToolByName(plannedTool.toolName);

      if (!tool || !allowedTools.some((allowed) => allowed.name === plannedTool.toolName)) {
        const deniedToolCall = await aiToolCallService.createToolCall({
          sessionId: input.sessionId,
          messageId: userMessage.id!,
          userId: input.userId,
          toolName: plannedTool.toolName,
          input: plannedTool.arguments,
          status: AiToolCallStatus.DENIED,
          errorCode: "TOOL_NOT_ALLOWED",
          errorMessage: "La tool no esta permitida para este contexto",
        });
        toolCallSummaries.push({
          id: deniedToolCall.id!,
          toolName: plannedTool.toolName,
          status: deniedToolCall.status,
        });
        continue;
      }

      try {
        const parsedInput = tool.schema.parse(plannedTool.arguments || {});
        const toolStartedAt = Date.now();
        const rawOutput = await tool.execute(parsedInput, {
          userId: input.userId,
          role: input.role,
          requestId: input.requestId,
          capabilities,
          sessionId: input.sessionId,
          sessionMode: input.sessionMode,
          attachments: input.attachments,
        });
        const output =
          rawOutput && typeof rawOutput === "object" && "ok" in rawOutput
            ? ((rawOutput as Record<string, unknown>).data as
                | Record<string, unknown>
                | undefined) || {}
            : (rawOutput as Record<string, unknown>);
        const toolCall = await aiToolCallService.createToolCall({
          sessionId: input.sessionId,
          messageId: userMessage.id!,
          userId: input.userId,
          toolName: tool.name,
          input: parsedInput,
          output,
          status: AiToolCallStatus.SUCCESS,
          durationMs: Date.now() - toolStartedAt,
        });

        toolCallSummaries.push({
          id: toolCall.id!,
          toolName: tool.name,
          status: toolCall.status,
        });
        toolOutputs.push({
          toolName: tool.name,
          output,
        });
      } catch (error) {
        const toolCall = await aiToolCallService.createToolCall({
          sessionId: input.sessionId,
          messageId: userMessage.id!,
          userId: input.userId,
          toolName: tool.name,
          input: plannedTool.arguments || {},
          status: AiToolCallStatus.ERROR,
          errorCode: "TOOL_EXECUTION_FAILED",
          errorMessage:
            error instanceof Error ? error.message : "Tool execution failed",
        });

        toolCallSummaries.push({
          id: toolCall.id!,
          toolName: tool.name,
          status: toolCall.status,
        });
      }
    }

    const assistantText = await this.composeAnswer({
      plan,
      toolOutputs,
      historyText,
      sessionSummary: session.summary,
      requestId: input.requestId,
    });

    const assistantMessage = await aiMessageService.createMessage({
      sessionId: input.sessionId,
      userId: AI_ASSISTANT_USER_ID,
      role: AiMessageRole.ASSISTANT,
      content: assistantText,
      model: aiConfig.gemini.primaryModel,
      toolCallIds: toolCallSummaries.map((toolCall) => toolCall.id),
      latencyMs: Date.now() - startedAt,
    });

    const nextConversationState = conversationStateService.merge({
      previous: session.conversationState,
      normalized,
      sessionUpdates: {
        ...plan.sessionUpdates,
        pendingClarification: plan.needsClarification
          ? plan.sessionUpdates.pendingClarification || {
              type: "generic",
              question: plan.clarificationQuestion || plan.finalAnswer,
            }
          : null,
      },
      attachments: input.attachments,
      toolOutputs,
    });

    const summarySource =
      `${session.summary || ""}\nUsuario: ${input.message}\nAsistente: ${assistantText}`.slice(
        -aiConfig.gemini.maxSummaryChars,
      );
    await Promise.all([
      aiSessionService.updateSessionSummary(input.sessionId, summarySource),
      aiSessionService.updateConversationState(
        input.sessionId,
        nextConversationState,
      ),
      input.sessionMode === AiSessionMode.GUEST
        ? aiSessionService.touchGuestSession(input.sessionId)
        : aiSessionService.touchSession(input.sessionId),
    ]);

    this.baseLogger.info("ai_message_completed", {
      requestId: input.requestId,
      sessionId: input.sessionId,
      sessionMode: input.sessionMode,
      assistantMessageId: assistantMessage.id,
      intent: plan.intent,
      confidence: plan.confidence,
      toolCalls: toolCallSummaries.length,
      fallbackClarification: plan.needsClarification,
      latencyMs: Date.now() - startedAt,
    });

    return {
      text: assistantText,
      suggestedProducts:
        toolOutputs.find((tool) => tool.toolName === "search_products")?.output
          ?.products as unknown[] | undefined,
      toolCalls: toolCallSummaries,
      model: aiConfig.gemini.primaryModel,
      latencyMs: Date.now() - startedAt,
    };
  }
}

export const aiOrchestrator = new AiOrchestrator();
export default aiOrchestrator;
