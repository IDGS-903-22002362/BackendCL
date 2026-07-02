import { Request, Response, NextFunction } from "express";
import LoyaltyProblemError from "../../errors/loyalty-problem.error";
import { LoyaltyChannel, LoyaltyEnvironment } from "../../models/loyalty.enums";
import ledgerRepository from "../../repositories/ledger.repository";
import redemptionRepository from "../../repositories/redemption.repository";
import walletRepository from "../../repositories/wallet.repository";
import conversionRulesService from "../../services/conversion-rules.service";
import loyaltyEngineService from "../../services/loyalty-engine.service";
import { getPartnerContext } from "../middleware/partner-auth.middleware";
import { validateLocation } from "../services/partner-scope.service";
import sandboxLoyaltyEngine, { sandboxMemberService } from "../services/sandbox-engine.service";
import partnerOAuthService from "../services/partner-oauth.service";

/**
 * Aislamiento entre partners en producción: toda operación sobre una
 * redención debe pertenecer al partner autenticado. La propiedad se
 * deriva del actorId de la transacción de hold (actorId === partnerId).
 * Se responde 404 para no revelar existencia de recursos ajenos.
 */
async function assertProductionRedemptionOwnership(
  redemptionId: string,
  partnerId: string,
): Promise<void> {
  const redemption = await redemptionRepository.getById(redemptionId);
  if (!redemption) {
    throw new LoyaltyProblemError("REDEMPTION_NOT_FOUND");
  }
  const holdTxn = await ledgerRepository.getById(redemption.holdTransactionId);
  if (!holdTxn || holdTxn.actorId !== partnerId) {
    throw new LoyaltyProblemError("REDEMPTION_NOT_FOUND");
  }
}

function requireIdempotency(req: Request): string {
  const key = req.loyaltyIdempotencyKey ?? req.header("Idempotency-Key")?.trim();
  if (!key) throw new LoyaltyProblemError("IDEMPOTENCY_KEY_REQUIRED");
  return key;
}

function requireActor(req: Request) {
  if (!req.loyaltyActor) throw new LoyaltyProblemError("FORBIDDEN");
  return req.loyaltyActor;
}

export async function oauthToken(req: Request, res: Response, next: NextFunction) {
  try {
    const grantType = req.body?.grant_type ?? req.body?.grantType;
    const clientId = req.body?.client_id ?? req.body?.clientId;
    const clientSecret = req.body?.client_secret ?? req.body?.clientSecret;
    const result = await partnerOAuthService.issueToken({
      grantType: String(grantType ?? ""),
      clientId: String(clientId ?? ""),
      clientSecret: String(clientSecret ?? ""),
      expectedEnvironment: req.loyaltyEnvironment,
    });
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function getMemberWallet(req: Request, res: Response, next: NextFunction) {
  try {
    const partner = getPartnerContext(req);
    const memberId = req.params.memberId;
    if (partner.environment === LoyaltyEnvironment.SANDBOX) {
      const wallet = await sandboxLoyaltyEngine.getWallet(memberId, partner.partnerId);
      res.status(200).json({ wallet, requestId: req.requestId });
      return;
    }
    const wallet = await loyaltyEngineService.getWallet(memberId);
    res.status(200).json({
      wallet: walletRepository.toResponseDto(wallet),
      requestId: req.requestId,
    });
  } catch (error) {
    next(error);
  }
}

export async function getMemberTransactions(req: Request, res: Response, next: NextFunction) {
  try {
    const partner = getPartnerContext(req);
    const memberId = req.params.memberId;
    const limit = Number(req.query.limit ?? 50);
    if (partner.environment === LoyaltyEnvironment.SANDBOX) {
      const result = await sandboxLoyaltyEngine.listTransactions(memberId, partner.partnerId, {
        limit,
        cursor: req.query.cursor as string | undefined,
      });
      res.status(200).json({ ...result, requestId: req.requestId });
      return;
    }
    const result = await ledgerRepository.listByMember(memberId, {
      limit,
      cursor: req.query.cursor as string | undefined,
      type: req.query.type as string | undefined,
      status: req.query.status as string | undefined,
      from: req.query.from as string | undefined,
      to: req.query.to as string | undefined,
    });
    const filtered = result.items.filter((item) => item.actorId === partner.partnerId);
    res.status(200).json({
      items: filtered.map((item) => ledgerRepository.toResponseDto(item)),
      pagination: { nextCursor: result.nextCursor, hasMore: Boolean(result.nextCursor) },
      requestId: req.requestId,
    });
  } catch (error) {
    next(error);
  }
}

export async function createEarnTransaction(req: Request, res: Response, next: NextFunction) {
  try {
    const partner = getPartnerContext(req);
    const actor = requireActor(req);
    const idempotencyKey = requireIdempotency(req);
    validateLocation(partner, req.body.locationId);
    let memberId = req.body.memberId as string;
    if (req.body.memberToken) {
      if (partner.environment !== LoyaltyEnvironment.SANDBOX) {
        throw new LoyaltyProblemError(
          "INVALID_MEMBER_TOKEN",
          "memberToken solo está disponible en sandbox",
        );
      }
      memberId = await sandboxMemberService.resolveMemberToken(
        req.body.memberToken,
        partner.partnerId,
      );
    }
    const payload = {
      memberId,
      externalTransactionId: req.body.externalTransactionId,
      amountCents: req.body.amountCents,
      currency: req.body.currency ?? "MXN",
      // El canal siempre lo fija el backend: un partner no puede registrar
      // operaciones como si vinieran de ecommerce, tienda física o admin.
      channel: LoyaltyChannel.PARTNER,
      description: req.body.description,
      locationId: req.body.locationId,
      metadata: req.body.metadata,
      idempotencyKey,
      actor,
    };
    if (partner.environment === LoyaltyEnvironment.SANDBOX) {
      const transaction = await sandboxLoyaltyEngine.earnFromSale({
        ...payload,
        partnerId: partner.partnerId,
      });
      res.status(201).json({ transaction, requestId: req.requestId });
      return;
    }
    const txn = await loyaltyEngineService.earnFromSale({
      ...payload,
      channel: LoyaltyChannel.PARTNER,
    });
    res.status(201).json({
      transaction: ledgerRepository.toResponseDto(txn),
      requestId: req.requestId,
    });
  } catch (error) {
    next(error);
  }
}

export async function getTransactionById(req: Request, res: Response, next: NextFunction) {
  try {
    const partner = getPartnerContext(req);
    if (partner.environment === LoyaltyEnvironment.SANDBOX) {
      const transaction = await sandboxLoyaltyEngine.getTransaction(
        req.params.transactionId,
        partner.partnerId,
      );
      res.status(200).json({ transaction, requestId: req.requestId });
      return;
    }
    const txn = await ledgerRepository.getById(req.params.transactionId);
    if (!txn || txn.actorId !== partner.partnerId) {
      throw new LoyaltyProblemError("TRANSACTION_NOT_FOUND");
    }
    res.status(200).json({
      transaction: ledgerRepository.toResponseDto(txn),
      requestId: req.requestId,
    });
  } catch (error) {
    next(error);
  }
}

export async function createRedemption(req: Request, res: Response, next: NextFunction) {
  try {
    const partner = getPartnerContext(req);
    const actor = requireActor(req);
    const idempotencyKey = requireIdempotency(req);
    if (partner.environment === LoyaltyEnvironment.SANDBOX) {
      const result = await sandboxLoyaltyEngine.createRedemption({
        memberId: req.body.memberId,
        points: req.body.points,
        description: req.body.description,
        idempotencyKey,
        actor,
        partnerId: partner.partnerId,
      });
      res.status(201).json({ ...result, requestId: req.requestId });
      return;
    }
    const result = await loyaltyEngineService.createRedemption({
      memberId: req.body.memberId,
      points: req.body.points,
      description: req.body.description,
      idempotencyKey,
      actor,
    });
    res.status(201).json({
      redemption: {
        redemptionId: result.redemption.redemptionId,
        memberId: result.redemption.memberId,
        points: result.redemption.points,
        status: result.redemption.status,
        holdTransactionId: result.redemption.holdTransactionId,
        expiresAt: result.redemption.expiresAt.toDate().toISOString(),
        createdAt: result.redemption.createdAt.toDate().toISOString(),
      },
      transaction: ledgerRepository.toResponseDto(result.transaction),
      requestId: req.requestId,
    });
  } catch (error) {
    next(error);
  }
}

export async function confirmRedemption(req: Request, res: Response, next: NextFunction) {
  try {
    const partner = getPartnerContext(req);
    const actor = requireActor(req);
    const idempotencyKey = requireIdempotency(req);
    if (partner.environment === LoyaltyEnvironment.SANDBOX) {
      const transaction = await sandboxLoyaltyEngine.confirmRedemption(
        req.params.redemptionId,
        partner.partnerId,
        actor,
        idempotencyKey,
      );
      res.status(201).json({ transaction, requestId: req.requestId });
      return;
    }
    await assertProductionRedemptionOwnership(req.params.redemptionId, partner.partnerId);
    const txn = await loyaltyEngineService.confirmRedemption(
      req.params.redemptionId,
      actor,
      idempotencyKey,
    );
    res.status(201).json({
      transaction: ledgerRepository.toResponseDto(txn),
      requestId: req.requestId,
    });
  } catch (error) {
    next(error);
  }
}

export async function cancelRedemption(req: Request, res: Response, next: NextFunction) {
  try {
    const partner = getPartnerContext(req);
    const actor = requireActor(req);
    const idempotencyKey = requireIdempotency(req);
    if (partner.environment === LoyaltyEnvironment.SANDBOX) {
      const transaction = await sandboxLoyaltyEngine.cancelRedemption(
        req.params.redemptionId,
        partner.partnerId,
        actor,
        idempotencyKey,
      );
      res.status(201).json({ transaction, requestId: req.requestId });
      return;
    }
    await assertProductionRedemptionOwnership(req.params.redemptionId, partner.partnerId);
    const txn = await loyaltyEngineService.cancelRedemption(
      req.params.redemptionId,
      actor,
      idempotencyKey,
    );
    res.status(201).json({
      transaction: ledgerRepository.toResponseDto(txn),
      requestId: req.requestId,
    });
  } catch (error) {
    next(error);
  }
}

export async function reverseTransaction(req: Request, res: Response, next: NextFunction) {
  try {
    const partner = getPartnerContext(req);
    const actor = requireActor(req);
    const idempotencyKey = requireIdempotency(req);
    if (partner.environment === LoyaltyEnvironment.SANDBOX) {
      const transaction = await sandboxLoyaltyEngine.reverseTransaction({
        originalTransactionId: req.params.transactionId,
        points: req.body.points,
        reason: req.body.reason,
        idempotencyKey,
        actor,
        partnerId: partner.partnerId,
      });
      res.status(201).json({ transaction, requestId: req.requestId });
      return;
    }
    const original = await ledgerRepository.getById(req.params.transactionId);
    if (!original || original.actorId !== partner.partnerId) {
      throw new LoyaltyProblemError("TRANSACTION_NOT_FOUND");
    }
    const txn = await loyaltyEngineService.reverseTransaction({
      originalTransactionId: req.params.transactionId,
      points: req.body.points,
      reason: req.body.reason,
      idempotencyKey,
      actor,
    });
    res.status(201).json({
      transaction: ledgerRepository.toResponseDto(txn),
      requestId: req.requestId,
    });
  } catch (error) {
    next(error);
  }
}

export async function createMemberToken(req: Request, res: Response, next: NextFunction) {
  try {
    const partner = getPartnerContext(req);
    if (partner.environment !== LoyaltyEnvironment.SANDBOX) {
      throw new LoyaltyProblemError("FORBIDDEN", "member-tokens solo disponible en sandbox");
    }
    const result = await sandboxMemberService.createMemberToken(
      req.body.memberId,
      partner.partnerId,
    );
    res.status(201).json({ ...result, requestId: req.requestId });
  } catch (error) {
    next(error);
  }
}

export async function previewEarn(req: Request, res: Response, next: NextFunction) {
  try {
    const amountCents = Number(req.query.amountCents ?? 0);
    const points = conversionRulesService.calculatePointsFromAmountCents(amountCents);
    res.status(200).json({ amountCents, points, currency: "MXN", requestId: req.requestId });
  } catch (error) {
    next(error);
  }
}
