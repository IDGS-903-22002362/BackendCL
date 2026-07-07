import { createHash } from "crypto";
import { NextFunction, Request, Response } from "express";
import {
  consumeDistributedRateLimit,
  isDistributedRateLimitEnabled,
} from "../services/rate-limit-store.service";

type RateLimitOptions = {
  windowMs: number;
  maxRequests: number;
  keyPrefix: string;
  resolveKey?: (req: Request) => string;
};

type RateLimitEntry = {
  count: number;
  expiresAt: number;
};

const store = new Map<string, RateLimitEntry>();

const cleanupExpired = (now: number): void => {
  for (const [key, entry] of store.entries()) {
    if (entry.expiresAt <= now) {
      store.delete(key);
    }
  }
};

export function resolveClientIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0]?.trim() || "unknown";
  }

  return req.ip || "unknown";
}

function buildRateLimitKey(req: Request, options: RateLimitOptions): string {
  if (options.resolveKey) {
    // Incluir siempre keyPrefix: dos limiters con el mismo resolveKey
    // (p. ej. earn y redeem por partnerId) no deben compartir contador.
    return `${options.keyPrefix}:${options.resolveKey(req)}`;
  }

  const ip = resolveClientIp(req);
  const uid = req.user?.uid;
  const appCheck = req.header("X-Firebase-AppCheck");
  const appCheckFingerprint = appCheck
    ? createHash("sha256").update(appCheck).digest("hex").slice(0, 16)
    : "no-app-check";

  const identity = uid ? `uid:${uid}` : `ip:${ip}`;
  return `${options.keyPrefix}:${identity}:${appCheckFingerprint}`;
}

function consumeInMemoryRateLimit(
  key: string,
  windowMs: number,
  maxRequests: number,
  now: number,
): RateLimitDecision {
  cleanupExpired(now);
  const current = store.get(key);

  if (!current || current.expiresAt <= now) {
    store.set(key, {
      count: 1,
      expiresAt: now + windowMs,
    });
    return { allowed: true };
  }

  if (current.count >= maxRequests) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((current.expiresAt - now) / 1000)),
    };
  }

  current.count += 1;
  store.set(key, current);
  return { allowed: true };
}

type RateLimitDecision = {
  allowed: boolean;
  retryAfterSeconds?: number;
};

function rejectRateLimited(
  res: Response,
  retryAfterSeconds?: number,
): void {
  if (retryAfterSeconds) {
    res.setHeader("Retry-After", String(retryAfterSeconds));
  }

  res.status(429).json({
    success: false,
    message: "Demasiadas solicitudes. Intenta nuevamente en unos segundos",
  });
}

export const createSimpleRateLimiter = (options: RateLimitOptions) => {
  return async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    const now = Date.now();
    const key = buildRateLimitKey(req, options);

    if (isDistributedRateLimitEnabled()) {
      try {
        const decision = await consumeDistributedRateLimit(
          key,
          options.windowMs,
          options.maxRequests,
        );

        if (!decision.allowed) {
          rejectRateLimited(res, decision.retryAfterSeconds);
          return;
        }

        next();
        return;
      } catch (error) {
        console.warn("rate_limit_distributed_fallback", {
          prefix: options.keyPrefix,
          reason: error instanceof Error ? error.message : "unknown",
        });
      }
    }

    const decision = consumeInMemoryRateLimit(
      key,
      options.windowMs,
      options.maxRequests,
      now,
    );

    if (!decision.allowed) {
      rejectRateLimited(res, decision.retryAfterSeconds);
      return;
    }

    next();
  };
};
