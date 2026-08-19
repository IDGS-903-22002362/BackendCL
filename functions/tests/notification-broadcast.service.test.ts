const listActiveDevices = jest.fn();
const enqueueEvent = jest.fn();
const processQueuedEvent = jest.fn();

jest.mock("../src/services/notifications/device-token.service", () => ({
  __esModule: true,
  default: {
    listActiveDevices,
  },
}));

jest.mock("../src/services/notifications/notification-event.service", () => ({
  __esModule: true,
  default: {
    enqueueEvent,
  },
}));

jest.mock("../src/services/notifications/notification-processing.service", () => ({
  __esModule: true,
  default: {
    processQueuedEvent,
  },
}));

import notificationBroadcastService from "../src/services/notifications/notification-broadcast.service";

describe("notificationBroadcastService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("broadcasts to unique users with active devices", async () => {
    listActiveDevices.mockResolvedValue([
      { userId: "uid_1", deviceId: "d1", token: "token_1", enabled: true },
      { userId: "uid_1", deviceId: "d2", token: "token_2", enabled: true },
      { userId: "uid_2", deviceId: "d3", token: "token_3", enabled: true },
    ]);
    enqueueEvent
      .mockResolvedValueOnce({
        event: { id: "evt_1", fingerprint: "fp_1" },
        created: true,
      })
      .mockResolvedValueOnce({
        event: { id: "evt_2", fingerprint: "fp_2" },
        created: true,
      });
    processQueuedEvent
      .mockResolvedValueOnce({
        eventId: "evt_1",
        status: "processed",
        deliveries: [],
      })
      .mockResolvedValueOnce({
        eventId: "evt_2",
        status: "skipped",
        skipReason: "no_active_tokens",
        deliveries: [],
      });

    const result = await notificationBroadcastService.broadcast({
      title: "Hola",
      body: "Entra para ver novedades",
      deeplink: "clubleon://shop/home",
      screen: "home",
    });

    expect(listActiveDevices).toHaveBeenCalledWith(undefined);
    expect(enqueueEvent).toHaveBeenCalledTimes(2);
    expect(enqueueEvent.mock.calls[0][0].eventType).toBe("manual_broadcast");
    expect(result.targetedUsers).toBe(2);
    expect(result.sent).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.failed).toBe(0);
  });

  it("passes userIds filter to device listing", async () => {
    listActiveDevices.mockResolvedValue([
      { userId: "uid_9", deviceId: "d9", token: "token_9", enabled: true },
    ]);
    enqueueEvent.mockResolvedValue({
      event: { id: "evt_9", fingerprint: "fp_9" },
      created: true,
    });
    processQueuedEvent.mockResolvedValue({
      eventId: "evt_9",
      status: "processed",
      deliveries: [],
    });

    await notificationBroadcastService.broadcast({
      title: "Hola",
      body: "Solo para ti",
      userIds: ["uid_9"],
    });

    expect(listActiveDevices).toHaveBeenCalledWith(["uid_9"]);
  });
});
