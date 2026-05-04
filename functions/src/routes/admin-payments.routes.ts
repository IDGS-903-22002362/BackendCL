import { Router } from "express";
import * as paymentsController from "../controllers/paymentsV2/payments.controller";
import {
  validateBody,
  validateParams,
  validateQuery,
} from "../middleware/validation.middleware";
import {
  aplazoAdminActionSchema,
  aplazoRefundStatusQuerySchema,
  paymentAttemptStatusParamSchema,
} from "../middleware/validators/payments-v2.validator";
import {
  paymentAuthMiddleware,
  paymentStaffMiddleware,
} from "../middleware/payments-auth.middleware";

const router = Router();

/**
 * @swagger
 * /api/admin/payments/aplazo/{paymentAttemptId}/reconcile:
 *   post:
 *     summary: Reconciliar intento Aplazo manualmente
 *     tags: [Payments]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Reconciliación ejecutada
 */
router.post(
  "/aplazo/:paymentAttemptId/reconcile",
  paymentAuthMiddleware,
  paymentStaffMiddleware,
  validateParams(paymentAttemptStatusParamSchema),
  paymentsController.reconcileAplazoPayment,
);

/**
 * @swagger
 * /api/admin/payments/aplazo/{paymentAttemptId}/cancel:
 *   post:
 *     summary: Cancelar o void de intento Aplazo
 *     tags: [Payments]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Intento cancelado
 */
router.post(
  "/aplazo/:paymentAttemptId/cancel",
  paymentAuthMiddleware,
  paymentStaffMiddleware,
  validateParams(paymentAttemptStatusParamSchema),
  validateBody(aplazoAdminActionSchema),
  paymentsController.cancelAplazoPayment,
);

/**
 * @swagger
 * /api/admin/payments/aplazo/{paymentAttemptId}/refund:
 *   post:
 *     summary: Solicitar refund de intento Aplazo
 *     tags: [Payments]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Refund solicitado
 */
router.post(
  "/aplazo/:paymentAttemptId/refund",
  paymentAuthMiddleware,
  paymentStaffMiddleware,
  validateParams(paymentAttemptStatusParamSchema),
  validateBody(aplazoAdminActionSchema),
  paymentsController.refundAplazoPayment,
);

/**
 * @swagger
 * /api/admin/payments/aplazo/{paymentAttemptId}/refund/status:
 *   get:
 *     summary: Consultar refund status Aplazo
 *     description: Sincroniza el estado de refunds de Aplazo para un paymentAttempt usando el cartId ya almacenado en backend. Si se envía refundId, selecciona ese refund; si no, usa el más reciente.
 *     tags: [Payments]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: paymentAttemptId
 *         required: true
 *         description: ID interno del intento de pago Aplazo
 *         schema:
 *           type: string
 *           example: "pay_attempt_123"
 *       - in: query
 *         name: refundId
 *         required: false
 *         description: ID específico de refund devuelto por Aplazo
 *         schema:
 *           type: string
 *           example: "25083"
 *     responses:
 *       200:
 *         description: Refund status sincronizado exitosamente
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AplazoRefundStatusResponse'
 *       400:
 *         $ref: '#/components/responses/400BadRequest'
 *       401:
 *         $ref: '#/components/responses/401Unauthorized'
 *       403:
 *         $ref: '#/components/responses/403Forbidden'
 *       404:
 *         description: PaymentAttempt o refund no encontrado
 *       500:
 *         $ref: '#/components/responses/500ServerError'
 */
router.get(
  "/aplazo/:paymentAttemptId/refund/status",
  paymentAuthMiddleware,
  paymentStaffMiddleware,
  validateParams(paymentAttemptStatusParamSchema),
  validateQuery(aplazoRefundStatusQuerySchema),
  paymentsController.getAplazoRefundStatus,
);

export default router;
