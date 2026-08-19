import {
  broadcastNotificationSchema,
  manualNotificationTestSchema,
} from "../src/middleware/validators/notification.validator";
import { resolveNotificationCategory } from "../src/services/notifications/notification.utils";

describe("manual notification validators", () => {
  it("accepts a valid /prueba payload", () => {
    const parsed = manualNotificationTestSchema.parse({
      userId: "uid_123",
      title: "Hola",
      body: "Entra para ver novedades",
      deeplink: "clubleon://shop/home",
      screen: "home",
      priority: "high",
    });

    expect(parsed.userId).toBe("uid_123");
    expect(parsed.title).toBe("Hola");
  });

  it("accepts a broadcast to all users when userIds is omitted", () => {
    const parsed = broadcastNotificationSchema.parse({
      title: "Hola",
      body: "Entra para ver novedades",
    });

    expect(parsed.userIds).toBeUndefined();
    expect(parsed.body).toContain("novedades");
  });

  it("accepts a targeted broadcast list", () => {
    const parsed = broadcastNotificationSchema.parse({
      title: "Hola",
      body: "Entra para ver novedades",
      userIds: ["uid_a", "uid_b"],
      deeplink: "clubleon://shop/home",
      screen: "home",
    });

    expect(parsed.userIds).toEqual(["uid_a", "uid_b"]);
  });

  it("maps manual_broadcast to test category", () => {
    expect(resolveNotificationCategory("manual_broadcast")).toBe("test");
    expect(resolveNotificationCategory("manual_test")).toBe("test");
  });
});
