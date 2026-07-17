jest.mock("../src/services/ai/memory/session.service", () => ({
  __esModule: true,
  default: {
    getSessionById: jest.fn(),
    createSession: jest.fn(),
    listSessionsByUser: jest.fn(),
  },
}));

jest.mock("../src/services/ai/memory/message.service", () => ({
  __esModule: true,
  default: {
    listMessagesBySession: jest.fn(),
  },
}));

jest.mock("../src/services/ai/memory/tool-call.service", () => ({
  __esModule: true,
  default: {
    listToolCallsBySession: jest.fn(),
  },
}));

jest.mock("../src/services/ai/adapters/ai-orchestrator", () => ({
  __esModule: true,
  default: {
    handleMessage: jest.fn(),
  },
}));

jest.mock("../src/services/ai/jobs/tryon-asset.service", () => ({
  __esModule: true,
  default: {
    getAssetById: jest.fn(),
  },
}));

jest.mock("../src/config/ai.config", () => ({
  __esModule: true,
  assertAiConfig: jest.fn(),
  default: {
    gemini: {
      primaryModel: "gemini-test",
      maxContextMessages: 12,
      maxSummaryChars: 2500,
    },
  },
}));

import aiChatService from "../src/services/ai/ai-chat.service";
import aiSessionService from "../src/services/ai/memory/session.service";
import aiMessageService from "../src/services/ai/memory/message.service";
import aiToolCallService from "../src/services/ai/memory/tool-call.service";
import tryOnAssetService from "../src/services/ai/jobs/tryon-asset.service";
import {
  AiAgentType,
  AiSessionMode,
} from "../src/models/ai/ai.model";
import { RolUsuario } from "../src/models/usuario.model";

const mockedSessionService = aiSessionService as jest.Mocked<
  typeof aiSessionService
>;
const mockedMessageService = aiMessageService as jest.Mocked<
  typeof aiMessageService
>;
const mockedToolCallService = aiToolCallService as jest.Mocked<
  typeof aiToolCallService
>;
const mockedTryOnAssetService = tryOnAssetService as jest.Mocked<
  typeof tryOnAssetService
>;

describe("AiChatService.getSessionDetail", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedSessionService.listSessionsByUser.mockResolvedValue([]);
  });

  it("retorna session null y evita queries secundarias cuando la sesion no existe", async () => {
    mockedSessionService.getSessionById.mockResolvedValue(null);

    const result = await aiChatService.getSessionDetail(
      "missing-session",
      "user-1",
    );

    expect(result).toEqual({
      session: null,
      messages: [],
      toolCalls: [],
    });
    expect(mockedMessageService.listMessagesBySession).not.toHaveBeenCalled();
    expect(mockedToolCallService.listToolCallsBySession).not.toHaveBeenCalled();
  });

  it("retorna detalle completo cuando la sesion existe", async () => {
    mockedSessionService.getSessionById.mockResolvedValue({
      id: "session-1",
      userId: "user-1",
      mode: AiSessionMode.AUTHENTICATED,
    } as never);
    mockedMessageService.listMessagesBySession.mockResolvedValue([
      { id: "msg-1" },
    ] as never);
    mockedToolCallService.listToolCallsBySession.mockResolvedValue([
      { id: "tool-1" },
    ] as never);

    const result = await aiChatService.getSessionDetail("session-1", "user-1");

    expect(result).toEqual({
      session: {
        id: "session-1",
        userId: "user-1",
        mode: AiSessionMode.AUTHENTICATED,
      },
      messages: [{ id: "msg-1" }],
      toolCalls: [{ id: "tool-1" }],
    });
    expect(mockedMessageService.listMessagesBySession).toHaveBeenCalledWith(
      "session-1",
    );
    expect(mockedToolCallService.listToolCallsBySession).toHaveBeenCalledWith(
      "session-1",
    );
  });

  it.each([
    {
      mode: AiSessionMode.GUEST,
      ownerId: "guest:owner",
      requesterId: "user-1",
    },
    {
      mode: AiSessionMode.AUTHENTICATED,
      ownerId: "user-2",
      requesterId: "user-1",
    },
  ])("bloquea detalle de sesion guest o ajena", async (session) => {
    mockedSessionService.getSessionById.mockResolvedValue({
      id: "session-denied",
      userId: session.ownerId,
      mode: session.mode,
    } as never);

    await expect(
      aiChatService.getSessionDetail("session-denied", session.requesterId),
    ).resolves.toEqual({ session: null, messages: [], toolCalls: [] });
    expect(mockedMessageService.listMessagesBySession).not.toHaveBeenCalled();
    expect(mockedToolCallService.listToolCallsBySession).not.toHaveBeenCalled();
  });

  it("impide que ADMIN opere la sesion autenticada de otro usuario", async () => {
    mockedSessionService.getSessionById.mockResolvedValue({
      id: "customer-session",
      userId: "customer-1",
      mode: AiSessionMode.AUTHENTICATED,
    } as never);

    await expect(
      aiChatService.assertMessageExecutionReady({
        sessionId: "customer-session",
        userId: "admin-1",
        role: RolUsuario.ADMIN,
        message: "actualiza el precio",
      }),
    ).rejects.toMatchObject({ code: "AI_FORBIDDEN", statusCode: 403 });
  });

  it("acepta una sesion legacy como Shopping Agent", async () => {
    mockedSessionService.getSessionById.mockResolvedValue({
      id: "legacy-session",
      userId: "user-1",
      mode: AiSessionMode.AUTHENTICATED,
    } as never);

    await expect(
      aiChatService.assertMessageExecutionReady({
        sessionId: "legacy-session",
        userId: "user-1",
        role: RolUsuario.CLIENTE,
        message: "Busca un jersey",
      }),
    ).resolves.toBeUndefined();
  });

  it("la ruta shopping oculta una sesion Admin Copilot incluso a su owner", async () => {
    mockedSessionService.getSessionById.mockResolvedValue({
      id: "admin-session",
      userId: "admin-1",
      role: RolUsuario.ADMIN,
      mode: AiSessionMode.AUTHENTICATED,
      agentType: AiAgentType.ADMIN,
    } as never);

    await expect(
      aiChatService.assertMessageExecutionReady({
        sessionId: "admin-session",
        userId: "admin-1",
        role: RolUsuario.ADMIN,
        message: "Consulta inventario privado",
      }),
    ).rejects.toMatchObject({ code: "AI_SESSION_NOT_FOUND", statusCode: 404 });
  });

  it("solo un ADMIN real puede crear una sesion Admin Copilot", async () => {
    await expect(
      aiChatService.createAdminSession({
        userId: "customer-1",
        role: RolUsuario.CLIENTE,
        channel: "admin-web",
      }),
    ).rejects.toMatchObject({ code: "AI_FORBIDDEN", statusCode: 403 });
    expect(mockedSessionService.createSession).not.toHaveBeenCalled();

    mockedSessionService.createSession.mockResolvedValue({
      id: "admin-session",
      userId: "admin-1",
      role: RolUsuario.ADMIN,
      mode: AiSessionMode.AUTHENTICATED,
      agentType: AiAgentType.ADMIN,
    } as never);

    await aiChatService.createAdminSession({
      userId: "admin-1",
      role: RolUsuario.ADMIN,
      channel: "admin-web",
    });

    expect(mockedSessionService.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "admin-1",
        role: RolUsuario.ADMIN,
        agentType: AiAgentType.ADMIN,
      }),
    );
  });

  it("persiste Shopping Agent por defecto sin aceptar tipo del cliente", async () => {
    mockedSessionService.createSession.mockResolvedValue({
      id: "shopping-session",
      userId: "customer-1",
      role: RolUsuario.CLIENTE,
      mode: AiSessionMode.AUTHENTICATED,
      agentType: AiAgentType.SHOPPING,
    } as never);

    await aiChatService.createSession({
      userId: "customer-1",
      role: RolUsuario.CLIENTE,
      channel: "storefront",
    });

    expect(mockedSessionService.createSession).toHaveBeenCalledWith(
      expect.objectContaining({ agentType: AiAgentType.SHOPPING }),
    );
  });

  it("bloquea a no-admin y conserva ownership en Admin Copilot", async () => {
    mockedSessionService.getSessionById.mockResolvedValue({
      id: "admin-session",
      userId: "admin-owner",
      role: RolUsuario.ADMIN,
      mode: AiSessionMode.AUTHENTICATED,
      agentType: AiAgentType.ADMIN,
    } as never);

    await expect(
      aiChatService.assertAdminMessageExecutionReady({
        sessionId: "admin-session",
        userId: "customer-1",
        role: RolUsuario.CLIENTE,
        message: "Diagnostica inventario",
      }),
    ).rejects.toMatchObject({ code: "AI_FORBIDDEN", statusCode: 403 });

    await expect(
      aiChatService.assertAdminMessageExecutionReady({
        sessionId: "admin-session",
        userId: "other-admin",
        role: RolUsuario.ADMIN,
        message: "Diagnostica inventario",
      }),
    ).rejects.toMatchObject({ code: "AI_FORBIDDEN", statusCode: 403 });

    await expect(
      aiChatService.assertAdminMessageExecutionReady({
        sessionId: "admin-session",
        userId: "admin-owner",
        role: RolUsuario.ADMIN,
        message: "Diagnostica inventario",
      }),
    ).resolves.toBeUndefined();
  });

  it("acepta un asset propio en la sesion autenticada", async () => {
    mockedSessionService.getSessionById.mockResolvedValue({
      id: "customer-session",
      userId: "user-1",
      mode: AiSessionMode.AUTHENTICATED,
    } as never);
    mockedTryOnAssetService.getAssetById.mockResolvedValue({
      id: "asset-user-1",
      userId: "user-1",
    } as never);

    await expect(
      aiChatService.assertMessageExecutionReady({
        sessionId: "customer-session",
        userId: "user-1",
        role: RolUsuario.CLIENTE,
        message: "muestra el producto de mi foto",
        attachments: [
          {
            assetId: "asset-user-1",
            mimeType: "image/jpeg",
            kind: "user_upload" as never,
          },
        ],
      }),
    ).resolves.toBeUndefined();
  });

  it("oculta un asset ajeno con la misma respuesta que uno inexistente", async () => {
    mockedSessionService.getSessionById.mockResolvedValue({
      id: "customer-session",
      userId: "user-1",
      mode: AiSessionMode.AUTHENTICATED,
    } as never);

    for (const asset of [
      { id: "asset-user-2", userId: "user-2" },
      null,
    ]) {
      mockedTryOnAssetService.getAssetById.mockResolvedValueOnce(asset as never);

      await expect(
        aiChatService.assertMessageExecutionReady({
          sessionId: "customer-session",
          userId: "user-1",
          role: RolUsuario.CLIENTE,
          message: "muestra el producto de esta foto",
          attachments: [
            {
              assetId: asset?.id || "missing-asset",
              mimeType: "image/jpeg",
              kind: "user_upload" as never,
            },
          ],
        }),
      ).rejects.toMatchObject({
        code: "AI_ATTACHMENT_NOT_FOUND",
        message: "Adjunto AI no encontrado",
        statusCode: 404,
      });
    }
  });
});
