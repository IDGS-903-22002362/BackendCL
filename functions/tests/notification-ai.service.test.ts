jest.mock("../src/services/ai/adapters/gemini.adapter", () => ({
  __esModule: true,
  default: {
    generateStructured: jest.fn(),
  },
}));

import geminiAdapter from "../src/services/ai/adapters/gemini.adapter";
import notificationAiService from "../src/services/notifications/notification-ai.service";
import { NotificationEvent } from "../src/models/notificacion.model";

const mockedGeminiAdapter = geminiAdapter as jest.Mocked<typeof geminiAdapter>;

describe("notificationAiService", () => {
  const baseEvent: NotificationEvent = {
    id: "event_1",
    eventType: "price_drop",
    category: "price_drop",
    userId: "uid_123",
    productId: "prod_1",
    entityType: "product",
    entityId: "prod_1",
    fingerprint: "fingerprint_1",
    deliveryMode: "token",
    priority: "normal",
    status: "queued",
    sourceData: {
      productName: "Jersey Local 2026",
      precioAnterior: 1599,
      precioNuevo: 1299,
    },
    createdAt: {} as any,
    updatedAt: {} as any,
  };

  beforeEach(() => {
    jest.resetAllMocks();
  });

  it("falls back to deterministic copy when Gemini fails", async () => {
    mockedGeminiAdapter.generateStructured.mockRejectedValueOnce(
      new Error("gemini unavailable"),
    );

    const copy = await notificationAiService.generateCopy(baseEvent);

    expect(copy.source).toBe("fallback");
    expect(copy.title).toBe("Bajó de precio");
    expect(copy.body).toContain("Jersey Local 2026");
    expect(copy.deeplink).toBe("clubleon://shop/product/prod_1");
    expect(copy.screen).toBe("product_detail");
  });

  it("accepts valid structured output from Gemini", async () => {
    mockedGeminiAdapter.generateStructured.mockResolvedValueOnce({
      send: true,
      title: "Regresa por tu jersey",
      body: "Detectamos mejor precio para tu jersey favorito.",
      deeplink: "clubleon://shop/product/prod_1",
      category: "price_drop",
      priority: "high",
      reasoningTag: "price_drop",
      screen: "product_detail",
    });

    const copy = await notificationAiService.generateCopy(baseEvent);

    expect(copy.source).toBe("ai");
    expect(copy.priority).toBe("high");
    expect(copy.title).toBe("Regresa por tu jersey");
  });

  it("builds fallback copy for product rating reminders", async () => {
    mockedGeminiAdapter.generateStructured.mockRejectedValueOnce(
      new Error("gemini unavailable"),
    );

    const copy = await notificationAiService.generateCopy({
      ...baseEvent,
      eventType: "product_rating_reminder",
      category: "recommendation",
      sourceData: {
        productName: "Gorra Edición Especial",
      },
    });

    expect(copy.source).toBe("fallback");
    expect(copy.title).toBe("Califica tu compra");
    expect(copy.body).toContain("Gorra Edición Especial");
    expect(copy.deeplink).toBe("clubleon://shop/product/prod_1");
  });

  it("uses deterministic streak copy without calling Gemini", async () => {
    const copy = await notificationAiService.generateCopy({
      ...baseEvent,
      eventType: "streak_reminder",
      category: "streak",
      entityType: "streak",
      entityId: "uid_123",
      priority: "high",
      sourceData: {
        streakCount: 12,
        dayKey: "2026-08-27",
      },
    });

    expect(mockedGeminiAdapter.generateStructured).not.toHaveBeenCalled();
    expect(copy.source).toBe("fallback");
    expect(copy.title).toBe("¿Vas a dejar perder tu Fiera Racha?");
    expect(copy.body).toContain("12 días");
    expect(copy.deeplink).toBe("clubleon://racha");
    expect(copy.screen).toBe("racha");
    expect(copy.priority).toBe("high");
  });

  it("uses deterministic birthday copy without calling Gemini", async () => {
    const copy = await notificationAiService.generateCopy({
      ...baseEvent,
      eventType: "birthday",
      category: "birthday",
      entityType: "user",
      entityId: "uid_123",
      priority: "high",
      sourceData: {
        firstName: "Ignacio",
        dayKey: "2026-08-27",
        yearKey: "2026",
      },
    });

    expect(mockedGeminiAdapter.generateStructured).not.toHaveBeenCalled();
    expect(copy.source).toBe("fallback");
    expect(copy.title).toBe("¡Feliz cumpleaños, Ignacio!");
    expect(copy.body).toContain("celebra");
    expect(copy.deeplink).toBe("clubleon://shop/home");
    expect(copy.screen).toBe("home");
  });
});
