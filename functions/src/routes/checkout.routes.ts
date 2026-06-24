import { Router } from "express";
import * as checkoutController from "../controllers/checkout/checkout.controller";
import { authMiddleware } from "../utils/middlewares";
import { validateBody, validateParams } from "../middleware/validation.middleware";
import { checkoutCarritoSchema } from "../middleware/validators/carrito.validator";
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

const startCheckoutBodySchema = z
  .object({
    successUrl: z.string().url(),
    cancelUrl: z.string().url(),
  })
  .and(checkoutCarritoSchema);

router.post(
  "/attempts",
  authMiddleware,
  checkoutRateLimit,
  validateBody(startCheckoutBodySchema),
  checkoutController.startCheckout,
);

router.get(
  "/attempts/:attemptId/status",
  authMiddleware,
  validateParams(attemptIdParamSchema),
  checkoutController.getAttemptStatus,
);

export default router;
