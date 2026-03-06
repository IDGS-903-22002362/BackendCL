import { Router } from "express";
import * as stripeController from "../controllers/stripe/stripe.controller";
import { authMiddleware, requireAdmin } from "../utils/middlewares";
import { validateBody, validateParams } from "../middleware/validation.middleware";
import {
  createStripeBillingPortalSchema,
  createStripeCheckoutSessionSchema,
  createStripePaymentIntentSchema,
  createStripeRefundByOrderSchema,
  createStripeSetupIntentSchema,
  stripeObjectIdParamSchema,
} from "../middleware/validators/stripe.validator";
import { createSimpleRateLimiter } from "../middleware/rate-limit.middleware";

const router = Router();

const criticalRateLimit = createSimpleRateLimiter({
  keyPrefix: "stripe:critical",
  windowMs: 60_000,
  maxRequests: 25,
});

/**
 * @swagger
 * /api/stripe/config:
 *   get:
 *     summary: Obtener configuración pública de Stripe
 *     tags: [Stripe]
 *     responses:
 *       200:
 *         description: Configuración pública disponible
 */
router.get("/config", stripeController.getConfig);

/**
 * @swagger
 * /api/stripe/webhook:
 *   post:
 *     summary: Webhook de Stripe (firma verificada)
 *     tags: [Stripe]
 *     responses:
 *       200:
 *         description: Webhook recibido
 */
router.post("/webhook", stripeController.webhook);

/**
 * @swagger
 * /api/stripe/payment-intents:
 *   post:
 *     summary: Crear PaymentIntent
 *     tags: [Stripe]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Intento reutilizado por idempotencia
 *       201:
 *         description: Intento creado
 */
router.post(
  "/payment-intents",
  authMiddleware,
  criticalRateLimit,
  validateBody(createStripePaymentIntentSchema),
  stripeController.createPaymentIntent,
);

/**
 * @swagger
 * /api/stripe/payment-intents/{id}:
 *   get:
 *     summary: Consultar PaymentIntent
 *     tags: [Stripe]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Estado obtenido
 */
router.get(
  "/payment-intents/:id",
  authMiddleware,
  validateParams(stripeObjectIdParamSchema),
  stripeController.getPaymentIntent,
);

/**
 * @swagger
 * /api/stripe/checkout-sessions:
 *   post:
 *     summary: Crear Checkout Session
 *     tags: [Stripe]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Sesión reutilizada por idempotencia
 *       201:
 *         description: Sesión creada
 */
router.post(
  "/checkout-sessions",
  authMiddleware,
  criticalRateLimit,
  validateBody(createStripeCheckoutSessionSchema),
  stripeController.createCheckoutSession,
);

/**
 * @swagger
 * /api/stripe/checkout-sessions/{id}:
 *   get:
 *     summary: Consultar Checkout Session
 *     tags: [Stripe]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Sesión obtenida
 */
router.get(
  "/checkout-sessions/:id",
  authMiddleware,
  validateParams(stripeObjectIdParamSchema),
  stripeController.getCheckoutSession,
);

/**
 * @swagger
 * /api/stripe/setup-intents:
 *   post:
 *     summary: Crear SetupIntent para guardar método de pago
 *     tags: [Stripe]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       201:
 *         description: SetupIntent creado
 */
router.post(
  "/setup-intents",
  authMiddleware,
  criticalRateLimit,
  validateBody(createStripeSetupIntentSchema),
  stripeController.createSetupIntent,
);

/**
 * @swagger
 * /api/stripe/billing-portal:
 *   post:
 *     summary: Crear sesión de billing portal
 *     tags: [Stripe]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       201:
 *         description: Sesión de portal creada
 */
router.post(
  "/billing-portal",
  authMiddleware,
  criticalRateLimit,
  validateBody(createStripeBillingPortalSchema),
  stripeController.createBillingPortal,
);

/**
 * @swagger
 * /api/stripe/refunds:
 *   post:
 *     summary: Procesar reembolso por orden
 *     tags: [Stripe]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Reembolso procesado
 */
router.post(
  "/refunds",
  authMiddleware,
  requireAdmin,
  criticalRateLimit,
  validateBody(createStripeRefundByOrderSchema),
  stripeController.createRefund,
);

export default router;
