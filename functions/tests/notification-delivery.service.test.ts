const storeAddMock = jest.fn();
const appAddMock = jest.fn();
const messagingSendMock = jest.fn();
const markTokenInvalidMock = jest.fn();

jest.mock("../src/config/firebase", () => ({
  firestoreTienda: {
    collection: jest.fn(() => ({
      add: storeAddMock,
    })),
  },
}));

jest.mock("../src/config/app.firebase", () => ({
  firestoreApp: {
    collection: jest.fn(() => ({
      add: appAddMock,
    })),
  },
  messagingAppOficial: {
    send: messagingSendMock,
  },
}));

jest.mock("../src/services/notifications/device-token.service", () => ({
  __esModule: true,
  default: {
    markTokenInvalid: markTokenInvalidMock,
  },
}));

import notificationDeliveryService from "../src/services/notifications/notification-delivery.service";
import {
  GeneratedPushCopy,
  NotificationEligibilityResult,
  NotificationEvent,
} from "../src/models/notificacion.model";

describe("notificationDeliveryService", () => {
  beforeEach(() => {
    let storeSequence = 0;
    let appSequence = 0;

    storeAddMock.mockImplementation(async () => ({
      id: `delivery_${++storeSequence}`,
    }));
    appAddMock.mockImplementation(async () => ({
      id: `system_${++appSequence}`,
    }));
    messagingSendMock.mockReset();
    markTokenInvalidMock.mockReset();
  });

  it("marks invalid tokens when FCM rejects them", async () => {
    const event: NotificationEvent = {
      id: "event_1",
      eventType: "manual_test",
      category: "test",
      userId: "uid_123",
      entityType: "user",
      entityId: "uid_123",
      fingerprint: "fingerprint_1",
      deliveryMode: "token",
      priority: "high",
      status: "queued",
      sourceData: {},
      createdAt: {} as any,
      updatedAt: {} as any,
    };
    const copy: GeneratedPushCopy = {
      send: true,
      title: "Prueba",
      body: "Cuerpo de prueba",
      deeplink: "clubleon://shop/home",
      category: "test",
      priority: "high",
      reasoningTag: "manual_test",
      screen: "home",
      source: "fallback",
    };
    const eligibility: NotificationEligibilityResult = {
      allowed: true,
      devices: [
        {
          userId: "uid_123",
          deviceId: "device_1",
          token: "token_12345678901234567890",
          platform: "android",
          enabled: true,
          createdAt: {} as any,
          updatedAt: {} as any,
          lastSeenAt: {} as any,
        },
      ],
      preference: {} as any,
      localDayKey: "2026-03-15",
      timezone: "America/Mexico_City",
    };

    messagingSendMock.mockRejectedValueOnce({
      code: "messaging/registration-token-not-registered",
      message: "Requested entity was not found.",
    });

    const deliveries = await notificationDeliveryService.deliver(
      event,
      copy,
      eligibility,
    );

    expect(markTokenInvalidMock).toHaveBeenCalledWith(
      "uid_123",
      "device_1",
      "messaging/registration-token-not-registered",
    );
    expect(
      deliveries.some((delivery) => delivery.status === "invalid_token"),
    ).toBe(true);
    expect(
      deliveries.some(
        (delivery) =>
          delivery.channel === "in_app" && delivery.status === "sent",
      ),
    ).toBe(true);
  });
});
