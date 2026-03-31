import { Router } from "express";
import * as paymentsController from "../controllers/paymentsV2/payments.controller";

const router = Router();

/**
 * @swagger
 * /api/webhooks/aplazo:
 *   post:
 *     summary: Webhook Aplazo
 *     tags: [Payments]
 *     parameters:
 *       - in: header
 *         name: Authorization
 *         required: false
 *         schema:
 *           type: string
 *         description: Header opcional tipo Bearer o Basic según configuración del canal Aplazo
 *     responses:
 *       200:
 *         description: Evento persistido y deduplicado
 */
router.post("/aplazo", paymentsController.webhookAplazo);

export default router;
