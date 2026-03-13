import {
  Content,
  FunctionCall,
  createPartFromFunctionCall,
  createPartFromFunctionResponse,
  createPartFromText,
} from "@google/genai";
import aiConfig from "../../../config/ai.config";
import { AiMessageRole, AiToolCallStatus } from "../../../models/ai/ai.model";
import logger from "../../../utils/logger";
import AI_SYSTEM_INSTRUCTIONS from "../ai.prompts";
import geminiAdapter from "./gemini.adapter";
import { buildFunctionDeclaration } from "../tools/types";
import toolRegistryService from "../rbac/tool-registry.service";
import roleToolMapperService from "../rbac/role-tool-mapper.service";
import aiMessageService from "../memory/message.service";
import aiSessionService from "../memory/session.service";
import aiToolCallService from "../memory/tool-call.service";
import { RolUsuario } from "../../../models/usuario.model";
import { AI_INVALID_CONFIGURATION_CODE, isAiRuntimeError } from "../ai.error";

export interface OrchestrateAiMessageInput {
  sessionId: string;
  userId: string;
  role: RolUsuario;
  message: string;
  aiToolScopes?: string[];
  requestId?: string;
}

export interface OrchestrateAiMessageResult {
  text: string;
  suggestedProducts?: unknown[];
  toolCalls: Array<{ id: string; toolName: string; status: string }>;
  model: string;
  latencyMs: number;
}

export const AI_ASSISTANT_USER_ID = "ai-assistant";
const AI_DIRECT_RESPONSE_INSTRUCTION = `${AI_SYSTEM_INSTRUCTIONS}\nSi ya cuentas con informacion suficiente a partir de los resultados de tools, responde directamente al usuario y no invoques mas tools.`;

const buildAssistantFallbackText = (
  toolCalls: Array<{ id: string; toolName: string; status: string }>,
): string => {
  if (toolCalls.length > 0) {
    return "Procese tu solicitud, pero no pude redactar una respuesta final. Intenta reformular tu mensaje.";
  }

  return "No pude generar una respuesta en este momento. Intenta nuevamente.";
};

const resolveAssistantText = (
  rawText: string,
  toolCalls: Array<{ id: string; toolName: string; status: string }>,
): string => {
  const normalizedText = rawText.trim();
  if (normalizedText.length > 0) {
    return normalizedText;
  }

  return buildAssistantFallbackText(toolCalls);
};

const buildConversationPrompt = (
  sessionSummary: string | undefined,
  historyText: string,
  currentMessage: string,
): string =>
  `Contexto:\n${sessionSummary || "Sin resumen previo."}\n\nHistorial reciente:\n${historyText}\n\nMensaje actual del usuario:\n${currentMessage}`;

const buildFunctionCallSignature = (functionCalls: FunctionCall[]): string =>
  functionCalls
    .map((functionCall) => ({
      name: functionCall.name || "",
      args: functionCall.args || {},
    }))
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((functionCall) => JSON.stringify(functionCall))
    .join("|");

class AiOrchestrator {
  private readonly baseLogger = logger.child({ component: "ai-orchestrator" });

  private async finalizeAssistantResponse(input: {
    sessionId: string;
    requestId?: string;
    userMessage: string;
    sessionSummary?: string;
    assistantText: string;
    toolCallSummaries: Array<{ id: string; toolName: string; status: string }>;
    startedAt: number;
  }): Promise<OrchestrateAiMessageResult> {
    const assistantMessage = await aiMessageService.createMessage({
      sessionId: input.sessionId,
      userId: AI_ASSISTANT_USER_ID,
      role: AiMessageRole.ASSISTANT,
      content: input.assistantText,
      model: aiConfig.gemini.primaryModel,
      toolCallIds: input.toolCallSummaries.map((toolCall) => toolCall.id),
      latencyMs: Date.now() - input.startedAt,
    });

    const summarySource =
      `${input.sessionSummary || ""}\nUsuario: ${input.userMessage}\nAsistente: ${input.assistantText}`.slice(
        -aiConfig.gemini.maxSummaryChars,
      );
    await aiSessionService.updateSessionSummary(input.sessionId, summarySource);
    await aiSessionService.touchSession(input.sessionId);

    this.baseLogger.info("ai_message_completed", {
      requestId: input.requestId,
      sessionId: input.sessionId,
      assistantMessageId: assistantMessage.id,
      toolCalls: input.toolCallSummaries.length,
    });

    return {
      text: input.assistantText,
      toolCalls: input.toolCallSummaries,
      model: aiConfig.gemini.primaryModel,
      latencyMs: Date.now() - input.startedAt,
    };
  }

  private async synthesizeFinalAnswer(input: {
    contents: Content[];
    toolCallSummaries: Array<{ id: string; toolName: string; status: string }>;
    sessionId: string;
    requestId?: string;
  }): Promise<string> {
    try {
      const response = await geminiAdapter.generate({
        model: aiConfig.gemini.primaryModel,
        contents: input.contents,
        systemInstruction: AI_DIRECT_RESPONSE_INSTRUCTION,
      });

      return resolveAssistantText(response.text, input.toolCallSummaries);
    } catch (error) {
      this.baseLogger.warn("ai_final_synthesis_failed", {
        requestId: input.requestId,
        sessionId: input.sessionId,
        message: error instanceof Error ? error.message : String(error),
      });
      return buildAssistantFallbackText(input.toolCallSummaries);
    }
  }

  private async executeFunctionCalls(input: {
    functionCalls: FunctionCall[];
    sessionId: string;
    messageId: string;
    userId: string;
    role: RolUsuario;
    requestId?: string;
    capabilities: string[];
    toolCallSummaries: Array<{ id: string; toolName: string; status: string }>;
  }): Promise<Content> {
    const responseParts = [];

    for (let index = 0; index < input.functionCalls.length; index += 1) {
      const functionCall = input.functionCalls[index];
      const toolName = functionCall.name || "unknown_tool";
      const toolCallId = functionCall.id || `${toolName}-${Date.now()}-${index}`;
      const rawArgs = (functionCall.args || {}) as Record<string, unknown>;
      const tool = toolRegistryService.getToolByName(toolName);

      if (!tool) {
        responseParts.push(
          createPartFromFunctionResponse(toolCallId, toolName, {
            error: {
              code: "TOOL_NOT_FOUND",
              message: `La tool ${toolName} no esta registrada`,
            },
          }),
        );
        continue;
      }

      try {
        const parsedInput = tool.schema.parse(rawArgs);
        const toolStartedAt = Date.now();
        const toolOutput = await tool.execute(parsedInput, {
          userId: input.userId,
          role: input.role,
          requestId: input.requestId,
          capabilities: input.capabilities,
        });
        const toolCall = await aiToolCallService.createToolCall({
          sessionId: input.sessionId,
          messageId: input.messageId,
          userId: input.userId,
          toolName: tool.name,
          input: parsedInput,
          output: toolOutput,
          status: AiToolCallStatus.SUCCESS,
          durationMs: Date.now() - toolStartedAt,
        });

        input.toolCallSummaries.push({
          id: toolCall.id!,
          toolName: tool.name,
          status: toolCall.status,
        });
        responseParts.push(
          createPartFromFunctionResponse(toolCallId, tool.name, toolOutput),
        );
      } catch (error) {
        const toolCall = await aiToolCallService.createToolCall({
          sessionId: input.sessionId,
          messageId: input.messageId,
          userId: input.userId,
          toolName: tool.name,
          input: rawArgs,
          status: AiToolCallStatus.ERROR,
          errorCode: "TOOL_EXECUTION_FAILED",
          errorMessage:
            error instanceof Error ? error.message : "Tool execution failed",
        });

        input.toolCallSummaries.push({
          id: toolCall.id!,
          toolName: tool.name,
          status: toolCall.status,
        });
        responseParts.push(
          createPartFromFunctionResponse(toolCallId, tool.name, {
            error: {
              code: "TOOL_EXECUTION_FAILED",
              message:
                error instanceof Error
                  ? error.message
                  : "Tool execution failed",
            },
          }),
        );
      }
    }

    return {
      role: "user",
      parts: responseParts,
    };
  }

  async handleMessage(
    input: OrchestrateAiMessageInput,
  ): Promise<OrchestrateAiMessageResult> {
    const session = await aiSessionService.getSessionById(input.sessionId);
    if (!session) {
      throw new Error("Sesion AI no encontrada");
    }

    if (session.userId !== input.userId && input.role !== RolUsuario.ADMIN) {
      throw new Error("No tienes permisos para usar esta sesion AI");
    }

    const startedAt = Date.now();
    const capabilities = roleToolMapperService.getCapabilities(
      input.role,
      input.aiToolScopes || [],
    );
    const allowedTools = toolRegistryService.getAllowedTools(
      input.role,
      input.aiToolScopes || [],
    );

    const userMessage = await aiMessageService.createMessage({
      sessionId: input.sessionId,
      userId: input.userId,
      role: AiMessageRole.USER,
      content: input.message,
    });

    const messageHistory = await aiMessageService.listMessagesBySession(
      input.sessionId,
      aiConfig.gemini.maxContextMessages,
    );
    const historyText = messageHistory
      .map((message) => `${message.role}: ${message.content}`)
      .join("\n");

    const prompt = buildConversationPrompt(
      session.summary,
      historyText,
      input.message,
    );
    const toolCallSummaries: Array<{
      id: string;
      toolName: string;
      status: string;
    }> = [];
    const declaredTools = allowedTools.map(buildFunctionDeclaration);
    const contents: Content[] = [
      {
        role: "user",
        parts: [createPartFromText(prompt)],
      },
    ];
    const seenFunctionCallSignatures = new Set<string>();

    for (let step = 0; step < aiConfig.gemini.maxToolSteps; step += 1) {
      let response;
      try {
        response = await geminiAdapter.generate({
          model: aiConfig.gemini.primaryModel,
          contents,
          systemInstruction: AI_SYSTEM_INSTRUCTIONS,
          tools: declaredTools,
        });
      } catch (error) {
        const canRetryWithoutTools =
          declaredTools.length > 0 &&
          isAiRuntimeError(error) &&
          error.code === AI_INVALID_CONFIGURATION_CODE;

        if (!canRetryWithoutTools) {
          throw error;
        }

        this.baseLogger.warn("ai_tool_calling_fallback_to_text", {
          requestId: input.requestId,
          sessionId: input.sessionId,
          code: error.code,
          message: error.message,
          toolCount: declaredTools.length,
        });

        response = await geminiAdapter.generate({
          model: aiConfig.gemini.primaryModel,
          contents,
          systemInstruction: AI_SYSTEM_INSTRUCTIONS,
        });
      }

      if (!response.functionCalls || response.functionCalls.length === 0) {
        const assistantText = resolveAssistantText(
          response.text,
          toolCallSummaries,
        );
        return this.finalizeAssistantResponse({
          sessionId: input.sessionId,
          requestId: input.requestId,
          userMessage: input.message,
          sessionSummary: session.summary,
          assistantText,
          toolCallSummaries,
          startedAt,
        });
      }

      const signature = buildFunctionCallSignature(response.functionCalls);
      if (seenFunctionCallSignatures.has(signature)) {
        this.baseLogger.warn("ai_tool_call_loop_detected", {
          requestId: input.requestId,
          sessionId: input.sessionId,
          signature,
          step,
        });
        const assistantText = await this.synthesizeFinalAnswer({
          contents,
          toolCallSummaries,
          sessionId: input.sessionId,
          requestId: input.requestId,
        });
        return this.finalizeAssistantResponse({
          sessionId: input.sessionId,
          requestId: input.requestId,
          userMessage: input.message,
          sessionSummary: session.summary,
          assistantText,
          toolCallSummaries,
          startedAt,
        });
      }
      seenFunctionCallSignatures.add(signature);

      contents.push({
        role: "model",
        parts: response.functionCalls.map((functionCall) =>
          createPartFromFunctionCall(
            functionCall.name || "",
            (functionCall.args || {}) as Record<string, unknown>,
          ),
        ),
      });

      const functionResponseContent = await this.executeFunctionCalls({
        functionCalls: response.functionCalls,
        sessionId: input.sessionId,
        messageId: userMessage.id!,
        userId: input.userId,
        role: input.role,
        requestId: input.requestId,
        capabilities,
        toolCallSummaries,
      });
      if (functionResponseContent.parts && functionResponseContent.parts.length) {
        contents.push(functionResponseContent);
      }

      if (step === aiConfig.gemini.maxToolSteps - 1) {
        this.baseLogger.warn("ai_tool_call_step_limit_reached", {
          requestId: input.requestId,
          sessionId: input.sessionId,
          step,
          toolCallCount: toolCallSummaries.length,
        });
        const assistantText = await this.synthesizeFinalAnswer({
          contents,
          toolCallSummaries,
          sessionId: input.sessionId,
          requestId: input.requestId,
        });
        return this.finalizeAssistantResponse({
          sessionId: input.sessionId,
          requestId: input.requestId,
          userMessage: input.message,
          sessionSummary: session.summary,
          assistantText,
          toolCallSummaries,
          startedAt,
        });
      }
    }

    const assistantText = buildAssistantFallbackText(toolCallSummaries);
    return this.finalizeAssistantResponse({
      sessionId: input.sessionId,
      requestId: input.requestId,
      userMessage: input.message,
      sessionSummary: session.summary,
      assistantText,
      toolCallSummaries,
      startedAt,
    });
  }
}

export const aiOrchestrator = new AiOrchestrator();
export default aiOrchestrator;
