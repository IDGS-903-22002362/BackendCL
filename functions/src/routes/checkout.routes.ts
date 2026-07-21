import { Router } from "express";
import * as checkoutController from "../controllers/checkout/checkout.controller";
import { authMiddleware, requireCustomer } from "../utils/middlewares";
import { validateBody, validateParams } from "../middleware/validation.middleware";
import { startCheckoutAttemptSchema } from "../middleware/validators/carrito.validator";
import { z } from "zod";
import { createSimpleRateLimiter } from "../middleware/rate-limit.middleware";

const router = Router();

const checkoutRateLimit = createSimpleRateLimiter({
  keyPrefix: "checkout:start",
  windowMs: 60_000,
  maxRequests: 20,
});

const attemptIdParamSchema = z.object({
  attemptId: z.string().min(8).max(128),
});

router.post(
  "/attempts",
  authMiddleware,
  requireCustomer,
  checkoutRateLimit,
  validateBody(startCheckoutAttemptSchema),
  checkoutController.startCheckout,
);

router.post(
  "/attempts/reconcile-pending",
  authMiddleware,
  checkoutController.reconcilePendingAttempts,
);

router.get(
  "/attempts/:attemptId/status",
  authMiddleware,
  validateParams(attemptIdParamSchema),
  checkoutController.getAttemptStatus,
);

router.post(
  "/attempts/:attemptId/cancel",
  authMiddleware,
  validateParams(attemptIdParamSchema),
  checkoutController.cancelAttempt,
);

router.post(
  "/attempts/:attemptId/abandon",
  authMiddleware,
  validateParams(attemptIdParamSchema),
  checkoutController.abandonAttempt,
);

export default router;
