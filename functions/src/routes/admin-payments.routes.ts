import { Router } from "express";
import * as paymentsController from "../controllers/paymentsV2/payments.controller";
import {
  validateBody,
  validateParams,
  validateQuery,
} from "../middleware/validation.middleware";
import {
  aplazoAdminActionSchema,
  aplazoGenerateQrQuerySchema,
  aplazoInStoreCartParamSchema,
  aplazoRegisterBranchesSchema,
  aplazoResendCheckoutSchema,
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
 * /api/admin/payments/aplazo/in-store/stores/register:
 *   post:
 *     summary: Registrar sucursales Aplazo in-store
 *     description: Registra una o más sucursales del comercio en Aplazo y devuelve los branch IDs asignados por el proveedor.
 *     tags: [Payments]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/AplazoRegisterBranches'
 *           example:
 *             branches:
 *               - test-store-05
 *               - test-store-06
 *     responses:
 *       200:
 *         description: Sucursales registradas exitosamente
 *       400:
 *         $ref: '#/components/responses/400BadRequest'
 *       401:
 *         $ref: '#/components/responses/401Unauthorized'
 *       403:
 *         $ref: '#/components/responses/403Forbidden'
 *       500:
 *         $ref: '#/components/responses/500ServerError'
 */
router.post(
  "/aplazo/in-store/stores/register",
  paymentAuthMiddleware,
  paymentStaffMiddleware,
  validateBody(aplazoRegisterBranchesSchema),
  paymentsController.registerAplazoMerchantStores,
);

/**
 * @swagger
 * /api/admin/payments/aplazo/in-store/{cartId}/checkout/resend:
 *   post:
 *     summary: Reenviar checkout Aplazo in-store
 *     description: Reenvía la URL de checkout al cliente por WhatsApp o SMS para completar el pago en su teléfono.
 *     tags: [Payments]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: cartId
 *         required: true
 *         schema:
 *           type: string
 *           example: cart-123
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/AplazoResendCheckout'
 *           example:
 *             target:
 *               phoneNumber: "5548813917"
 *             channels:
 *               - WHATSAPP
 *     responses:
 *       200:
 *         description: Checkout reenviado exitosamente
 *       400:
 *         $ref: '#/components/responses/400BadRequest'
 *       401:
 *         $ref: '#/components/responses/401Unauthorized'
 *       403:
 *         $ref: '#/components/responses/403Forbidden'
 *       500:
 *         $ref: '#/components/responses/500ServerError'
 */
router.post(
  "/aplazo/in-store/:cartId/checkout/resend",
  paymentAuthMiddleware,
  paymentStaffMiddleware,
  validateParams(aplazoInStoreCartParamSchema),
  validateBody(aplazoResendCheckoutSchema),
  paymentsController.resendAplazoInStoreCheckout,
);

/**
 * @swagger
 * /api/admin/payments/aplazo/in-store/{cartId}/checkout/qr:
 *   get:
 *     summary: Generar QR Aplazo in-store
 *     description: Genera checkoutUrl y QR base64 para que el cliente escanee en punto de venta.
 *     tags: [Payments]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: cartId
 *         required: true
 *         schema:
 *           type: string
 *           example: cart-123
 *       - in: query
 *         name: shopId
 *         required: true
 *         schema:
 *           type: string
 *           example: "475"
 *     responses:
 *       200:
 *         description: QR generado exitosamente
 *       400:
 *         $ref: '#/components/responses/400BadRequest'
 *       401:
 *         $ref: '#/components/responses/401Unauthorized'
 *       403:
 *         $ref: '#/components/responses/403Forbidden'
 *       500:
 *         $ref: '#/components/responses/500ServerError'
 */
router.get(
  "/aplazo/in-store/:cartId/checkout/qr",
  paymentAuthMiddleware,
  paymentStaffMiddleware,
  validateParams(aplazoInStoreCartParamSchema),
  validateQuery(aplazoGenerateQrQuerySchema),
  paymentsController.generateAplazoInStoreQr,
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
