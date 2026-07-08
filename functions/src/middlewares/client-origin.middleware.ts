import type { NextFunction, Request, Response } from "express";
import type { ClientOrigin } from "../types/client-origin";

export const CLIENT_ORIGIN_HEADER = "x-client-origin";

const APP_ORIGINS = new Set<ClientOrigin>(["ios_app", "android_app"]);

export function parseClientOriginHeader(
  value: string | string[] | undefined,
): ClientOrigin {
  const raw = Array.isArray(value) ? value[0] : value;
  const normalized = raw?.trim().toLowerCase();

  if (normalized === "ios_app" || normalized === "android_app") {
    return normalized;
  }

  return "web";
}

export function isEmbeddedAppOrigin(origin: ClientOrigin): boolean {
  return APP_ORIGINS.has(origin);
}

export function resolveAdvertisingTrackingAllowed(
  origin: ClientOrigin,
): boolean {
  return !isEmbeddedAppOrigin(origin);
}

export function clientOriginMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const origin = parseClientOriginHeader(req.header(CLIENT_ORIGIN_HEADER));
  req.clientOrigin = origin;
  req.advertisingTrackingAllowed = resolveAdvertisingTrackingAllowed(origin);
  next();
}
