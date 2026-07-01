import { Router } from "express";
import { authMiddleware } from "../../../utils/middlewares";
import { createSimpleRateLimiter } from "../../../middleware/rate-limit.middleware";
import {
  validateBody,
  validateParams,
  validateQuery,
} from "../../../middleware/validation.middleware";
import * as loyaltyController from "../controllers/loyalty.controller";
import {
  handleLoyaltyError,
  loyaltyActorMiddleware,
  requireIdempotencyKey,
  requireLoyaltyPermission,
} from "../middleware/loyalty.middleware";
import { LoyaltyPermission } from "../models/loyalty.enums";
import {
  adjustmentSchema,
  adminTransactionsQuerySchema,
  earnPreviewQuerySchema,
  earnTransactionSchema,
  memberIdParamSchema,
  redemptionIdParamSchema,
  redemptionSchema,
  reversalSchema,
  transactionIdParamSchema,
  walletTransactionsQuerySchema,
} from "../validators/loyalty.validators";

const router = Router();

const earnRateLimit = createSimpleRateLimiter({
  keyPrefix: "loyalty:earn",
  windowMs: 60_000,
  maxRequests: 30,
});

const redeemRateLimit = createSimpleRateLimiter({
  keyPrefix: "loyalty:redeem",
  windowMs: 60_000,
  maxRequests: 10,
});

const adjustRateLimit = createSimpleRateLimiter({
  keyPrefix: "loyalty:adjust",
  windowMs: 60_000,
  maxRequests: 20,
});

router.use(authMiddleware, loyaltyActorMiddleware);

router.get(
  "/wallets/me",
  requireLoyaltyPermission(LoyaltyPermission.WALLET_READ_SELF),
  loyaltyController.getMyWallet,
);

router.get(
  "/wallets/me/transactions",
  requireLoyaltyPermission(LoyaltyPermission.TRANSACTIONS_READ_SELF),
  validateQuery(walletTransactionsQuerySchema),
  loyaltyController.getMyTransactions,
);

router.get(
  "/admin/members/:memberId/wallet",
  validateParams(memberIdParamSchema),
  requireLoyaltyPermission(LoyaltyPermission.WALLET_READ_ANY),
  loyaltyController.getMemberWalletAdmin,
);

router.get(
  "/earn-preview",
  validateQuery(earnPreviewQuerySchema),
  loyaltyController.previewEarnPoints,
);

router.post(
  "/earn-transactions",
  earnRateLimit,
  requireIdempotencyKey,
  requireLoyaltyPermission(LoyaltyPermission.POINTS_EARN),
  validateBody(earnTransactionSchema),
  loyaltyController.createEarnTransaction,
);

router.post(
  "/admin/adjustments",
  adjustRateLimit,
  requireIdempotencyKey,
  requireLoyaltyPermission(LoyaltyPermission.POINTS_ADJUST),
  validateBody(adjustmentSchema),
  loyaltyController.createAdjustment,
);

router.post(
  "/redemptions",
  redeemRateLimit,
  requireIdempotencyKey,
  requireLoyaltyPermission(LoyaltyPermission.POINTS_REDEEM),
  validateBody(redemptionSchema),
  loyaltyController.createRedemption,
);

router.post(
  "/redemptions/:redemptionId/confirm",
  redeemRateLimit,
  requireIdempotencyKey,
  validateParams(redemptionIdParamSchema),
  loyaltyController.confirmRedemption,
);

router.post(
  "/redemptions/:redemptionId/cancel",
  redeemRateLimit,
  requireIdempotencyKey,
  validateParams(redemptionIdParamSchema),
  loyaltyController.cancelRedemption,
);

router.get(
  "/transactions/:transactionId",
  validateParams(transactionIdParamSchema),
  loyaltyController.getTransactionById,
);

router.post(
  "/transactions/:transactionId/reversals",
  requireIdempotencyKey,
  requireLoyaltyPermission(LoyaltyPermission.POINTS_REVERSE),
  validateParams(transactionIdParamSchema),
  validateBody(reversalSchema),
  loyaltyController.reverseTransaction,
);

router.get(
  "/admin/transactions",
  requireLoyaltyPermission(LoyaltyPermission.TRANSACTIONS_READ_ANY),
  validateQuery(adminTransactionsQuerySchema),
  loyaltyController.getAdminTransactions,
);

router.use(handleLoyaltyError);

export default router;
