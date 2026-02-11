import { Router } from "express";
import * as commandController from "../controllers/payments/payments.command.controller";
import * as queryController from "../controllers/payments/payments.query.controller";
import { validateBody, validateParams } from "../middleware/validation.middleware";
import {
  iniciarPagoSchema,
  ordenPagoParamSchema,
  pagoIdParamSchema,
} from "../middleware/validators/pago.validator";
import { authMiddleware } from "../utils/middlewares";

const router = Router();

/**
 * @swagger
 * /api/pagos/webhook:
 *   post:
 *     summary: Recibir webhook de Stripe para confirmaciÃ³n final de pago
 *     description: |
 *       Endpoint de webhook para eventos de Stripe.
 *
 *       **Seguridad:**
 *       - Verifica firma con header `Stripe-Signature` y `STRIPE_WEBHOOK_SECRET`
 *       - Usa body raw para validaciÃ³n criptogrÃ¡fica de firma
 *
 *       **Idempotencia:**
 *       - DeduplicaciÃ³n por `event.id` en colecciÃ³n dedicada
 *       - Si el evento ya se procesÃ³, responde 200 sin repetir lÃ³gica
 *
 *       **Eventos soportados:**
 *       - `payment_intent.succeeded`
 *       - `payment_intent.payment_failed`
 *       - `checkout.session.completed`
 *       - `checkout.session.async_payment_succeeded`
 *       - `checkout.session.async_payment_failed`
 *       - `charge.refunded`
 *     tags: [Payments]
 *     parameters:
 *       - in: header
 *         name: Stripe-Signature
 *         required: true
 *         description: Firma enviada por Stripe para validar autenticidad del webhook
 *         schema:
 *           type: string
 *           example: "t=1739476800,v1=abcdef1234567890"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             description: Payload crudo enviado por Stripe
 *           examples:
 *             paymentIntentSucceeded:
 *               value:
 *                 id: "evt_1ABCDEF"
 *                 type: "payment_intent.succeeded"
 *             paymentIntentFailed:
 *               value:
 *                 id: "evt_1GHIJKL"
 *                 type: "payment_intent.payment_failed"
 *             checkoutCompleted:
 *               value:
 *                 id: "evt_1MNOPQR"
 *                 type: "checkout.session.completed"
 *             checkoutAsyncSucceeded:
 *               value:
 *                 id: "evt_1STUVWX"
 *                 type: "checkout.session.async_payment_succeeded"
 *             checkoutAsyncFailed:
 *               value:
 *                 id: "evt_1YZABCD"
 *                 type: "checkout.session.async_payment_failed"
 *             chargeRefunded:
 *               value:
 *                 id: "evt_1EFGHIJ"
 *                 type: "charge.refunded"
 *     responses:
 *       200:
 *         description: Evento aceptado (procesado, duplicado, ignorado o sin match)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Webhook recibido"
 *                 data:
 *                   type: object
 *                   properties:
 *                     outcome:
 *                       type: string
 *                       enum: [processed, duplicate, unmatched, ignored]
 *                       example: "processed"
 *                     eventId:
 *                       type: string
 *                       example: "evt_1ABCDEF"
 *                     eventType:
 *                       type: string
 *                       example: "payment_intent.succeeded"
 *       400:
 *         description: Firma invÃ¡lida, header faltante o payload mal formado
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         $ref: '#/components/responses/500ServerError'
 */
router.post("/webhook", commandController.webhook);

/**
 * @swagger
 * /api/pagos/iniciar:
 *   post:
 *     summary: Iniciar pago de una orden con Stripe
 *     description: |
 *       Inicia el pago para una orden existente creando un PaymentIntent en Stripe.
 *
 *       **IMPORTANTE:**
 *       - Requiere autenticación (solo el dueño de la orden puede pagarla)
 *       - Requiere header `Idempotency-Key` para evitar cobros duplicados
 *       - El monto se calcula server-side usando `orden.total`
 *       - Solo acepta órdenes en estado `PENDIENTE`
 *       - Solo acepta método de pago `TARJETA` para Stripe en esta tarea
 *       - NO confirma la orden como pagada aquí (se confirma en webhook TASK-060)
 *     tags: [Payments]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: header
 *         name: Idempotency-Key
 *         required: true
 *         description: Clave única para reintentos seguros sin cobros duplicados
 *         schema:
 *           type: string
 *           minLength: 8
 *           maxLength: 255
 *           example: "pay_orden_123_user_456_retry_1"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/IniciarPago'
 *           example:
 *             ordenId: "orden_abc123"
 *             metodoPago: "TARJETA"
 *     responses:
 *       201:
 *         description: PaymentIntent creado exitosamente
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Pago iniciado exitosamente"
 *                 data:
 *                   type: object
 *                   properties:
 *                     pagoId:
 *                       type: string
 *                       example: "pago_abc123"
 *                     paymentIntentId:
 *                       type: string
 *                       example: "pi_3Qabcdef12345"
 *                     clientSecret:
 *                       type: string
 *                       example: "pi_3Qabcdef12345_secret_abc"
 *                     status:
 *                       type: string
 *                       enum: [PENDIENTE, REQUIERE_ACCION, PROCESANDO, COMPLETADO, FALLIDO, REEMBOLSADO]
 *                       example: "PENDIENTE"
 *       200:
 *         description: Reintento idempotente reutiliza PaymentIntent existente
 *       400:
 *         description: Validación inválida (body, método o header)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               metodoInvalido:
 *                 value:
 *                   success: false
 *                   message: "Método de pago no válido para Stripe en este endpoint. Usa TARJETA"
 *               headerInvalido:
 *                 value:
 *                   success: false
 *                   message: "El header Idempotency-Key es obligatorio para iniciar pagos"
 *       401:
 *         $ref: '#/components/responses/401Unauthorized'
 *       403:
 *         $ref: '#/components/responses/403Forbidden'
 *       404:
 *         $ref: '#/components/responses/404NotFound'
 *       409:
 *         description: Estado de orden inválido o idempotency key no reutilizable
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       502:
 *         description: Error al crear/reutilizar intento de pago en Stripe
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         $ref: '#/components/responses/500ServerError'
 */
router.post(
  "/iniciar",
  authMiddleware,
  validateBody(iniciarPagoSchema),
  commandController.iniciar,
);

/**
 * @swagger
 * /api/pagos/orden/{ordenId}:
 *   get:
 *     summary: Obtener el estado de pago por orden
 *     description: |
 *       Consulta el pago más reciente asociado a una orden.
 *
 *       **Autorización:**
 *       - Solo el propietario del pago/orden o usuarios ADMIN/EMPLEADO
 *     tags: [Payments]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: ordenId
 *         required: true
 *         description: ID de la orden a consultar
 *         schema:
 *           type: string
 *           example: "orden_abc123"
 *     responses:
 *       200:
 *         description: Pago obtenido exitosamente
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Pago obtenido exitosamente"
 *                 data:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                       example: "pago_abc123"
 *                     estado:
 *                       type: string
 *                       example: "COMPLETADO"
 *                     monto:
 *                       type: number
 *                       example: 3015.97
 *                     currency:
 *                       type: string
 *                       example: "mxn"
 *                     metodoPago:
 *                       type: string
 *                       example: "TARJETA"
 *                     provider:
 *                       type: string
 *                       example: "STRIPE"
 *                     paymentIntentId:
 *                       type: string
 *                       example: "pi_3ABC123DEF456"
 *                     checkoutSessionId:
 *                       type: string
 *                       example: "cs_test_abc123"
 *                     fechaPago:
 *                       type: string
 *                       format: date-time
 *                     failureCode:
 *                       type: string
 *                     failureMessage:
 *                       type: string
 *                     orden:
 *                       type: object
 *                       properties:
 *                         id:
 *                           type: string
 *                           example: "orden_abc123"
 *                         estado:
 *                           type: string
 *                           example: "CONFIRMADA"
 *                         total:
 *                           type: number
 *                           example: 3015.97
 *       401:
 *         $ref: '#/components/responses/401Unauthorized'
 *       403:
 *         $ref: '#/components/responses/403Forbidden'
 *       404:
 *         $ref: '#/components/responses/404NotFound'
 *       500:
 *         $ref: '#/components/responses/500ServerError'
 */
router.get(
  "/orden/:ordenId",
  authMiddleware,
  validateParams(ordenPagoParamSchema),
  queryController.getByOrdenId,
);

/**
 * @swagger
 * /api/pagos/{id}:
 *   get:
 *     summary: Obtener estado de un pago por ID
 *     description: |
 *       Consulta un pago específico y retorna datos mínimos de su orden asociada.
 *
 *       **Autorización:**
 *       - Solo el propietario del pago o usuarios ADMIN/EMPLEADO
 *     tags: [Payments]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         description: ID del pago a consultar
 *         schema:
 *           type: string
 *           example: "pago_abc123"
 *     responses:
 *       200:
 *         description: Pago obtenido exitosamente
 *       401:
 *         $ref: '#/components/responses/401Unauthorized'
 *       403:
 *         $ref: '#/components/responses/403Forbidden'
 *       404:
 *         $ref: '#/components/responses/404NotFound'
 *       500:
 *         $ref: '#/components/responses/500ServerError'
 */
router.get(
  "/:id",
  authMiddleware,
  validateParams(pagoIdParamSchema),
  queryController.getById,
);

export default router;
