/// <reference types="jest" />

import { NotificationEvent } from "../src/models/notificacion.model";

describe("notificationEligibilityService", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  const loadService = ({
    preferences,
    isEventEnabled = true,
    devices,
    userData,
    deliveryDocs = [],
  }: {
    preferences?: Record<string, unknown>;
    isEventEnabled?: boolean;
    devices: Array<Record<string, unknown>>;
    userData?: Record<string, unknown> | null;
    deliveryDocs?: Array<{ data: () => Record<string, unknown> }>;
  }) => {
    const orderByMock = jest.fn();
    const whereMock = jest.fn().mockReturnValue({
      get: jest.fn().mockResolvedValue({
        docs: deliveryDocs,
        empty: deliveryDocs.length === 0,
      }),
      orderBy: orderByMock,
    });
    const collectionMock = jest.fn().mockReturnValue({
      where: whereMock,
    });

    jest.doMock("../src/config/firebase", () => ({
      firestoreTienda: {
        collection: collectionMock,
      },
    }));
    jest.doMock("../src/services/notifications/notification-preferences.service", () => ({
      __esModule: true,
      default: {
        getPreferences: jest.fn().mockResolvedValue({
          userId: "uid_streak",
          pushEnabled: true,
          streakRemindersEnabled: true,
          quietHours: { enabled: true, startHour: 22, endHour: 9 },
          timezone: "America/Mexico_City",
          locale: "es-MX",
          maxMarketingPerDay: 2,
          ...preferences,
        }),
        isEventEnabled: jest.fn().mockReturnValue(isEventEnabled),
      },
    }));
    jest.doMock("../src/services/notifications/device-token.service", () => ({
      __esModule: true,
      default: {
        getActiveTokens: jest.fn().mockResolvedValue(devices),
      },
    }));
    jest.doMock("../src/services/notifications/user-context.service", () => ({
      __esModule: true,
      default: {
        getUserData: jest.fn().mockResolvedValue(userData),
      },
    }));

    const notificationEligibilityService =
      require("../src/services/notifications/notification-eligibility.service").default;
    const { evaluateRachaRisk } = require("../src/utils/racha-risk.util");

    return {
      notificationEligibilityService,
      evaluateRachaRisk,
      orderByMock,
      whereMock,
    };
  };

  const buildStreakEvent = (
    overrides: Partial<NotificationEvent> = {},
  ): NotificationEvent => ({
    id: "streak_event_1",
    eventType: "streak_reminder",
    category: "streak",
    userId: "uid_streak",
    entityType: "streak",
    entityId: "uid_streak",
    fingerprint: "streak_fingerprint_1",
    deliveryMode: "token",
    priority: "high",
    status: "queued",
    sourceData: {},
    createdAt: {} as NotificationEvent["createdAt"],
    updatedAt: {} as NotificationEvent["updatedAt"],
    ...overrides,
  });

  const activeDevice = {
    id: "ios-1",
    token: "token_1",
    enabled: true,
    timezone: "America/Mexico_City",
  };

  it("returns no_active_tokens without throwing when timezone env contains CRLF", async () => {
    process.env.NOTIFICATIONS_DEFAULT_TIMEZONE = "America/Mexico_City\r\n";
    process.env.NOTIFICATIONS_DEFAULT_LOCALE = "es-MX\r\n";

    const { notificationEligibilityService } = loadService({
      devices: [],
      preferences: { timezone: "America/Mexico_City\r\n" },
    });

    const result = await notificationEligibilityService.evaluate({
      id: "event_1",
      eventType: "order_created",
      category: "order",
      userId: "uid_123",
      orderId: "order_1",
      entityType: "order",
      entityId: "order_1",
      fingerprint: "fingerprint_1",
      deliveryMode: "token",
      priority: "high",
      status: "queued",
      sourceData: {},
      createdAt: {} as any,
      updatedAt: {} as any,
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("no_active_tokens");
    expect(result.timezone).toBe("America/Mexico_City");
    expect(result.localDayKey).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("allows streak_reminder during quiet hours without querying delivery history", async () => {
    const { evaluateRachaRisk } = require("../src/utils/racha-risk.util");
    const atRisk = evaluateRachaRisk({
      streakCount: 1,
      streakLastDay: evaluateRachaRisk({ streakCount: 1 }).yesterdayKey,
    });
    const { notificationEligibilityService, orderByMock, whereMock } = loadService({
      devices: [activeDevice],
      userData: {
        activo: true,
        streakCount: 1,
        streakLastDay: atRisk.yesterdayKey,
      },
    });

    const result = await notificationEligibilityService.evaluate(
      buildStreakEvent({
        sourceData: {
          dayKey: atRisk.todayKey,
          streakCount: 1,
          streakLastDay: atRisk.yesterdayKey,
        },
      }),
    );

    expect(result.allowed).toBe(true);
    expect(orderByMock).not.toHaveBeenCalled();
    expect(whereMock).toHaveBeenCalledWith(
      "fingerprint",
      "==",
      "streak_fingerprint_1",
    );
    expect(whereMock).not.toHaveBeenCalledWith("userId", "==", "uid_streak");
  });

  it("skips streak_reminder when the user already claimed today", async () => {
    const { evaluateRachaRisk } = require("../src/utils/racha-risk.util");
    const today = evaluateRachaRisk({ streakCount: 2 }).todayKey;
    const { notificationEligibilityService, orderByMock } = loadService({
      devices: [activeDevice],
      userData: {
        activo: true,
        streakCount: 2,
        streakLastDay: today,
      },
    });

    const result = await notificationEligibilityService.evaluate(
      buildStreakEvent({
        sourceData: { dayKey: today, streakCount: 2, streakLastDay: today },
      }),
    );

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("streak_already_claimed_today");
    expect(orderByMock).not.toHaveBeenCalled();
  });

  it("skips streak_reminder when the streak is not at risk", async () => {
    const { notificationEligibilityService } = loadService({
      devices: [activeDevice],
      userData: {
        activo: true,
        streakCount: 4,
        streakLastDay: "2026-01-01",
      },
    });

    const result = await notificationEligibilityService.evaluate(buildStreakEvent());

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("streak_not_at_risk");
  });

  it("skips streak_reminder when the preference is disabled", async () => {
    const { notificationEligibilityService, whereMock } = loadService({
      devices: [activeDevice],
      isEventEnabled: false,
    });

    const result = await notificationEligibilityService.evaluate(buildStreakEvent());

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("preferences_disabled");
    expect(whereMock).not.toHaveBeenCalled();
  });

  it("skips streak_reminder when a push was already sent for the same fingerprint", async () => {
    const { evaluateRachaRisk } = require("../src/utils/racha-risk.util");
    const atRisk = evaluateRachaRisk({
      streakCount: 3,
      streakLastDay: evaluateRachaRisk({ streakCount: 3 }).yesterdayKey,
    });
    const { notificationEligibilityService, orderByMock } = loadService({
      devices: [activeDevice],
      userData: {
        activo: true,
        streakCount: 3,
        streakLastDay: atRisk.yesterdayKey,
      },
      deliveryDocs: [
        {
          data: () => ({
            status: "sent",
            channel: "push",
            fingerprint: "streak_fingerprint_1",
          }),
        },
      ],
    });

    const result = await notificationEligibilityService.evaluate(buildStreakEvent());

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("duplicate_delivery");
    expect(orderByMock).not.toHaveBeenCalled();
  });
});
