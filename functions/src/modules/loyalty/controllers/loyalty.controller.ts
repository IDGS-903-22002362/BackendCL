import { Request, Response, NextFunction } from "express";
import { RolUsuario } from "../../../models/usuario.model";
import LoyaltyProblemError from "../errors/loyalty-problem.error";
import { LoyaltyAdjustmentReason, LoyaltyPermission } from "../models/loyalty.enums";
import ledgerRepository from "../repositories/ledger.repository";
import walletRepository from "../repositories/wallet.repository";
import conversionRulesService from "../services/conversion-rules.service";
import loyaltyEngineService from "../services/loyalty-engine.service";
import { actorHasPermission } from "../services/loyalty-auth.service";
import { firestoreApp } from "../../../config/app.firebase";
import { isCustomerOnlyAccount } from "../../../utils/usuario-roles";

function requireActor(req: Request) {
  if (!req.loyaltyActor) {
    throw new LoyaltyProblemError("FORBIDDEN");
  }
  return req.loyaltyActor;
}

function requireIdempotency(req: Request): string {
  const key = req.loyaltyIdempotencyKey ?? req.header("Idempotency-Key")?.trim();
  if (!key) {
    throw new LoyaltyProblemError("IDEMPOTENCY_KEY_REQUIRED");
  }
  return key;
}

export async function getMyWallet(req: Request, res: Response, next: NextFunction) {
  try {
    const actor = requireActor(req);
    const wallet = await loyaltyEngineService.getWallet(actor.actorId);
    res.status(200).json({ wallet: walletRepository.toResponseDto(wallet) });
  } catch (error) {
    next(error);
  }
}

export async function getMyTransactions(req: Request, res: Response, next: NextFunction) {
  try {
    const actor = requireActor(req);
    const limit = Number(req.query.limit ?? 50);
    const result = await ledgerRepository.listByMember(actor.actorId, {
      limit,
      cursor: req.query.cursor as string | undefined,
      type: req.query.type as string | undefined,
      status: req.query.status as string | undefined,
      from: req.query.from as string | undefined,
      to: req.query.to as string | undefined,
    });
    res.status(200).json({
      items: result.items.map((item) => ledgerRepository.toResponseDto(item)),
      pagination: {
        nextCursor: result.nextCursor,
        hasMore: Boolean(result.nextCursor),
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function getMemberWalletAdmin(req: Request, res: Response, next: NextFunction) {
  try {
    const memberId = req.params.memberId;
    const wallet = await loyaltyEngineService.getWallet(memberId);
    res.status(200).json({ wallet: walletRepository.toResponseDto(wallet) });
  } catch (error) {
    next(error);
  }
}

export async function getQrMemberSummary(req: Request, res: Response, next: NextFunction) {
  try {
    const memberId = req.params.memberId;
    const userSnap = await firestoreApp.collection("usuariosApp").doc(memberId).get();
    const userData = userSnap.data();

    if (!userSnap.exists || !isCustomerOnlyAccount(userData ?? {})) {
      throw new LoyaltyProblemError("MEMBER_NOT_FOUND");
    }

    const wallet = await loyaltyEngineService.getWallet(memberId);
    const fullName =
      typeof userData?.nombre === "string" && userData.nombre.trim()
        ? userData.nombre.trim()
        : "Cliente";
    res.status(200).json({
      member: {
        memberId,
        fullName,
        currentPoints: wallet.availablePoints,
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function previewEarnPoints(req: Request, res: Response, next: NextFunction) {
  try {
    const amountCents = Number(req.query.amountCents ?? 0);
    const points = conversionRulesService.calculatePointsFromAmountCents(amountCents);
    res.status(200).json({ amountCents, points, currency: "MXN" });
  } catch (error) {
    next(error);
  }
}

export async function createEarnTransaction(req: Request, res: Response, next: NextFunction) {
  try {
    const actor = requireActor(req);
    const idempotencyKey = requireIdempotency(req);
    const txn = await loyaltyEngineService.earnFromSale({
      ...req.body,
      idempotencyKey,
      actor,
    });
    res.status(201).json({ transaction: ledgerRepository.toResponseDto(txn) });
  } catch (error) {
    next(error);
  }
}

export async function createAdjustment(req: Request, res: Response, next: NextFunction) {
  try {
    const actor = requireActor(req);
    const idempotencyKey = requireIdempotency(req);
    const txn = await loyaltyEngineService.applyAdjustment({
      memberId: req.body.memberId,
      points: req.body.points,
      reasonCode: req.body.reasonCode as LoyaltyAdjustmentReason,
      description: req.body.description,
      externalReference: req.body.externalReference,
      idempotencyKey,
      actor,
    });
    res.status(201).json({ transaction: ledgerRepository.toResponseDto(txn) });
  } catch (error) {
    next(error);
  }
}

export async function createRedemption(req: Request, res: Response, next: NextFunction) {
  try {
    const actor = requireActor(req);
    const idempotencyKey = requireIdempotency(req);
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
    });
  } catch (error) {
    next(error);
  }
}

export async function confirmRedemption(req: Request, res: Response, next: NextFunction) {
  try {
    const actor = requireActor(req);
    const idempotencyKey = requireIdempotency(req);
    const txn = await loyaltyEngineService.confirmRedemption(
      req.params.redemptionId,
      actor,
      idempotencyKey,
    );
    res.status(201).json({ transaction: ledgerRepository.toResponseDto(txn) });
  } catch (error) {
    next(error);
  }
}

export async function cancelRedemption(req: Request, res: Response, next: NextFunction) {
  try {
    const actor = requireActor(req);
    const idempotencyKey = requireIdempotency(req);
    const txn = await loyaltyEngineService.cancelRedemption(
      req.params.redemptionId,
      actor,
      idempotencyKey,
    );
    res.status(201).json({ transaction: ledgerRepository.toResponseDto(txn) });
  } catch (error) {
    next(error);
  }
}

export async function getTransactionById(req: Request, res: Response, next: NextFunction) {
  try {
    const actor = requireActor(req);
    const txn = await ledgerRepository.getById(req.params.transactionId);
    if (!txn) {
      throw new LoyaltyProblemError("TRANSACTION_NOT_FOUND");
    }
    const canReadAny = actorHasPermission(actor, LoyaltyPermission.TRANSACTIONS_READ_ANY);
    if (txn.memberId !== actor.actorId && !canReadAny) {
      throw new LoyaltyProblemError("FORBIDDEN");
    }
    res.status(200).json({ transaction: ledgerRepository.toResponseDto(txn) });
  } catch (error) {
    next(error);
  }
}

export async function reverseTransaction(req: Request, res: Response, next: NextFunction) {
  try {
    const actor = requireActor(req);
    const idempotencyKey = requireIdempotency(req);
    const txn = await loyaltyEngineService.reverseTransaction({
      originalTransactionId: req.params.transactionId,
      points: req.body.points,
      reason: req.body.reason,
      idempotencyKey,
      actor,
    });
    res.status(201).json({ transaction: ledgerRepository.toResponseDto(txn) });
  } catch (error) {
    next(error);
  }
}

export async function getAdminTransactions(req: Request, res: Response, next: NextFunction) {
  try {
    const actor = requireActor(req);
    const limit = Number(req.query.limit ?? 50);

    let actorId = req.query.actorId as string | undefined;
    if (req.user?.rol === RolUsuario.EMPLEADO) {
      actorId = actor.actorId;
    } else if (req.user?.rol === RolUsuario.ADMIN && req.query.actorId) {
      actorId = String(req.query.actorId);
    }

    const result = await ledgerRepository.listAdmin({
      limit,
      cursor: req.query.cursor as string | undefined,
      memberId: req.query.memberId as string | undefined,
      actorId,
      channel: req.query.channel as never,
    });
    res.status(200).json({
      items: result.items.map((item) => ledgerRepository.toResponseDto(item)),
      pagination: {
        nextCursor: result.nextCursor,
        hasMore: Boolean(result.nextCursor),
      },
    });
  } catch (error) {
    next(error);
  }
}
