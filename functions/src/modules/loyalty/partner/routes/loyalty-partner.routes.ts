import { Router } from "express";
import { createSimpleRateLimiter } from "../../../../middleware/rate-limit.middleware";
import {
  validateBody,
  validateParams,
  validateQuery,
} from "../../../../middleware/validation.middleware";
import {
  handleLoyaltyError,
  requireIdempotencyKey,
} from "../../middleware/loyalty.middleware";
import { LoyaltyChannel, LoyaltyEnvironment, PartnerScope } from "../../models/loyalty.enums";
import {
  earnPreviewQuerySchema,
  earnTransactionSchema,
  memberIdParamSchema,
  redemptionIdParamSchema,
  redemptionSchema,
  reversalSchema,
  transactionIdParamSchema,
  walletTransactionsQuerySchema,
} from "../../validators/loyalty.validators";
import * as partnerController from "../controllers/loyalty-partner.controller";
import {
  attachPartnerActor,
  createPartnerAuthMiddleware,
  partnerRequestLogMiddleware,
  requestIdMiddleware,
  requirePartnerScopeMiddleware,
} from "../middleware/partner-auth.middleware";
import { oauthTokenSchema, memberTokenSchema } from "../validators/partner.validators";
import { z } from "zod";

const oauthRateLimit = createSimpleRateLimiter({
  keyPrefix: "loyalty:oauth",
  windowMs: 60_000,
  maxRequests: 20,
  resolveKey: (req) => {
    const clientId = req.body?.client_id ?? req.body?.clientId ?? "unknown";
    return `oauth:${clientId}`;
  },
});

const earnRateLimit = createSimpleRateLimiter({
  keyPrefix: "loyalty:partner:earn",
  windowMs: 60_000,
  maxRequests: 30,
  resolveKey: (req) => `partner:${req.partnerAuth?.partnerId ?? "anon"}`,
});

const redeemRateLimit = createSimpleRateLimiter({
  keyPrefix: "loyalty:partner:redeem",
  windowMs: 60_000,
  maxRequests: 10,
  resolveKey: (req) => `partner:${req.partnerAuth?.partnerId ?? "anon"}`,
});

export function createLoyaltyPartnerRouter(environment: LoyaltyEnvironment): Router {
  const router = Router();
  const partnerAuth = createPartnerAuthMiddleware(environment);

  router.use(requestIdMiddleware);
  router.use((req, _res, next) => {
    req.loyaltyEnvironment = environment;
    next();
  });
  router.use(partnerRequestLogMiddleware);

  router.post(
    "/oauth/token",
    oauthRateLimit,
    validateBody(oauthTokenSchema),
    partnerController.oauthToken,
  );

  router.get(
    "/earn-preview",
    partnerAuth,
    validateQuery(earnPreviewQuerySchema),
    partnerController.previewEarn,
  );

  router.use(partnerAuth, attachPartnerActor);

  router.get(
    "/members/:memberId/wallet",
    validateParams(memberIdParamSchema),
    requirePartnerScopeMiddleware(PartnerScope.WALLET_READ),
    partnerController.getMemberWallet,
  );

  router.get(
    "/members/:memberId/transactions",
    validateParams(memberIdParamSchema),
    validateQuery(walletTransactionsQuerySchema),
    requirePartnerScopeMiddleware(PartnerScope.TRANSACTIONS_READ),
    partnerController.getMemberTransactions,
  );

  router.post(
    "/earn-transactions",
    earnRateLimit,
    requireIdempotencyKey,
    requirePartnerScopeMiddleware(PartnerScope.POINTS_EARN),
    validateBody(
      earnTransactionSchema
        .extend({
          // memberId puede omitirse cuando se identifica al miembro vía memberToken.
          memberId: z.string().trim().min(1).max(128).optional(),
          memberToken: z.string().trim().min(1).optional(),
          // Los partners no deciden el canal: el controlador siempre usa
          // PARTNER. Se acepta opcionalmente para compatibilidad, pero el
          // contrato público (OpenAPI) no lo exige.
          channel: z.nativeEnum(LoyaltyChannel).optional(),
        })
        .refine((body) => Boolean(body.memberId || body.memberToken), {
          message: "memberId o memberToken es requerido",
        }),
    ),
    partnerController.createEarnTransaction,
  );

  router.get(
    "/transactions/:transactionId",
    validateParams(transactionIdParamSchema),
    requirePartnerScopeMiddleware(PartnerScope.TRANSACTIONS_READ),
    partnerController.getTransactionById,
  );

  router.post(
    "/redemptions",
    redeemRateLimit,
    requireIdempotencyKey,
    requirePartnerScopeMiddleware(PartnerScope.REDEMPTIONS_CREATE),
    validateBody(redemptionSchema),
    partnerController.createRedemption,
  );

  router.post(
    "/redemptions/:redemptionId/confirm",
    redeemRateLimit,
    requireIdempotencyKey,
    validateParams(redemptionIdParamSchema),
    requirePartnerScopeMiddleware(PartnerScope.REDEMPTIONS_CONFIRM),
    partnerController.confirmRedemption,
  );

  router.post(
    "/redemptions/:redemptionId/cancel",
    redeemRateLimit,
    requireIdempotencyKey,
    validateParams(redemptionIdParamSchema),
    requirePartnerScopeMiddleware(PartnerScope.REDEMPTIONS_CANCEL),
    partnerController.cancelRedemption,
  );

  router.post(
    "/transactions/:transactionId/reversals",
    requireIdempotencyKey,
    validateParams(transactionIdParamSchema),
    validateBody(reversalSchema),
    requirePartnerScopeMiddleware(PartnerScope.REVERSALS_CREATE),
    partnerController.reverseTransaction,
  );

  if (environment === LoyaltyEnvironment.SANDBOX) {
    router.post(
      "/member-tokens",
      requirePartnerScopeMiddleware(PartnerScope.WALLET_READ),
      validateBody(memberTokenSchema),
      partnerController.createMemberToken,
    );
  }

  router.use(handleLoyaltyError);

  return router;
}

export default createLoyaltyPartnerRouter;
