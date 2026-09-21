const listActiveDevices = jest.fn();
const optedOutDocs = jest.fn();
const broadcastDocSet = jest.fn();
const bulkWriterSet = jest.fn();
const bulkWriterClose = jest.fn();

let broadcastDocIdSequence = 0;
const chunkDocRefs: string[] = [];

jest.mock("../src/config/firebase", () => ({
  firestoreTienda: {
    collection: jest.fn((name: string) => ({
      doc: jest.fn((docId?: string) => {
        if (name === "notificacionBroadcasts") {
          return {
            id: docId || `broadcast_${++broadcastDocIdSequence}`,
            set: broadcastDocSet,
          };
        }

        chunkDocRefs.push(docId as string);
        return { id: docId, path: `${name}/${docId}` };
      }),
    })),
    bulkWriter: jest.fn(() => ({
      set: bulkWriterSet,
      close: bulkWriterClose,
    })),
  },
}));

jest.mock("../src/config/app.firebase", () => ({
  firestoreApp: {
    collectionGroup: jest.fn(() => ({
      where: jest.fn(() => ({
        get: optedOutDocs,
      })),
    })),
  },
}));

jest.mock("../src/services/notifications/device-token.service", () => ({
  __esModule: true,
  default: {
    listActiveDevices,
  },
}));

import notificationBroadcastService, {
  BROADCAST_CHUNK_SIZE,
} from "../src/services/notifications/notification-broadcast.service";

const device = (userId: string, deviceId: string, token: string) => ({
  userId,
  deviceId,
  token,
  enabled: true,
});

const optedOut = (userIds: string[]) => ({
  docs: userIds.map((userId) => ({
    data: () => ({ userId, pushEnabled: false }),
    ref: { parent: { parent: { id: userId } } },
  })),
});

describe("notificationBroadcastService.createBroadcast", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    broadcastDocIdSequence = 0;
    chunkDocRefs.length = 0;
    broadcastDocSet.mockResolvedValue(undefined);
    bulkWriterClose.mockResolvedValue(undefined);
    optedOutDocs.mockResolvedValue(optedOut([]));
  });

  it("deduplica tokens repetidos y cuenta usuarios unicos", async () => {
    listActiveDevices.mockResolvedValue([
      device("uid_1", "d1", "token_1"),
      device("uid_1", "d2", "token_2"),
      // Mismo token bajo otro deviceId: no debe enviarse dos veces.
      device("uid_1", "d3", "token_1"),
      device("uid_2", "d4", "token_3"),
    ]);

    const result = await notificationBroadcastService.createBroadcast({
      title: "Hola",
      body: "Entra para ver novedades",
    });

    expect(listActiveDevices).toHaveBeenCalledWith(undefined);
    expect(result.totalTokens).toBe(3);
    expect(result.targetedUsers).toBe(2);
    expect(result.totalChunks).toBe(1);
    expect(result.status).toBe("queued");
  });

  it("excluye usuarios con pushEnabled en false", async () => {
    listActiveDevices.mockResolvedValue([
      device("uid_1", "d1", "token_1"),
      device("uid_2", "d2", "token_2"),
      device("uid_3", "d3", "token_3"),
    ]);
    optedOutDocs.mockResolvedValue(optedOut(["uid_2"]));

    const result = await notificationBroadcastService.createBroadcast({
      title: "Hola",
      body: "Solo para quienes aceptan push",
    });

    expect(result.totalTokens).toBe(2);
    expect(result.targetedUsers).toBe(2);
  });

  it("trocea la audiencia en lotes de 500", async () => {
    const devices = Array.from({ length: 1200 }, (_, index) =>
      device(`uid_${index}`, `d_${index}`, `token_${index}`),
    );
    listActiveDevices.mockResolvedValue(devices);

    const result = await notificationBroadcastService.createBroadcast({
      title: "Hola",
      body: "Broadcast grande",
    });

    expect(BROADCAST_CHUNK_SIZE).toBe(500);
    expect(result.totalTokens).toBe(1200);
    expect(result.totalChunks).toBe(3);
    expect(bulkWriterSet).toHaveBeenCalledTimes(3);

    const chunkSizes = bulkWriterSet.mock.calls.map(
      (call) => (call[1] as { targets: unknown[] }).targets.length,
    );
    expect(chunkSizes).toEqual([500, 500, 200]);
  });

  it("marca el job como completed sin crear lotes cuando no hay audiencia", async () => {
    listActiveDevices.mockResolvedValue([]);

    const result = await notificationBroadcastService.createBroadcast({
      title: "Hola",
      body: "Sin destinatarios",
    });

    expect(result.status).toBe("completed");
    expect(result.totalChunks).toBe(0);
    expect(result.totalTokens).toBe(0);
    expect(bulkWriterSet).not.toHaveBeenCalled();
  });

  it("congela el copy del admin sin pasar por la IA", async () => {
    listActiveDevices.mockResolvedValue([device("uid_1", "d1", "token_1")]);

    await notificationBroadcastService.createBroadcast({
      title: "Titulo del admin",
      body: "Cuerpo del admin",
      priority: "high",
    });

    const job = broadcastDocSet.mock.calls[0][0];
    expect(job.copy).toEqual({
      title: "Titulo del admin",
      body: "Cuerpo del admin",
      deeplink: "clubleon://shop/home",
      screen: "home",
      category: "test",
      priority: "high",
    });
  });

  it("pasa el filtro de userIds al listado de dispositivos", async () => {
    listActiveDevices.mockResolvedValue([device("uid_9", "d9", "token_9")]);

    await notificationBroadcastService.createBroadcast({
      title: "Hola",
      body: "Solo para ti",
      userIds: ["uid_9"],
    });

    expect(listActiveDevices).toHaveBeenCalledWith(["uid_9"]);
  });
});
