import { Router } from "express";
import * as paymentsController from "../controllers/paymentsV2/payments.controller";
import { validateBody, validateParams } from "../middleware/validation.middleware";
import {
  aplazoInStoreCreateSchema,
  aplazoOnlineCreateSchema,
  paymentAttemptStatusParamSchema,
} from "../middleware/validators/payments-v2.validator";
import {
  paymentAuthMiddleware,
  paymentStaffMiddleware,
} from "../middleware/payments-auth.middleware";
import { createSimpleRateLimiter } from "../middleware/rate-limit.middleware";

const router = Router();

const paymentsRateLimit = createSimpleRateLimiter({
  keyPrefix: "payments:v2:critical",
  windowMs: 60_000,
  maxRequests: 25,
});

/**
 * @swagger
 * /api/payments/aplazo/online/create:
 *   post:
 *     summary: Crear intento Aplazo online
 *     tags: [Payments]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: header
 *         name: Idempotency-Key
 *         required: false
 *         schema:
 *           type: string
 *         description: Clave idempotente opcional para reintentos seguros
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateAplazoOnlinePayment'
 *     responses:
 *       200:
 *         description: Reintento idempotente
 *       201:
 *         description: Intento creado
 */
router.post(
  "/aplazo/online/create",
  paymentAuthMiddleware,
  paymentsRateLimit,
  validateBody(aplazoOnlineCreateSchema),
  paymentsController.createAplazoOnline,
);

/**
 * @swagger
 * /api/payments/aplazo/in-store/create:
 *   post:
 *     summary: Crear intento Aplazo in-store
 *     tags: [Payments]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: header
 *         name: Idempotency-Key
 *         required: false
 *         schema:
 *           type: string
 *         description: Clave idempotente opcional para reintentos seguros
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateAplazoInStorePayment'
 *     responses:
 *       200:
 *         description: Reintento idempotente
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
 *                 paymentAttemptId:
 *                   type: string
 *                 provider:
 *                   type: string
 *                   example: aplazo
 *                 flowType:
 *                   type: string
 *                   example: in_store
 *                 status:
 *                   type: string
 *                   example: pending_customer
 *                 ventaPosId:
 *                   type: string
 *                   description: ID de la venta POS asociada al intento
 *                 cartId:
 *                   type: string
 *                   description: CartId enviado o resuelto para Aplazo
 *                 providerReference:
 *                   type: string
 *                   description: Referencia canonica del proveedor
 *       201:
 *         description: Intento creado
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
 *                 paymentAttemptId:
 *                   type: string
 *                 provider:
 *                   type: string
 *                   example: aplazo
 *                 flowType:
 *                   type: string
 *                   example: in_store
 *                 status:
 *                   type: string
 *                   example: pending_customer
 *                 ventaPosId:
 *                   type: string
 *                   description: ID de la venta POS asociada al intento
 *                 cartId:
 *                   type: string
 *                   description: CartId enviado o resuelto para Aplazo
 *                 providerReference:
 *                   type: string
 *                   description: Referencia canonica del proveedor
 */
router.post(
  "/aplazo/in-store/create",
  paymentAuthMiddleware,
  paymentStaffMiddleware,
  paymentsRateLimit,
  validateBody(aplazoInStoreCreateSchema),
  paymentsController.createAplazoInStore,
);

/**
 * @swagger
 * /api/payments/{paymentAttemptId}/status:
 *   get:
 *     summary: Consultar estado de un intento de pago
 *     tags: [Payments]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: paymentAttemptId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Estado actual
 */
router.get(
  "/:paymentAttemptId/status",
  paymentAuthMiddleware,
  validateParams(paymentAttemptStatusParamSchema),
  paymentsController.getPaymentStatus,
);

export default router;
