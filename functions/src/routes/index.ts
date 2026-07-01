/**
 * RUTAS PRINCIPALES DEL API
 * ---------------------------------------------------------------------
 * Este archivo actúa como el "Hub Central" de rutas (Pattern: Barrel/Router).
 * Su responsabilidad es agrupar todos los módulos de rutas del sistema
 * y exponerlos como un único router unificado.
 *
 * PARA AGREGAR UN NUEVO MÓDULO:
 * 1. Importa el archivo de rutas (ej: import usersRoutes from './users.routes')
 * 2. Monta la ruta en el router (ej: router.use('/usuarios', usersRoutes))
 */

import { Router } from "express";
import productsRoutes from "./products.routes";
import linesRoutes from "./lines.routes";
import categoriesRoutes from "./categories.routes";
import providersRoutes from "./providers.routes";
import sizesRoutes from "./sizes.routes";
import usersRoutes from "./users.routes";
import authRoutes from "./auth.routes";
import ordenesRoutes from "./ordenes.routes";
import newsRoutes from "./news.routes";
import carritoRoutes from "./carrito.routes";
import checkoutRoutes from "./checkout.routes";
import pagosRoutes from "./pagos.routes";
import stripeRoutes from "./stripe.routes";
import inventoryRoutes from "./inventory.routes";
import plantillaRoutes from "./plantilla.routes";
import aiRoutes from "./ai.routes";
import notificationsRoutes from "./notifications.routes";
import galeriaRoutes from "./galeria.routes";
import favoritosRoutes from "./favorito.routes";
import beneficiosRoutes from "./beneficios.routes";
import ligaMxRoutes from "./liga-mx.routes";
import paymentsV2Routes from "./payments-v2.routes";
import adminPaymentsRoutes from "./admin-payments.routes";
import webhooksRoutes from "./webhooks.routes";
import bannerRoutes from "./banner.routes";
import pickupLocationsRoutes from "./pickup-locations.routes";
import adminPickupLocationsRoutes from "./admin-pickup-locations.routes";
import adminPickupOrdersRoutes from "./admin-pickup-orders.routes";
import adminFedexRoutes from "./admin-fedex.routes";
import adminOrdersFedexRoutes from "./admin-orders-fedex.routes";
import ordersTrackingRoutes from "./orders-tracking.routes";
import shippingRoutes from "../modules/shipping/shipping.routes";
import ofertasRoutes from "./ofertas.routes";
import codigofertasRoutes from "./codigos-promocion.routes";
import recomendacionesRoutes from "./recomendaciones.routes";
import loyaltyRoutes from "../modules/loyalty/routes/loyalty.routes";
import createLoyaltyPartnerRouter from "../modules/loyalty/partner/routes/loyalty-partner.routes";
import { LoyaltyEnvironment } from "../modules/loyalty/models/loyalty.enums";
import { createSimpleRateLimiter } from "../middleware/rate-limit.middleware";
import contactoRoutes from "./contacto.routes";

const router = Router();

const adminRateLimit = createSimpleRateLimiter({
  keyPrefix: "admin",
  windowMs: 60_000,
  maxRequests: 120,
});

router.use("/admin", adminRateLimit);

// ===================================
// Montaje de Rutas por Módulo
// ===================================

router.use("/productos", productsRoutes);
router.use("/lineas", linesRoutes);
router.use("/categorias", categoriesRoutes);
router.use("/proveedores", providersRoutes);
router.use("/tallas", sizesRoutes);
router.use("/usuarios", usersRoutes);
router.use("/noticias", newsRoutes);
router.use("/auth", authRoutes);
router.use("/ordenes", ordenesRoutes);
router.use("/carrito", carritoRoutes);
router.use("/checkout", checkoutRoutes);
router.use("/pagos", pagosRoutes);
router.use("/stripe", stripeRoutes);
router.use("/payments", paymentsV2Routes);
router.use("/admin/payments", adminPaymentsRoutes);
router.use("/webhooks", webhooksRoutes);
router.use("/inventario", inventoryRoutes);
router.use("/plantilla", plantillaRoutes);
router.use("/galeria", galeriaRoutes);
router.use("/ai", aiRoutes);
router.use("/notificaciones", notificationsRoutes);
router.use("/favoritos", favoritosRoutes);
router.use("/beneficios", beneficiosRoutes);
router.use("/liga-mx", ligaMxRoutes);
router.use("/banners", bannerRoutes);
router.use("/pickup-locations", pickupLocationsRoutes);
router.use("/admin/pickup-locations", adminPickupLocationsRoutes);
router.use("/admin/pickup-orders", adminPickupOrdersRoutes);
router.use("/admin/fedex", adminFedexRoutes);
router.use("/admin/orders", adminOrdersFedexRoutes);
router.use("/orders", ordersTrackingRoutes);
router.use("/shipping", shippingRoutes);
router.use("/ofertas", ofertasRoutes);
router.use("/codigos-promocion", codigofertasRoutes);
router.use("/recomendaciones", recomendacionesRoutes);
router.use("/contacto", contactoRoutes);
router.use(
  "/loyalty/sandbox/v1",
  createLoyaltyPartnerRouter(LoyaltyEnvironment.SANDBOX),
);
router.use(
  "/loyalty/v1",
  createLoyaltyPartnerRouter(LoyaltyEnvironment.PRODUCTION),
);
router.use("/loyalty/v1", loyaltyRoutes);

// Futuros módulos:

export default router;
