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
import {
  AiAgentType,
  AiAttachment,
  AiSessionMode,
  resolveAiAgentType,
} from "../../models/ai/ai.model";
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
    expectedAgentType: AiAgentType;
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

    if (resolveAiAgentType(session.agentType) !== input.expectedAgentType) {
      // Conceal whether the identifier belongs to the other agent surface.
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

    if (
      input.expectedAgentType === AiAgentType.ADMIN &&
      input.role !== RolUsuario.ADMIN
    ) {
      throw new AiRuntimeError(
        "AI_FORBIDDEN",
        "No tienes permisos para usar Admin Copilot",
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
      expectedAgentType: AiAgentType.SHOPPING,
    });
    await this.assertAttachmentsOwnedByUser(input.attachments, input.userId);
  }

  async assertPublicMessageExecutionReady(input: SendPublicAiMessageInput) {
    const session = await this.getValidatedSessionForUser({
      sessionId: input.sessionId,
      publicAccessToken: input.publicAccessToken,
      expectedAgentType: AiAgentType.SHOPPING,
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
      agentType: AiAgentType.SHOPPING,
    });
  }

  async createAdminSession(input: {
    userId: string;
    role: RolUsuario;
    channel: string;
    title?: string;
  }) {
    this.assertAdminRole(input.role);
    return aiSessionService.createSession({
      ...input,
      mode: AiSessionMode.AUTHENTICATED,
      agentType: AiAgentType.ADMIN,
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
      agentType: AiAgentType.SHOPPING,
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
    const sessions = await aiSessionService.listSessionsByUser(userId);
    return sessions.filter(
      (session) =>
        resolveAiAgentType(session.agentType) === AiAgentType.SHOPPING,
    );
  }

  async listAdminSessions(userId: string, role: RolUsuario) {
    this.assertAdminRole(role);
    const sessions = await aiSessionService.listSessionsByUser(userId);
    return sessions.filter(
      (session) => resolveAiAgentType(session.agentType) === AiAgentType.ADMIN,
    );
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

    if (
      session.mode === AiSessionMode.GUEST ||
      session.userId !== userId ||
      resolveAiAgentType(session.agentType) !== AiAgentType.SHOPPING
    ) {
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

  async getAdminSessionDetail(
    sessionId: string,
    userId: string,
    role: RolUsuario,
  ) {
    this.assertAdminRole(role);
    const session = await aiSessionService.getSessionById(sessionId);
    if (
      !session ||
      session.mode !== AiSessionMode.AUTHENTICATED ||
      session.userId !== userId ||
      resolveAiAgentType(session.agentType) !== AiAgentType.ADMIN
    ) {
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

    return { session, messages, toolCalls };
  }

  async sendMessage(input: SendAiMessageInput) {
    await this.assertMessageExecutionReady(input);
    return aiOrchestrator.handleMessage({
      ...input,
      sessionMode: AiSessionMode.AUTHENTICATED,
    });
  }

  async assertAdminMessageExecutionReady(input: SendAiMessageInput) {
    this.assertAdminRole(input.role);
    await this.getValidatedSessionForUser({
      sessionId: input.sessionId,
      userId: input.userId,
      role: input.role,
      expectedAgentType: AiAgentType.ADMIN,
    });
    await this.assertAttachmentsOwnedByUser(input.attachments, input.userId);
  }

  async sendAdminMessage(input: SendAiMessageInput) {
    await this.assertAdminMessageExecutionReady(input);
    return aiOrchestrator.handleMessage({
      ...input,
      // Admin Copilot authorization is derived from the verified backend role;
      // caller-supplied scopes never influence its toolset.
      aiToolScopes: [],
      sessionMode: AiSessionMode.AUTHENTICATED,
    });
  }

  async sendPublicMessage(input: SendPublicAiMessageInput) {
    const session = await this.getValidatedSessionForUser({
      sessionId: input.sessionId,
      publicAccessToken: input.publicAccessToken,
      expectedAgentType: AiAgentType.SHOPPING,
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

  async *sendAdminMessageStream(
    input: SendAiMessageInput,
  ): AsyncGenerator<SendAiMessageStreamEvent> {
    yield {
      type: "status",
      data: { status: "processing" },
    };

    try {
      const result = await this.sendAdminMessage(input);
      yield { type: "final", data: result };
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

  private assertAdminRole(role: RolUsuario): void {
    if (role !== RolUsuario.ADMIN) {
      throw new AiRuntimeError(
        "AI_FORBIDDEN",
        "No tienes permisos para usar Admin Copilot",
        403,
      );
    }
  }
}

export const aiChatService = new AiChatService();
export default aiChatService;
