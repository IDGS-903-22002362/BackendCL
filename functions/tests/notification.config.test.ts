describe("notification.config", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("normalizes CRLF timezone values from env", () => {
    process.env.NOTIFICATIONS_DEFAULT_TIMEZONE = "America/Mexico_City\r\n";

    const {
      notificationConfig,
      resolveNotificationTimezone,
    } = require("../src/config/notification.config");

    expect(notificationConfig.defaults.timezone).toBe("America/Mexico_City");
    expect(
      resolveNotificationTimezone(process.env.NOTIFICATIONS_DEFAULT_TIMEZONE),
    ).toBe("America/Mexico_City");
  });

  it("falls back when timezone is blank", () => {
    process.env.NOTIFICATIONS_DEFAULT_TIMEZONE = "   ";

    const { notificationConfig } = require("../src/config/notification.config");

    expect(notificationConfig.defaults.timezone).toBe("America/Mexico_City");
  });

  it("falls back when timezone is invalid", () => {
    process.env.NOTIFICATIONS_DEFAULT_TIMEZONE = "Mars/Olympus_Mons";

    const {
      notificationConfig,
      resolveNotificationTimezone,
    } = require("../src/config/notification.config");

    expect(notificationConfig.defaults.timezone).toBe("America/Mexico_City");
    expect(resolveNotificationTimezone("Mars/Olympus_Mons")).toBe(
      "America/Mexico_City",
    );
  });
});
