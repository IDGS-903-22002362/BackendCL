import { NextFunction, Request, Response } from "express";
import LoyaltyProblemError from "../errors/loyalty-problem.error";
import { LoyaltyPermission } from "../models/loyalty.enums";
import { LoyaltyActorContext } from "../models/loyalty.types";
import {
  actorHasPermission,
  buildActorContext,
} from "../services/loyalty-auth.service";

declare global {
  namespace Express {
    interface Request {
      loyaltyActor?: LoyaltyActorContext;
      loyaltyIdempotencyKey?: string;
    }
  }
}

export function loyaltyActorMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  if (!req.user?.uid || !req.user.rol) {
    next(new LoyaltyProblemError("FORBIDDEN"));
    return;
  }
  req.loyaltyActor = buildActorContext({
    uid: req.user.uid,
    rol: req.user.rol,
  });
  next();
}

export function requireLoyaltyPermission(permission: LoyaltyPermission) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const actor = req.loyaltyActor;
    if (!actor || !actorHasPermission(actor, permission)) {
      next(new LoyaltyProblemError("FORBIDDEN"));
      return;
    }
    next();
  };
}

export function requireIdempotencyKey(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const key = req.header("Idempotency-Key")?.trim();
  if (!key) {
    next(new LoyaltyProblemError("IDEMPOTENCY_KEY_REQUIRED"));
    return;
  }
  req.loyaltyIdempotencyKey = key;
  next();
}

export function handleLoyaltyError(
  err: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (res.headersSent) {
    next(err);
    return;
  }

  if (err instanceof LoyaltyProblemError) {
    res
      .status(err.status)
      .type("application/problem+json")
      .json(err.toProblemJson(req.originalUrl, req.requestId));
    return;
  }

  if (err instanceof Error && err.message === "INSUFFICIENT_POINTS") {
    const problem = new LoyaltyProblemError("INSUFFICIENT_POINTS");
    res
      .status(problem.status)
      .type("application/problem+json")
      .json(problem.toProblemJson(req.originalUrl));
    return;
  }

  if (err instanceof Error && err.message === "MEMBER_NOT_FOUND") {
    const problem = new LoyaltyProblemError("MEMBER_NOT_FOUND");
    res
      .status(problem.status)
      .type("application/problem+json")
      .json(problem.toProblemJson(req.originalUrl));
    return;
  }

  const problem = new LoyaltyProblemError("INTERNAL_ERROR");
  res
    .status(problem.status)
    .type("application/problem+json")
    .json(problem.toProblemJson(req.originalUrl));
}
