import { NextFunction, Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import LoyaltyProblemError from "../../errors/loyalty-problem.error";
import { LoyaltyEnvironment, PartnerScope } from "../../models/loyalty.enums";
import { buildPartnerActor, PartnerAuthContext } from "../partner.types";
import partnerOAuthService from "../services/partner-oauth.service";
import { requirePartnerScope } from "../services/partner-scope.service";

export function requestIdMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  req.requestId =
    req.header("X-Request-Id")?.trim() || `req_${uuidv4().replace(/-/g, "").slice(0, 20)}`;
  next();
}

/** Structured partner request log (no secrets or full tokens). */
export function partnerRequestLogMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const startedAt = Date.now();
  res.on("finish", () => {
    const context = req.partnerAuth;
    const logPayload: Record<string, unknown> = {
      severity: res.statusCode >= 500 ? "ERROR" : "INFO",
      message: "loyalty_partner_request",
      requestId: req.requestId,
      method: req.method,
      path: req.originalUrl ?? req.path,
      status: res.statusCode,
      latencyMs: Date.now() - startedAt,
      environment: req.loyaltyEnvironment,
    };
    if (context) {
      logPayload.partnerId = context.partnerId;
      logPayload.clientId = context.clientId;
    }
    if (res.statusCode === 401 && context === undefined) {
      logPayload.authFailure = true;
    }
    if (res.statusCode === 429) {
      logPayload.rateLimited = true;
    }
    console.log(JSON.stringify(logPayload));
  });
  next();
}

export function createPartnerAuthMiddleware(environment: LoyaltyEnvironment) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      const header = req.header("Authorization");
      if (!header?.startsWith("Bearer ")) {
        throw new LoyaltyProblemError("AUTHENTICATION_REQUIRED");
      }
      const token = header.slice("Bearer ".length).trim();
      req.partnerAuth = partnerOAuthService.verifyToken(token, environment);
      req.loyaltyEnvironment = environment;
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function requirePartnerScopeMiddleware(scope: PartnerScope) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      const context = req.partnerAuth;
      if (!context) {
        throw new LoyaltyProblemError("AUTHENTICATION_REQUIRED");
      }
      requirePartnerScope(context, scope);
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function attachPartnerActor(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const context = req.partnerAuth;
  if (context) {
    req.loyaltyActor = buildPartnerActor(context);
  }
  next();
}

export function getPartnerContext(req: Request): PartnerAuthContext {
  if (!req.partnerAuth) {
    throw new LoyaltyProblemError("AUTHENTICATION_REQUIRED");
  }
  return req.partnerAuth;
}

export default createPartnerAuthMiddleware;
