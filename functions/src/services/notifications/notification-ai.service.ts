import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import aiConfig from "../../config/ai.config";
import notificationConfig from "../../config/notification.config";
import {
  GeneratedPushCopy,
  NotificationCategory,
  NotificationEvent,
} from "../../models/notificacion.model";
import logger from "../../utils/logger";
import geminiAdapter from "../ai/adapters/gemini.adapter";
import { buildNotificationDeepLink } from "./notification.utils";

const generatedPushCopySchema = z
  .object({
    send: z.boolean(),
    title: z.string().trim().min(1).max(80),
    body: z.string().trim().min(1).max(180),
    deeplink: z.string().trim().min(1).max(200),
    category: z.enum([
      "order",
      "cart",
      "restock",
      "price_drop",
      "promo",
      "matchday",
      "reactivation",
      "recommendation",
      "test",
    ]),
    priority: z.enum(["normal", "high"]),
    reasoningTag: z.string().trim().min(1).max(80),
    screen: z.string().trim().min(1).max(80),
  })
  .strict();

class NotificationAiService {
  private readonly baseLogger = logger.child({
    component: "notification-ai-service",
  });

  private truncate(value: unknown, max = 120): string | undefined {
    if (typeof value !== "string") {
      return undefined;
    }

    const normalized = value.trim();
    if (!normalized) {
      return undefined;
    }

    return normalized.slice(0, max);
  }

  private resolveProductLabel(event: NotificationEvent): string {
    return (
      this.truncate(event.sourceData?.productName) ||
      this.truncate(event.sourceData?.descripcion) ||
      "tu producto favorito"
    );
  }

  private resolveCampaignLabel(event: NotificationEvent): string {
    return (
      this.truncate(event.sourceData?.campaignTitle) ||
      this.truncate(event.sourceData?.promoTitle) ||
      this.truncate(event.sourceData?.title) ||
      "la campaña del Club León"
    );
  }

  private fallbackCopy(event: NotificationEvent): GeneratedPushCopy {
    const deepLink = buildNotificationDeepLink(event.entityType, event.entityId);
    const orderShortId = event.orderId ? event.orderId.slice(0, 8) : "pedido";
    const productLabel = this.resolveProductLabel(event);
    const campaignLabel = this.resolveCampaignLabel(event);

    const base = {
      send: true,
      deeplink: deepLink.deeplink,
      screen: deepLink.screen,
      category: event.category,
      priority: event.priority,
      promptVersion: notificationConfig.ai.promptVersion,
      modelVersion: notificationConfig.ai.modelVersion,
      source: "fallback" as const,
    };

    switch (event.eventType) {
      case "order_created":
        return {
          ...base,
          title: "Tu pedido ya entró al juego",
          body: `Recibimos tu pedido ${orderShortId}. En cuanto avance te avisamos por aquí.`,
          reasoningTag: "order_created",
        };
      case "order_confirmed":
        return {
          ...base,
          title: "Pago confirmado",
          body: `Tu pedido ${orderShortId} ya quedó confirmado. Seguimos con la preparación.`,
          reasoningTag: "order_confirmed",
        };
      case "order_shipped":
        return {
          ...base,
          title: "Tu pedido va en camino",
          body: `El pedido ${orderShortId} ya salió rumbo a ti. Revisa el detalle desde la app.`,
          reasoningTag: "order_shipped",
        };
      case "order_delivered":
        return {
          ...base,
          title: "Pedido entregado",
          body: `Tu pedido ${orderShortId} ya fue entregado. Gracias por comprar en la tienda del León.`,
          reasoningTag: "order_delivered",
        };
      case "cart_abandoned":
        return {
          ...base,
          title: "Tu carrito sigue listo",
          body: "Dejaste productos esperando. Si aún los quieres, vuelve a tu carrito y termina la compra.",
          reasoningTag: "cart_abandoned",
        };
      case "product_restocked":
        return {
          ...base,
          title: "Volvió al stock",
          body: `${productLabel} ya está disponible otra vez en la tienda oficial.`,
          reasoningTag: "product_restocked",
        };
      case "price_drop":
        return {
          ...base,
          title: "Bajó de precio",
          body: `${productLabel} tiene nuevo precio. Revísalo antes de que cambie otra vez.`,
          reasoningTag: "price_drop",
        };
      case "product_rating_reminder":
        return {
          ...base,
          title: "Califica tu compra",
          body: `¿Qué te pareció ${productLabel}? Tu calificación del 1 al 5 nos ayuda a mejorar.`,
          reasoningTag: "product_rating_reminder",
        };
      case "inactive_user":
        return {
          ...base,
          title: "La tienda te espera",
          body: "Hay novedades y productos del Club León que pueden interesarte. Date una vuelta en la app.",
          reasoningTag: "inactive_user",
        };
      case "matchday_campaign":
        return {
          ...base,
          title: "Matchday en la tienda",
          body: `${campaignLabel}. Revisa lo que ya está disponible para vivir el partido con la Fiera.`,
          reasoningTag: "matchday_campaign",
        };
      case "promo_campaign":
        return {
          ...base,
          title: "Hay promo en la tienda",
          body: `${campaignLabel}. Entra y revisa los productos participantes.`,
          reasoningTag: "promo_campaign",
        };
      case "probable_repurchase":
        return {
          ...base,
          title: "Nueva vuelta por la tienda",
          body: "Detectamos productos que pueden volver a interesarte. Entra y revisa opciones similares.",
          reasoningTag: "probable_repurchase",
        };
      case "manual_test":
        return {
          ...base,
          title:
            this.truncate(event.sourceData?.title, 80) ||
            "Prueba de notificaciones Club León",
          body:
            this.truncate(event.sourceData?.body, 180) ||
            "Esta es una notificación de prueba desde el backend.",
          deeplink:
            this.truncate(event.sourceData?.deeplink, 200) || deepLink.deeplink,
          screen:
            this.truncate(event.sourceData?.screen, 80) || deepLink.screen,
          category:
            (this.truncate(event.sourceData?.category, 20) as NotificationCategory) ||
            "test",
          priority:
            this.truncate(event.sourceData?.priority, 10) === "high"
              ? "high"
              : "normal",
          reasoningTag: "manual_test",
        };
      default:
        return {
          ...base,
          title: "Nueva notificación de Club León",
          body: "Tenemos una actualización para ti dentro de la tienda oficial.",
          reasoningTag: "default",
        };
    }
  }

  async generateCopy(event: NotificationEvent): Promise<GeneratedPushCopy> {
    const fallback = this.fallbackCopy(event);

    try {
      const responseJsonSchema = zodToJsonSchema(generatedPushCopySchema, {
        target: "jsonSchema7",
        $refStrategy: "none",
      }) as Record<string, unknown>;
      delete responseJsonSchema.$schema;
      delete responseJsonSchema.$defs;
      delete responseJsonSchema.definitions;

      const rawCopy = await geminiAdapter.generateStructured<
        z.infer<typeof generatedPushCopySchema>
      >({
        model: aiConfig.gemini.fastModel,
        systemInstruction: [
          "Eres el copywriter de notificaciones push de la tienda oficial del Club León.",
          "Responde solo JSON válido que siga el schema.",
          "Tono: cercano, deportivo, claro, útil y sin urgencias falsas.",
          "No incluyas datos sensibles, precios exactos si no vienen en el contexto, ni inventes promociones.",
          "Title max 80 chars. Body max 180 chars. Español de México.",
        ].join("\n"),
        prompt: JSON.stringify(
          {
            brand: "Club León",
            promptVersion: notificationConfig.ai.promptVersion,
            event: {
              eventType: event.eventType,
              category: event.category,
              priority: event.priority,
              entityType: event.entityType,
              entityId: event.entityId,
              sourceData: event.sourceData,
            },
            fallback,
          },
          null,
          2,
        ),
        responseJsonSchema,
      });

      const parsed = generatedPushCopySchema.parse(rawCopy);

      return {
        ...parsed,
        promptVersion: notificationConfig.ai.promptVersion,
        modelVersion: aiConfig.gemini.fastModel,
        source: "ai",
      };
    } catch (error) {
      this.baseLogger.warn("notification_ai_fallback", {
        eventId: event.id,
        eventType: event.eventType,
        reason: error instanceof Error ? error.message : String(error),
      });

      return fallback;
    }
  }
}

export const notificationAiService = new NotificationAiService();
export default notificationAiService;
