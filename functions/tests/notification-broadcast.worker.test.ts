const sendBroadcastChunk = jest.fn();
const persistBroadcastResults = jest.fn();
const disableTokensBulk = jest.fn();
const chunkSet = jest.fn();
const runTransaction = jest.fn();

let chunkState: Record<string, unknown> | null = null;
let jobState: Record<string, unknown> | null = null;
const transactionUpdates: Array<Record<string, unknown>> = [];

jest.mock("../src/config/firebase", () => ({
  firestoreTienda: {
    collection: jest.fn((name: string) => ({
      doc: jest.fn(() => ({
        id: name === "notificacionBroadcastLotes" ? "chunk_1" : "broadcast_1",
        set: chunkSet,
      })),
    })),
    runTransaction: (handler: (tx: unknown) => Promise<unknown>) =>
      runTransaction(handler),
  },
}));

jest.mock("../src/services/notifications/notification-delivery.service", () => ({
  __esModule: true,
  default: {
    sendBroadcastChunk,
    persistBroadcastResults,
  },
}));

jest.mock("../src/services/notifications/device-token.service", () => ({
  __esModule: true,
  default: {
    disableTokensBulk,
  },
}));

import notificationBroadcastWorkerService from "../src/services/notifications/notification-broadcast-worker.service";

const buildChunk = (status: string) => ({
  broadcastId: "broadcast_1",
  chunkIndex: 0,
  status,
  attempt: 0,
  copy: {
    title: "Hola",
    body: "Cuerpo",
    deeplink: "clubleon://shop/home",
    screen: "home",
    category: "test",
    priority: "normal",
  },
  targets: [
    { userId: "uid_1", deviceId: "d1", token: "token_1" },
    { userId: "uid_2", deviceId: "d2", token: "token_2" },
  ],
});

describe("notificationBroadcastWorkerService.processChunk", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    transactionUpdates.length = 0;
    jobState = { chunksCompleted: 0, totalChunks: 1 };
    chunkSet.mockResolvedValue(undefined);
    disableTokensBulk.mockResolvedValue(0);
    persistBroadcastResults.mockResolvedValue(undefined);

    runTransaction.mockImplementation(async (handler: any) => {
      const transaction = {
        get: async (ref: any) => {
          const isChunk = ref.id === "chunk_1";
          const data = isChunk ? chunkState : jobState;
          return {
            exists: data !== null,
            id: ref.id,
            data: () => data,
          };
        },
        update: (_ref: any, payload: Record<string, unknown>) => {
          transactionUpdates.push(payload);
          if (chunkState && payload.status === "processing") {
            chunkState = { ...chunkState, status: "processing" };
          }
        },
      };
      return handler(transaction);
    });
  });

  it("envia el lote y acumula contadores en el job", async () => {
    chunkState = buildChunk("queued");
    sendBroadcastChunk.mockResolvedValue({
      sent: 2,
      failed: 0,
      invalidTargets: [],
      perTarget: [
        {
          target: { userId: "uid_1", deviceId: "d1", token: "token_1" },
          status: "sent",
        },
        {
          target: { userId: "uid_2", deviceId: "d2", token: "token_2" },
          status: "sent",
        },
      ],
    });

    const result = await notificationBroadcastWorkerService.processChunk(
      "chunk_1",
    );

    expect(result.status).toBe("done");
    expect(result.sent).toBe(2);
    expect(sendBroadcastChunk).toHaveBeenCalledTimes(1);
    expect(persistBroadcastResults).toHaveBeenCalledTimes(1);

    const jobUpdate = transactionUpdates.find(
      (update) => update.chunksCompleted !== undefined,
    );
    expect(jobUpdate?.status).toBe("completed");
  });

  it("no reenvia un lote que ya fue tomado por otra ejecucion", async () => {
    chunkState = buildChunk("processing");

    const result = await notificationBroadcastWorkerService.processChunk(
      "chunk_1",
    );

    expect(result.status).toBe("skipped");
    expect(result.skipReason).toBe("chunk_already_processing");
    expect(sendBroadcastChunk).not.toHaveBeenCalled();
  });

  it("no reenvia un lote ya completado", async () => {
    chunkState = buildChunk("done");

    const result = await notificationBroadcastWorkerService.processChunk(
      "chunk_1",
    );

    expect(result.status).toBe("skipped");
    expect(sendBroadcastChunk).not.toHaveBeenCalled();
  });

  it("desactiva en bloque solo los tokens invalidos", async () => {
    chunkState = buildChunk("queued");
    sendBroadcastChunk.mockResolvedValue({
      sent: 1,
      failed: 1,
      invalidTargets: [
        {
          target: { userId: "uid_2", deviceId: "d2", token: "token_2" },
          reason: "messaging/registration-token-not-registered",
        },
      ],
      perTarget: [
        {
          target: { userId: "uid_1", deviceId: "d1", token: "token_1" },
          status: "sent",
        },
        {
          target: { userId: "uid_2", deviceId: "d2", token: "token_2" },
          status: "invalid_token",
          providerErrorCode: "messaging/registration-token-not-registered",
        },
      ],
    });

    const result = await notificationBroadcastWorkerService.processChunk(
      "chunk_1",
    );

    expect(result.invalidTokens).toBe(1);
    expect(disableTokensBulk).toHaveBeenCalledWith([
      {
        userId: "uid_2",
        deviceId: "d2",
        reason: "messaging/registration-token-not-registered",
      },
    ]);
  });

  it("marca el lote como fallido si FCM revienta", async () => {
    chunkState = buildChunk("queued");
    sendBroadcastChunk.mockRejectedValue(new Error("PERMISSION_DENIED"));

    const result = await notificationBroadcastWorkerService.processChunk(
      "chunk_1",
    );

    expect(result.status).toBe("failed");
    expect(result.skipReason).toBe("PERMISSION_DENIED");
    expect(chunkSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed" }),
      { merge: true },
    );
  });
});
