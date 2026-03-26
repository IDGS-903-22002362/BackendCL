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

  it("returns no_active_tokens without throwing when timezone env contains CRLF", async () => {
    process.env.NOTIFICATIONS_DEFAULT_TIMEZONE = "America/Mexico_City\r\n";
    process.env.NOTIFICATIONS_DEFAULT_LOCALE = "es-MX\r\n";

    const getPreferencesMock = jest.fn().mockResolvedValue({
      userId: "uid_123",
      pushEnabled: true,
      transactionalEnabled: true,
      orderUpdatesEnabled: true,
      cartRemindersEnabled: true,
      restockEnabled: true,
      priceDropEnabled: true,
      marketingEnabled: true,
      matchdayEnabled: true,
      reactivationEnabled: true,
      recommendationsEnabled: true,
      quietHours: {
        enabled: true,
        startHour: 22,
        endHour: 9,
      },
      timezone: "America/Mexico_City\r\n",
      locale: "es-MX",
      maxMarketingPerDay: 2,
      createdAt: {} as any,
      updatedAt: {} as any,
    });
    const isEventEnabledMock = jest.fn().mockReturnValue(true);
    const getActiveTokensMock = jest.fn().mockResolvedValue([]);

    jest.doMock("../src/config/firebase", () => ({
      firestoreTienda: {
        collection: jest.fn(),
      },
    }));
    jest.doMock("../src/services/notifications/notification-preferences.service", () => ({
      __esModule: true,
      default: {
        getPreferences: getPreferencesMock,
        isEventEnabled: isEventEnabledMock,
      },
    }));
    jest.doMock("../src/services/notifications/device-token.service", () => ({
      __esModule: true,
      default: {
        getActiveTokens: getActiveTokensMock,
      },
    }));
    jest.doMock("../src/services/notifications/user-context.service", () => ({
      __esModule: true,
      default: {
        getUserData: jest.fn(),
      },
    }));

    const notificationEligibilityService =
      require("../src/services/notifications/notification-eligibility.service").default;

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
});
