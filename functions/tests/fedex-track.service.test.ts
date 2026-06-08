import { Timestamp } from "firebase-admin/firestore";
import { RolUsuario } from "../src/models/usuario.model";
import {
  FedexTrackError,
  FedexTrackService,
} from "../src/modules/shipping/fedex/fedex-track.service";

const originalEnv = { ...process.env };

const setEnv = () => {
  process.env.FEDEX_ENV = "sandbox";
  process.env.FEDEX_BASE_URL = "https://apis-sandbox.fedex.com";
  process.env.FEDEX_CLIENT_ID = "client-id";
  process.env.FEDEX_CLIENT_SECRET = "client-secret";
  process.env.FEDEX_ACCOUNT_NUMBER = "740561073";
};

const buildOrder = (overrides: Record<string, unknown> = {}) => ({
  usuarioId: "user_1",
  shipping: {
    provider: "FEDEX",
    trackingNumber: "TRACK123",
  },
  ...overrides,
});

const fedexResponse = (code = "IT", eventDate = "2026-05-12T10:30:00Z") => ({
  output: {
    completeTrackResults: [
      {
        trackingNumber: "TRACK123",
        trackResults: [
          {
            trackingNumberInfo: { trackingNumber: "TRACK123" },
            latestStatusDetail: { code, description: "In transit" },
            scanEvents: [
              {
                date: eventDate,
                eventType: code,
                eventDescription: "In transit",
              },
            ],
          },
        ],
      },
    ],
  },
});

const buildDeps = (order: Record<string, unknown>) => {
  const update = jest.fn().mockResolvedValue(undefined);
  const get = jest.fn().mockResolvedValue({
    exists: true,
    id: "order_1",
    data: () => order,
  });
  const addEvent = jest.fn().mockResolvedValue({ id: "event_1" });
  const post = jest.fn().mockResolvedValue(fedexResponse());
  const db = {
    collection: jest.fn((name: string) => {
      if (name === "ordenes") {
        return { doc: jest.fn(() => ({ get, update })) };
      }
      return { add: addEvent };
    }),
  };

  return { db, client: { post }, update, addEvent, post };
};

describe("FedEx track service", () => {
  beforeEach(() => {
    process.env = { ...originalEnv };
    setEnv();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("enforces customer ownership", async () => {
    const deps = buildDeps(buildOrder());
    const service = new FedexTrackService(deps.db as any, deps.client);

    await expect(
      service.trackOrder({
        orderId: "order_1",
        user: { uid: "other", rol: RolUsuario.CLIENTE },
        admin: false,
      }),
    ).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(deps.post).not.toHaveBeenCalled();
  });

  it("returns customer cache within TTL", async () => {
    const deps = buildDeps(
      buildOrder({
        shipping: {
          provider: "FEDEX",
          trackingNumber: "TRACK123",
          trackingStatus: {
            provider: "FEDEX",
            status: "IN_TRANSIT",
            statusLabel: "En tránsito",
            lastUpdatedAt: Timestamp.fromMillis(Date.now() - 60_000),
            lastCarrierUpdateAt: "2026-05-12T10:30:00Z",
          },
        },
      }),
    );
    const service = new FedexTrackService(deps.db as any, deps.client);

    const result = await service.trackOrder({
      orderId: "order_1",
      user: { uid: "user_1", rol: RolUsuario.CLIENTE },
      admin: false,
    });

    expect(result.status).toBe("IN_TRANSIT");
    expect(deps.post).not.toHaveBeenCalled();
  });

  it("admin force refresh bypasses cache and updates order", async () => {
    const deps = buildDeps(
      buildOrder({
        shipping: {
          provider: "FEDEX",
          trackingNumber: "TRACK123",
          trackingStatus: {
            provider: "FEDEX",
            status: "LABEL_CREATED",
            statusLabel: "Guía creada",
            lastUpdatedAt: Timestamp.fromMillis(Date.now()),
          },
        },
      }),
    );
    const service = new FedexTrackService(deps.db as any, deps.client);

    const result = await service.trackOrder({
      orderId: "order_1",
      user: { uid: "admin", rol: RolUsuario.ADMIN },
      admin: true,
      forceRefresh: true,
      includeDetailedScans: true,
    });

    expect(result.status).toBe("IN_TRANSIT");
    expect(deps.post).toHaveBeenCalledWith(
      "/track/v1/trackingnumbers",
      expect.objectContaining({ includeDetailedScans: true }),
    );
    expect(deps.update).toHaveBeenCalledWith(
      expect.objectContaining({
        "shipping.status": "IN_TRANSIT",
        "shipping.trackingStatus": expect.objectContaining({
          status: "IN_TRANSIT",
        }),
      }),
    );
    expect(deps.addEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "FEDEX_TRACKING_REFRESHED",
        status: "IN_TRANSIT",
      }),
    );
  });

  it("does not create duplicate event when status and event timestamp are unchanged", async () => {
    const deps = buildDeps(
      buildOrder({
        shipping: {
          provider: "FEDEX",
          trackingNumber: "TRACK123",
          trackingStatus: {
            provider: "FEDEX",
            status: "IN_TRANSIT",
            statusLabel: "En tránsito",
            lastEventTimestamp: "2026-05-12T10:30:00Z",
            lastUpdatedAt: Timestamp.fromMillis(Date.now() - 60 * 60 * 1000),
          },
        },
      }),
    );
    const service = new FedexTrackService(deps.db as any, deps.client);

    await service.trackOrder({
      orderId: "order_1",
      user: { uid: "admin", rol: RolUsuario.ADMIN },
      admin: true,
      forceRefresh: true,
    });

    expect(deps.update).toHaveBeenCalled();
    expect(deps.addEvent).not.toHaveBeenCalled();
  });

  it("throws controlled error when order has no FedEx tracking number", async () => {
    const deps = buildDeps(buildOrder({ shipping: { provider: "FEDEX" } }));
    const service = new FedexTrackService(deps.db as any, deps.client);

    await expect(
      service.trackOrder({
        orderId: "order_1",
        user: { uid: "admin", rol: RolUsuario.ADMIN },
        admin: true,
      }),
    ).rejects.toBeInstanceOf(FedexTrackError);
  });
});
