import { createHash, randomBytes } from "crypto";
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
import { AiAttachment, AiSessionMode } from "../../models/ai/ai.model";
import { admin } from "../../config/firebase.admin";
import tryOnAssetService from "./jobs/tryon-asset.service";

const hashToken = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

export interface SendAiMessageInput {
  sessionId: string;
  userId: string;
  role: RolUsuario;
  message: string;
  attachments?: AiAttachment[];
  clientContext?: Record<string, unknown>;
  aiToolScopes?: string[];
  requestId?: string;
}

export interface SendPublicAiMessageInput {
  sessionId: string;
  publicAccessToken: string;
  message: string;
  attachments?: AiAttachment[];
  clientContext?: Record<string, unknown>;
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
  private async assertAttachmentsOwnedByUser(
    attachments: AiAttachment[] | undefined,
    userId: string,
  ): Promise<void> {
    const assetIds = [
      ...new Set((attachments || []).map((attachment) => attachment.assetId)),
    ];
    if (assetIds.length === 0) {
      return;
    }

    const assets = await Promise.all(
      assetIds.map((assetId) => tryOnAssetService.getAssetById(assetId)),
    );
    if (assets.some((asset) => !asset || asset.userId !== userId)) {
      // Missing and foreign assets intentionally share the same response.
      throw new AiRuntimeError(
        "AI_ATTACHMENT_NOT_FOUND",
        "Adjunto AI no encontrado",
        404,
      );
    }
  }

  private async getValidatedSessionForUser(input: {
    sessionId: string;
    userId?: string;
    role?: RolUsuario;
    publicAccessToken?: string;
  }) {
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

    if (session.mode === AiSessionMode.GUEST) {
      if (!input.publicAccessToken) {
        throw new AiRuntimeError(
          "AI_FORBIDDEN",
          "Se requiere token de acceso publico para esta sesion",
          403,
        );
      }

      const incomingHash = hashToken(input.publicAccessToken);
      if (incomingHash !== session.guestAccess?.tokenHash) {
        throw new AiRuntimeError(
          "AI_FORBIDDEN",
          "Token publico invalido para esta sesion",
          403,
        );
      }

      return session;
    }

    if (!input.userId || !input.role) {
      throw new AiRuntimeError(
        "AI_FORBIDDEN",
        "Se requiere usuario autenticado para esta sesion",
        403,
      );
    }

    if (session.userId !== input.userId) {
      throw new AiRuntimeError(
        "AI_FORBIDDEN",
        "No tienes permisos para usar esta sesion AI",
        403,
      );
    }

    return session;
  }

  async assertMessageExecutionReady(input: SendAiMessageInput) {
    await this.getValidatedSessionForUser({
      sessionId: input.sessionId,
      userId: input.userId,
      role: input.role,
    });
    await this.assertAttachmentsOwnedByUser(input.attachments, input.userId);
  }

  async assertPublicMessageExecutionReady(input: SendPublicAiMessageInput) {
    const session = await this.getValidatedSessionForUser({
      sessionId: input.sessionId,
      publicAccessToken: input.publicAccessToken,
    });
    await this.assertAttachmentsOwnedByUser(input.attachments, session.userId);
  }

  async createSession(input: {
    userId: string;
    role: RolUsuario;
    channel: string;
    title?: string;
  }) {
    return aiSessionService.createSession({
      ...input,
      mode: AiSessionMode.AUTHENTICATED,
    });
  }

  async createPublicSession(input: {
    channel: string;
    title?: string;
    guestLabel?: string;
  }) {
    const publicAccessToken = randomBytes(24).toString("hex");
    const session = await aiSessionService.createSession({
      userId: `guest:${randomBytes(12).toString("hex")}`,
      role: RolUsuario.CLIENTE,
      channel: input.channel,
      title: input.title,
      mode: AiSessionMode.GUEST,
      guestAccess: {
        tokenHash: hashToken(publicAccessToken),
        label: input.guestLabel?.trim(),
        createdAt: admin.firestore.Timestamp.now(),
      },
    });

    return {
      session: {
        ...session,
        guestAccess: session.guestAccess
          ? {
              ...session.guestAccess,
              tokenHash: "",
            }
          : null,
      },
      publicAccessToken,
    };
  }

  async listSessions(userId: string) {
    return aiSessionService.listSessionsByUser(userId);
  }

  async getSessionDetail(sessionId: string, userId: string) {
    const session = await aiSessionService.getSessionById(sessionId);
    if (!session) {
      return {
        session: null,
        messages: [],
        toolCalls: [],
      };
    }

    if (session.mode === AiSessionMode.GUEST || session.userId !== userId) {
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
    return aiOrchestrator.handleMessage({
      ...input,
      sessionMode: AiSessionMode.AUTHENTICATED,
    });
  }

  async sendPublicMessage(input: SendPublicAiMessageInput) {
    const session = await this.getValidatedSessionForUser({
      sessionId: input.sessionId,
      publicAccessToken: input.publicAccessToken,
    });
    await this.assertAttachmentsOwnedByUser(input.attachments, session.userId);

    return aiOrchestrator.handleMessage({
      sessionId: input.sessionId,
      userId: session.userId,
      role: RolUsuario.CLIENTE,
      message: input.message,
      attachments: input.attachments,
      clientContext: input.clientContext,
      aiToolScopes: [],
      requestId: input.requestId,
      sessionMode: AiSessionMode.GUEST,
    });
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

  async *sendPublicMessageStream(
    input: SendPublicAiMessageInput,
  ): AsyncGenerator<SendAiMessageStreamEvent> {
    yield {
      type: "status",
      data: {
        status: "processing",
      },
    };

    try {
      const result = await this.sendPublicMessage(input);
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
