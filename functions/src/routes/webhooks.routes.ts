import { Router } from "express";
import * as paymentsController from "../controllers/paymentsV2/payments.controller";

const router = Router();

/**
 * @swagger
 * /api/webhooks/aplazo:
 *   post:
 *     summary: Webhook de confirmación Aplazo
 *     description: Recibe la confirmación de Aplazo cuando el cliente paga la primera parcialidad. El estado `Activo` se procesa como pago confirmado.
 *     tags: [Payments]
 *     parameters:
 *       - in: header
 *         name: Authorization
 *         required: false
 *         schema:
 *           type: string
 *         description: Header opcional tipo Bearer o Basic según configuración del canal Aplazo
 *         example: Bearer aplazo_webhook_token
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status, loanId, cartId, merchantId]
 *             properties:
 *               status:
 *                 type: string
 *                 example: Activo
 *                 description: Estado enviado por Aplazo; Activo equivale a ACTIVE en status API.
 *               loanId:
 *                 type: integer
 *                 example: 155789
 *               cartId:
 *                 type: string
 *                 example: cart-123-abc
 *               merchantId:
 *                 type: integer
 *                 example: 1234
 *     responses:
 *       200:
 *         description: Evento persistido para procesamiento exactly-once
 *       400:
 *         $ref: '#/components/responses/400BadRequest'
 *       500:
 *         $ref: '#/components/responses/500ServerError'
 */
router.post("/aplazo", paymentsController.webhookAplazo);

export default router;
