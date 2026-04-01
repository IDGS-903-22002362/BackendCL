import { Router } from "express";
import * as paymentsReturnController from "../controllers/paymentsV2/payments-return.controller";
import { validateQuery } from "../middleware/validation.middleware";
import { aplazoReturnQuerySchema } from "../middleware/validators/payments-v2.validator";

const router = Router();

/**
 * @swagger
 * /payments/aplazo/success:
 *   get:
 *     summary: Return URL Aplazo success
 *     tags: [Payments]
 *     responses:
 *       200:
 *         description: Estado UX del intento
 */
router.get(
  "/payments/aplazo/success",
  validateQuery(aplazoReturnQuerySchema),
  paymentsReturnController.aplazoSuccessReturn,
);

/**
 * @swagger
 * /payments/aplazo/failure:
 *   get:
 *     summary: Return URL Aplazo failure
 *     tags: [Payments]
 *     responses:
 *       200:
 *         description: Estado UX del intento
 */
router.get(
  "/payments/aplazo/failure",
  validateQuery(aplazoReturnQuerySchema),
  paymentsReturnController.aplazoFailureReturn,
);

/**
 * @swagger
 * /payments/aplazo/cancel:
 *   get:
 *     summary: Return URL Aplazo cancel
 *     tags: [Payments]
 *     responses:
 *       200:
 *         description: Estado UX del intento
 */
router.get(
  "/payments/aplazo/cancel",
  validateQuery(aplazoReturnQuerySchema),
  paymentsReturnController.aplazoCancelReturn,
);

export default router;
