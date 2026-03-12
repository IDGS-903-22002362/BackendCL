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

class AiOrchestrator {
  private readonly baseLogger = logger.child({ component: "ai-orchestrator" });

  async handleMessage(input: OrchestrateAiMessageInput): Promise<OrchestrateAiMessageResult> {
    const session = await aiSessionService.getSessionById(input.sessionId);
    if (!session) {
      throw new Error("Sesion AI no encontrada");
    }

    if (session.userId !== input.userId && input.role !== RolUsuario.ADMIN) {
      throw new Error("No tienes permisos para usar esta sesion AI");
    }

    const startedAt = Date.now();
    const capabilities = roleToolMapperService.getCapabilities(input.role, input.aiToolScopes || []);
    const allowedTools = toolRegistryService.getAllowedTools(input.role, input.aiToolScopes || []);

    const userMessage = await aiMessageService.createMessage({
      sessionId: input.sessionId,
      userId: input.userId,
      role: AiMessageRole.USER,
      content: input.message,
    });

    const messageHistory = await aiMessageService.listMessagesBySession(input.sessionId, aiConfig.gemini.maxContextMessages);
    const historyText = messageHistory
      .map((message) => `${message.role}: ${message.content}`)
      .join("\n");

    let prompt = `Contexto:\n${session.summary || "Sin resumen previo."}\n\nHistorial reciente:\n${historyText}\n\nMensaje actual del usuario:\n${input.message}`;
    const toolCallSummaries: Array<{ id: string; toolName: string; status: string }> = [];

    for (let step = 0; step < aiConfig.gemini.maxToolSteps; step += 1) {
      const response = await geminiAdapter.generate({
        model: aiConfig.gemini.primaryModel,
        prompt,
        systemInstruction: AI_SYSTEM_INSTRUCTIONS,
        tools: allowedTools.map(buildFunctionDeclaration),
        allowedFunctionNames: allowedTools.map((tool) => tool.name),
      });

      if (!response.functionCalls || response.functionCalls.length === 0) {
        const assistantMessage = await aiMessageService.createMessage({
          sessionId: input.sessionId,
          userId: input.userId,
          role: AiMessageRole.ASSISTANT,
          content: response.text,
          model: aiConfig.gemini.primaryModel,
          latencyMs: Date.now() - startedAt,
        });

        const summarySource = `${session.summary || ""}\nUsuario: ${input.message}\nAsistente: ${response.text}`.slice(-aiConfig.gemini.maxSummaryChars);
        await aiSessionService.updateSessionSummary(input.sessionId, summarySource);
        await aiSessionService.touchSession(input.sessionId);

        this.baseLogger.info("ai_message_completed", {
          requestId: input.requestId,
          sessionId: input.sessionId,
          assistantMessageId: assistantMessage.id,
          toolCalls: toolCallSummaries.length,
        });

        return {
          text: response.text,
          toolCalls: toolCallSummaries,
          model: aiConfig.gemini.primaryModel,
          latencyMs: Date.now() - startedAt,
        };
      }

      const toolOutputs: string[] = [];
      for (const functionCall of response.functionCalls) {
        const tool = toolRegistryService.getToolByName(functionCall.name || "");
        if (!tool) {
          continue;
        }

        const parsedInput = tool.schema.parse((functionCall.args || {}) as Record<string, unknown>);

        try {
          const toolStartedAt = Date.now();
          const toolOutput = await tool.execute(parsedInput, {
            userId: input.userId,
            role: input.role,
            requestId: input.requestId,
            capabilities,
          });
          const toolCall = await aiToolCallService.createToolCall({
            sessionId: input.sessionId,
            messageId: userMessage.id!,
            userId: input.userId,
            toolName: tool.name,
            input: parsedInput,
            output: toolOutput,
            status: AiToolCallStatus.SUCCESS,
            durationMs: Date.now() - toolStartedAt,
          });

          toolCallSummaries.push({
            id: toolCall.id!,
            toolName: tool.name,
            status: toolCall.status,
          });
          toolOutputs.push(`Tool ${tool.name} output: ${JSON.stringify(toolOutput)}`);
        } catch (error) {
          const toolCall = await aiToolCallService.createToolCall({
            sessionId: input.sessionId,
            messageId: userMessage.id!,
            userId: input.userId,
            toolName: tool.name,
            input: parsedInput,
            status: AiToolCallStatus.ERROR,
            errorCode: "TOOL_EXECUTION_FAILED",
            errorMessage: error instanceof Error ? error.message : "Tool execution failed",
          });

          toolCallSummaries.push({
            id: toolCall.id!,
            toolName: tool.name,
            status: toolCall.status,
          });
          toolOutputs.push(`Tool ${tool.name} error: ${error instanceof Error ? error.message : "Error desconocido"}`);
        }
      }

      prompt = `${prompt}\n\nResultados de tools:\n${toolOutputs.join("\n")}`;
    }

    throw new Error("El orquestador AI excedio el maximo de pasos permitidos");
  }
}

export const aiOrchestrator = new AiOrchestrator();
export default aiOrchestrator;
