import {
  buildNotificationDeepLink,
  buildNotificationFingerprint,
  bypassesQuietHours,
  getNotificationDayKey,
  isWithinQuietHours,
} from "../src/services/notifications/notification.utils";

describe("notification.utils", () => {
  it("builds a stable fingerprint for the same input", () => {
    const first = buildNotificationFingerprint(
      "order_confirmed",
      "uid_123",
      "orden_001",
    );
    const second = buildNotificationFingerprint(
      "order_confirmed",
      "uid_123",
      "orden_001",
    );

    expect(first).toHaveLength(64);
    expect(second).toBe(first);
  });

  it("builds the expected deep links for Flutter navigation", () => {
    expect(buildNotificationDeepLink("product", "prod_1")).toEqual({
      deeplink: "clubleon://shop/product/prod_1",
      screen: "product_detail",
    });

    expect(buildNotificationDeepLink("order", "orden_9")).toEqual({
      deeplink: "clubleon://shop/order/orden_9",
      screen: "order_detail",
    });

    expect(buildNotificationDeepLink("cart", "cart_1")).toEqual({
      deeplink: "clubleon://shop/cart",
      screen: "cart",
    });

    expect(buildNotificationDeepLink("streak", "uid_1")).toEqual({
      deeplink: "clubleon://racha",
      screen: "racha",
    });
  });

  it("respects quiet hours and day keys using timezone-aware logic", () => {
    const overnightQuietHours = {
      enabled: true,
      startHour: 22,
      endHour: 9,
    };

    const lateNightUtc = new Date("2026-03-15T04:30:00.000Z");
    const noonUtc = new Date("2026-03-15T18:00:00.000Z");

    expect(
      isWithinQuietHours(
        lateNightUtc,
        "America/Mexico_City",
        overnightQuietHours,
      ),
    ).toBe(true);
    expect(
      isWithinQuietHours(noonUtc, "America/Mexico_City", overnightQuietHours),
    ).toBe(false);
    expect(getNotificationDayKey(noonUtc, "America/Mexico_City")).toBe(
      "2026-03-15",
    );
  });

  it("lets streak reminders bypass quiet hours without changing order logic", () => {
    expect(bypassesQuietHours("streak_reminder")).toBe(true);
    expect(bypassesQuietHours("order_confirmed")).toBe(true);
    expect(bypassesQuietHours("cart_abandoned")).toBe(false);
    expect(bypassesQuietHours("inactive_user")).toBe(false);
  });
});
