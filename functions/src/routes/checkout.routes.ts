import { Router } from "express";
import * as checkoutController from "../controllers/checkout/checkout.controller";
import { authMiddleware } from "../utils/middlewares";
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
  checkoutRateLimit,
  validateBody(startCheckoutAttemptSchema),
  checkoutController.startCheckout,
);

router.get(
  "/attempts/:attemptId/status",
  authMiddleware,
  validateParams(attemptIdParamSchema),
  checkoutController.getAttemptStatus,
);

export default router;
