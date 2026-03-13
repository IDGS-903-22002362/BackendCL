import { RolUsuario } from "../../models/usuario.model";
import { assertAiConfig } from "../../config/ai.config";
import aiSessionService from "./memory/session.service";
import aiMessageService from "./memory/message.service";
import aiToolCallService from "./memory/tool-call.service";
import aiOrchestrator from "./adapters/ai-orchestrator";
import {
  AI_CONFIG_ERROR_CODE,
  AiRuntimeError,
  toAiErrorPayload,
} from "./ai.error";

export interface SendAiMessageInput {
  sessionId: string;
  userId: string;
  role: RolUsuario;
  message: string;
  aiToolScopes?: string[];
  requestId?: string;
}

export type SendAiMessageStreamEvent =
  | {
      type: "status";
      data: {
        status: "processing";
      };
    }
  | {
      type: "final";
      data: Awaited<ReturnType<AiChatService["sendMessage"]>>;
    }
  | {
      type: "error";
      data: {
        code: string;
        message: string;
      };
    };

class AiChatService {
  async assertMessageExecutionReady(input: SendAiMessageInput) {
    try {
      assertAiConfig();
    } catch (error) {
      throw new AiRuntimeError(
        AI_CONFIG_ERROR_CODE,
        error instanceof Error ? error.message : "Configuracion AI invalida",
        500,
        error,
      );
    }

    const session = await aiSessionService.getSessionById(input.sessionId);
    if (!session) {
      throw new AiRuntimeError(
        "AI_SESSION_NOT_FOUND",
        "Sesion AI no encontrada",
        404,
      );
    }

    if (session.userId !== input.userId && input.role !== RolUsuario.ADMIN) {
      throw new AiRuntimeError(
        "AI_FORBIDDEN",
        "No tienes permisos para usar esta sesion AI",
        403,
      );
    }
  }

  async createSession(input: {
    userId: string;
    role: RolUsuario;
    channel: string;
    title?: string;
  }) {
    return aiSessionService.createSession(input);
  }

  async listSessions(userId: string) {
    return aiSessionService.listSessionsByUser(userId);
  }

  async getSessionDetail(sessionId: string) {
    const session = await aiSessionService.getSessionById(sessionId);
    if (!session) {
      return {
        session: null,
        messages: [],
        toolCalls: [],
      };
    }

    const [messages, toolCalls] = await Promise.all([
      aiMessageService.listMessagesBySession(sessionId),
      aiToolCallService.listToolCallsBySession(sessionId),
    ]);

    return {
      session,
      messages,
      toolCalls,
    };
  }

  async sendMessage(input: SendAiMessageInput) {
    await this.assertMessageExecutionReady(input);
    return aiOrchestrator.handleMessage(input);
  }

  async *sendMessageStream(
    input: SendAiMessageInput,
  ): AsyncGenerator<SendAiMessageStreamEvent> {
    yield {
      type: "status",
      data: {
        status: "processing",
      },
    };

    try {
      const result = await this.sendMessage(input);
      yield {
        type: "final",
        data: result,
      };
    } catch (error) {
      const errorPayload = toAiErrorPayload(error);
      yield {
        type: "error",
        data: {
          code: errorPayload.code,
          message: errorPayload.message,
        },
      };
    }
  }
}

export const aiChatService = new AiChatService();
export default aiChatService;
