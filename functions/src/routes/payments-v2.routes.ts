import { Router } from "express";
import * as paymentsController from "../controllers/paymentsV2/payments.controller";
import { validateBody, validateParams } from "../middleware/validation.middleware";
import {
  aplazoOnlineCreateSchema,
  paymentAttemptStatusParamSchema,
} from "../middleware/validators/payments-v2.validator";
import { paymentAuthMiddleware } from "../middleware/payments-auth.middleware";
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
