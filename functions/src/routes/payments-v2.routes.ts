import { Router } from "express";
import * as paymentsController from "../controllers/paymentsV2/payments.controller";
import {
  validateBody,
  validateParams,
  validateQuery,
} from "../middleware/validation.middleware";
import {
  aplazoOnlineCreateSchema,
  aplazoRefundRequestParamSchema,
  createAplazoRefundRequestSchema,
  listAplazoRefundRequestsQuerySchema,
  paymentAttemptStatusParamSchema,
} from "../middleware/validators/payments-v2.validator";
import {
  paymentAuthMiddleware,
  paymentCustomerMiddleware,
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
  paymentCustomerMiddleware,
  paymentsRateLimit,
  validateBody(aplazoOnlineCreateSchema),
  paymentsController.createAplazoOnline,
);

/**
 * @swagger
 * /api/payments/aplazo/refund-requests:
 *   post:
 *     summary: Solicitar devolución Aplazo
 *     tags: [Payments]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateAplazoRefundRequest'
 *     responses:
 *       201:
 *         description: Solicitud creada en estado pending
 *       409:
 *         description: Ya existe una solicitud abierta o el pago no es reembolsable
 */
router.post(
  "/aplazo/refund-requests",
  paymentAuthMiddleware,
  paymentsRateLimit,
  validateBody(createAplazoRefundRequestSchema),
  paymentsController.createAplazoRefundRequest,
);

/**
 * @swagger
 * /api/payments/aplazo/refund-requests:
 *   get:
 *     summary: Listar solicitudes de devolución Aplazo del cliente
 *     tags: [Payments]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: orderId
 *         required: false
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Solicitudes del usuario autenticado
 */
router.get(
  "/aplazo/refund-requests",
  paymentAuthMiddleware,
  validateQuery(listAplazoRefundRequestsQuerySchema),
  paymentsController.listAplazoRefundRequests,
);

/**
 * @swagger
 * /api/payments/aplazo/refund-requests/{refundRequestId}:
 *   get:
 *     summary: Consultar una solicitud de devolución Aplazo
 *     tags: [Payments]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: refundRequestId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Solicitud encontrada
 *       404:
 *         description: Solicitud no encontrada
 */
router.get(
  "/aplazo/refund-requests/:refundRequestId",
  paymentAuthMiddleware,
  validateParams(aplazoRefundRequestParamSchema),
  paymentsController.getAplazoRefundRequest,
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
