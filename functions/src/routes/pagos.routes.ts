import { Router } from "express";
import * as commandController from "../controllers/payments/payments.command.controller";
import { validateBody } from "../middleware/validation.middleware";
import { iniciarPagoSchema } from "../middleware/validators/pago.validator";
import { authMiddleware } from "../utils/middlewares";

const router = Router();

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

export default router;
