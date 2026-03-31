import { Router } from "express";
import * as paymentsController from "../controllers/paymentsV2/payments.controller";
import { validateBody, validateParams } from "../middleware/validation.middleware";
import {
  aplazoAdminActionSchema,
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

export default router;
