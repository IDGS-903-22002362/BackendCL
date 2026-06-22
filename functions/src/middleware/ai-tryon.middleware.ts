import { NextFunction, Request, Response } from "express";
import aiConfig from "../config/ai.config";
import { AiRuntimeError, AI_TRYON_DISABLED_CODE } from "../services/ai/ai.error";
import { createSimpleRateLimiter } from "./rate-limit.middleware";

export const requireTryOnEnabled = (
  _req: Request,
  res: Response,
  next: NextFunction,
): void => {
  if (!aiConfig.tryOn.enabled) {
    const error = new AiRuntimeError(
      AI_TRYON_DISABLED_CODE,
      "El probador virtual no esta disponible temporalmente",
      503,
    );
    res.status(error.statusCode).json({
      success: false,
      message: error.message,
      error: { code: error.code, message: error.message },
    });
    return;
  }

  next();
};

const resolveTryOnRateLimitKey = (req: Request): string => {
  const userId = req.user?.uid;
  if (userId) {
    return `ai:tryon:user:${userId}`;
  }

  const ip = req.ip || req.headers["x-forwarded-for"] || "unknown";
  return `ai:tryon:ip:${String(ip)}`;
};

export const aiTryOnUserRateLimiter = createSimpleRateLimiter({
  keyPrefix: "ai:tryon",
  maxRequests: aiConfig.tryOn.userRateLimitMax,
  windowMs: aiConfig.tryOn.userRateLimitWindowMs,
  resolveKey: resolveTryOnRateLimitKey,
});