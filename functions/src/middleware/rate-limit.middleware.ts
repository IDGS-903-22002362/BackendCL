import { NextFunction, Request, Response } from "express";

type RateLimitOptions = {
  windowMs: number;
  maxRequests: number;
  keyPrefix: string;
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

export const createSimpleRateLimiter = (options: RateLimitOptions) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const now = Date.now();
    cleanupExpired(now);

    const ip = req.ip || req.headers["x-forwarded-for"] || "unknown";
    const key = `${options.keyPrefix}:${String(ip)}`;
    const current = store.get(key);

    if (!current || current.expiresAt <= now) {
      store.set(key, {
        count: 1,
        expiresAt: now + options.windowMs,
      });
      next();
      return;
    }

    if (current.count >= options.maxRequests) {
      const retryAfterSeconds = Math.ceil((current.expiresAt - now) / 1000);
      res.setHeader("Retry-After", String(Math.max(1, retryAfterSeconds)));
      res.status(429).json({
        success: false,
        message: "Demasiadas solicitudes. Intenta nuevamente en unos segundos",
      });
      return;
    }

    current.count += 1;
    store.set(key, current);
    next();
  };
};
