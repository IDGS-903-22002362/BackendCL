/**
 * Middleware del router POS: contexto de request, App Check sin bypass, actor,
 * capacidades, idempotencia, rate limiting, validación y manejo de errores.
 */

import { NextFunction, Request, Response } from "express";
import { getAppCheck } from "firebase-admin/app-check";
import { ZodError, ZodSchema } from "zod";
import { admin } from "../../../config/firebase.admin";
import { resolveClientIp } from "../../../middleware/rate-limit.middleware";
import {
  consumeDistributedRateLimit,
  isDistributedRateLimitEnabled,
} from "../../../services/rate-limit-store.service";
import PosProblemError, {
  isPosProblemError,
} from "../errors/pos-problem.error";
import { PosAuditEntity, PosAuditEventType, PosCapability } from "../models/pos.enums";
import type { PosActor, PosRequestContext } from "../models/pos.types";
import {
  POS_METRICS,
  posErrorMetric,
  posLogger,
  posMetric,
  posWarnMetric,
} from "../observability/pos-logger";
import { hashIpAddress, posAuditService } from "../services/pos-audit.service";
import { posAuthorizationService } from "../services/pos-authorization.service";

declare global {
  namespace Express {
    interface Request {
      posActor?: PosActor;
      posContext?: PosRequestContext;
      posIdempotencyKey?: string;
    }
  }
}

const APP_CHECK_HEADER = "x-firebase-appcheck";
const DEVICE_ID_HEADER = "x-pos-device-id";
const MAX_APP_CHECK_TOKEN_LENGTH = 8192;
const MAX_IDEMPOTENCY_KEY_LENGTH = 200;

export type PosAppCheckMode = "observe" | "enforce";

const isProductionRuntime = (): boolean =>
  process.env.NODE_ENV === "production" ||
  Boolean(process.env.K_SERVICE || process.env.FUNCTION_NAME);

export function resolvePosAppCheckMode(): PosAppCheckMode {
  const configured = process.env.POS_APP_CHECK_MODE?.trim().toLowerCase();
  if (configured === "observe" || configured === "enforce") {
    return configured;
  }
  if (process.env.APP_CHECK_ENFORCED === "true") {
    return "enforce";
  }
  // Un POS deployado siempre exige App Check; en local se observa.
  return isProductionRuntime() ? "enforce" : "observe";
}

/** Excepción controlada solo para emulador/pruebas, nunca en runtime productivo. */
function isControlledLocalBypassEnabled(): boolean {
  if (isProductionRuntime()) {
    return false;
  }
  if (process.env.POS_APP_CHECK_ALLOW_LOCAL_BYPASS !== "true") {
    return false;
  }
  return Boolean(
    process.env.FUNCTIONS_EMULATOR === "true" ||
      process.env.FIREBASE_EMULATOR_HUB ||
      process.env.IS_LOCAL === "true" ||
      process.env.NODE_ENV === "test" ||
      process.env.NODE_ENV === "development",
  );
}

function isWellFormedAppCheckToken(token: string): boolean {
  return (
    token.length > 0 &&
    token.length <= MAX_APP_CHECK_TOKEN_LENGTH &&
    token.trim() === token &&
    !token.includes(",") &&
    /^[A-Za-z0-9._-]+$/.test(token)
  );
}

export function posRequestContextMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const deviceHeader = req.header(DEVICE_ID_HEADER)?.trim();
  req.posContext = {
    requestId: req.requestId ?? "unknown",
    deviceId: deviceHeader && deviceHeader.length <= 128 ? deviceHeader : undefined,
    ipHash: hashIpAddress(resolveClientIp(req)) ?? undefined,
    userAgent: req.header("user-agent") ?? undefined,
    appCheckVerified: false,
  };
  next();
}

/**
 * App Check del POS.
 *
 * A diferencia del middleware global, portar un Bearer válido NO omite App Check: el POS
 * es una app instalada y debe demostrar integridad de dispositivo (DEC-12).
 */
export async function posAppCheckMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const mode = resolvePosAppCheckMode();
  const route = (req.originalUrl || req.path || "").split("?")[0];

  if (isControlledLocalBypassEnabled()) {
    if (req.posContext) {
      req.posContext.appCheckVerified = false;
    }
    posLogger.info("pos_app_check_bypassed", {
      route,
      method: req.method,
      requestId: req.requestId,
    });
    next();
    return;
  }

  const token = req.header(APP_CHECK_HEADER);

  const failOrObserve = (reason: string): void => {
    if (mode === "enforce") {
      posWarnMetric(POS_METRICS.REQUEST, {
        route,
        method: req.method,
        result: "denied",
        errorCode: "APP_CHECK_REQUIRED",
        requestId: req.requestId,
      });
      next(new PosProblemError("APP_CHECK_REQUIRED"));
      return;
    }
    posLogger.warn("pos_app_check_observed", {
      route,
      method: req.method,
      reason,
      requestId: req.requestId,
    });
    next();
  };

  if (!token) {
    failOrObserve("missing");
    return;
  }
  if (!isWellFormedAppCheckToken(token)) {
    failOrObserve("malformed");
    return;
  }

  try {
    const appOficial = admin.app("APP_OFICIAL");
    const result = await getAppCheck(appOficial).verifyToken(token);
    if (req.posContext) {
      req.posContext.appCheckVerified = true;
      req.posContext.deviceId = req.posContext.deviceId ?? result.appId;
    }
    next();
  } catch (error) {
    failOrObserve(error instanceof Error ? "invalid" : "unknown");
  }
}

/** Construye el actor POS desde el token ya verificado por `authMiddleware`. */
export async function posActorMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.user?.uid) {
      throw new PosProblemError("AUTHENTICATION_REQUIRED");
    }
    req.posActor = await posAuthorizationService.resolveActor({
      uid: req.user.uid,
      email: req.user.email,
      nombre: req.user.nombre,
      rol: req.user.rol,
      activo: req.user.activo,
    });
    next();
  } catch (error) {
    next(error);
  }
}

export function requirePosCapability(capability: PosCapability) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const actor = req.posActor;
    if (!actor) {
      next(new PosProblemError("AUTHENTICATION_REQUIRED"));
      return;
    }
    if (!actor.capabilities.includes(capability)) {
      const route = (req.originalUrl || req.path || "").split("?")[0];
      posWarnMetric(POS_METRICS.PERMISSION_DENIED, {
        route,
        method: req.method,
        userId: actor.uid,
        posRole: actor.posRole,
        errorCode: "POS_PERMISSION_DENIED",
        requestId: req.requestId,
        result: "denied",
      });
      void posAuditService.recordDenied({
        eventType: PosAuditEventType.PERMISSION_DENIED,
        entity: PosAuditEntity.OPERATOR,
        entityId: actor.uid,
        actor,
        context: req.posContext ?? null,
        reason: `Capacidad requerida: ${capability}`,
        metadata: { route, method: req.method },
      });
      next(
        new PosProblemError(
          "POS_PERMISSION_DENIED",
          `Se requiere la capacidad ${capability}.`,
        ),
      );
      return;
    }
    next();
  };
}

/** Al menos una de las capacidades. Útil en lecturas con alcance propio o global. */
export function requireAnyPosCapability(capabilities: readonly PosCapability[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const actor = req.posActor;
    if (!actor) {
      next(new PosProblemError("AUTHENTICATION_REQUIRED"));
      return;
    }
    if (!capabilities.some((capability) => actor.capabilities.includes(capability))) {
      next(new PosProblemError("POS_PERMISSION_DENIED"));
      return;
    }
    next();
  };
}

export function requirePosIdempotencyKey(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const key = req.header("Idempotency-Key")?.trim();
  if (!key) {
    next(new PosProblemError("IDEMPOTENCY_KEY_REQUIRED"));
    return;
  }
  if (key.length > MAX_IDEMPOTENCY_KEY_LENGTH || !/^[\w.:-]+$/.test(key)) {
    next(
      new PosProblemError(
        "POS_VALIDATION_ERROR",
        "Idempotency-Key inválida: usa hasta 200 caracteres alfanuméricos, `.`, `:`, `-` o `_`.",
      ),
    );
    return;
  }
  req.posIdempotencyKey = key;
  next();
}

/**
 * Límite de payload propio del POS.
 *
 * El parser global admite 32 MB por las cargas de imágenes del ecommerce. Ningún comando
 * del POS necesita más de unos pocos KB, así que se rechaza antes de gastar recursos.
 */
export function posPayloadLimit(maxBytes = 64 * 1024) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const declared = Number(req.header("content-length") ?? "0");
    if (Number.isFinite(declared) && declared > maxBytes) {
      next(
        new PosProblemError(
          "POS_VALIDATION_ERROR",
          `El cuerpo de la solicitud excede el límite de ${Math.floor(maxBytes / 1024)} KB.`,
        ),
      );
      return;
    }
    next();
  };
}

interface PosRateLimitOptions {
  keyPrefix: string;
  windowMs: number;
  maxRequests: number;
}

/**
 * Rate limit por actor y dispositivo, con fallback a IP cuando aún no hay actor.
 * Reutiliza el store distribuido existente para que el límite sea global entre instancias.
 */
export function posRateLimiter(options: PosRateLimitOptions) {
  const memoryStore = new Map<string, { count: number; expiresAt: number }>();

  const consumeInMemory = (key: string, now: number) => {
    for (const [entryKey, entry] of memoryStore.entries()) {
      if (entry.expiresAt <= now) {
        memoryStore.delete(entryKey);
      }
    }
    const current = memoryStore.get(key);
    if (!current || current.expiresAt <= now) {
      memoryStore.set(key, { count: 1, expiresAt: now + options.windowMs });
      return { allowed: true as const };
    }
    if (current.count >= options.maxRequests) {
      return {
        allowed: false as const,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((current.expiresAt - now) / 1000),
        ),
      };
    }
    current.count += 1;
    return { allowed: true as const };
  };

  return async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    const identity = req.posActor?.uid
      ? `uid:${req.posActor.uid}`
      : req.user?.uid
        ? `uid:${req.user.uid}`
        : `ip:${resolveClientIp(req)}`;
    const device = req.posContext?.deviceId ?? "no-device";
    const key = `pos:${options.keyPrefix}:${identity}:${device}`;

    let decision: { allowed: boolean; retryAfterSeconds?: number };
    if (isDistributedRateLimitEnabled()) {
      try {
        decision = await consumeDistributedRateLimit(
          key,
          options.windowMs,
          options.maxRequests,
        );
      } catch (error) {
        posLogger.warn("pos_rate_limit_fallback", {
          keyPrefix: options.keyPrefix,
          reason: error instanceof Error ? error.message : "unknown",
        });
        decision = consumeInMemory(key, Date.now());
      }
    } else {
      decision = consumeInMemory(key, Date.now());
    }

    if (!decision.allowed) {
      if (decision.retryAfterSeconds) {
        res.setHeader("Retry-After", String(decision.retryAfterSeconds));
      }
      next(new PosProblemError("RATE_LIMITED"));
      return;
    }

    next();
  };
}

function zodIssues(error: ZodError): Array<{
  field: string;
  message: string;
  code: string;
}> {
  return error.errors.map((issue) => ({
    field: issue.path.join("."),
    message: issue.message,
    code: issue.code,
  }));
}

/** Validadores que producen `application/problem+json` en lugar del formato legado. */
export function validatePosBody(schema: ZodSchema) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      next(
        new PosProblemError(
          "POS_VALIDATION_ERROR",
          "El cuerpo de la solicitud es inválido.",
          zodIssues(parsed.error),
        ),
      );
      return;
    }
    req.body = parsed.data;
    next();
  };
}

export function validatePosParams(schema: ZodSchema) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const parsed = schema.safeParse(req.params);
    if (!parsed.success) {
      next(
        new PosProblemError(
          "POS_VALIDATION_ERROR",
          "Los parámetros de ruta son inválidos.",
          zodIssues(parsed.error),
        ),
      );
      return;
    }
    req.params = parsed.data as Record<string, string>;
    next();
  };
}

export function validatePosQuery(schema: ZodSchema) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const parsed = schema.safeParse(req.query);
    if (!parsed.success) {
      next(
        new PosProblemError(
          "POS_VALIDATION_ERROR",
          "Los parámetros de consulta son inválidos.",
          zodIssues(parsed.error),
        ),
      );
      return;
    }
    req.query = parsed.data as Request["query"];
    next();
  };
}

/** Log estructurado de cada request del POS, sin payloads. */
export function posRequestLogger(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const startedAt = Date.now();
  const route = (req.originalUrl || req.path || "").split("?")[0];

  res.on("finish", () => {
    posMetric(POS_METRICS.REQUEST, {
      route,
      method: req.method,
      statusCode: res.statusCode,
      durationMs: Date.now() - startedAt,
      userId: req.posActor?.uid,
      posRole: req.posActor?.posRole,
      requestId: req.requestId,
      result: res.statusCode < 400 ? "success" : "failure",
    });
  });

  next();
}

/** Errores de Firestore por contención de transacción, expuestos como 409 accionable. */
function mapInfrastructureError(error: unknown): PosProblemError | null {
  const code = (error as { code?: unknown }).code;
  if (code === 10 || code === "aborted" || code === "ABORTED") {
    return new PosProblemError("CONCURRENT_MODIFICATION");
  }
  if (code === 6 || code === "already-exists" || code === "ALREADY_EXISTS") {
    return new PosProblemError(
      "CONCURRENT_MODIFICATION",
      "Otra operación creó el recurso primero. Vuelve a intentarlo.",
    );
  }
  if (code === 4 || code === "deadline-exceeded") {
    return new PosProblemError(
      "CONCURRENT_MODIFICATION",
      "La operación no se pudo completar por contención. Reintenta.",
    );
  }
  return null;
}

export function handlePosError(
  error: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (res.headersSent) {
    next(error);
    return;
  }

  const route = (req.originalUrl || req.path || "").split("?")[0];

  if (isPosProblemError(error)) {
    if (error.code === "CONCURRENT_MODIFICATION") {
      posWarnMetric(POS_METRICS.TRANSACTION_CONTENTION, {
        route,
        method: req.method,
        requestId: req.requestId,
        errorCode: error.code,
      });
    }
    if (error.code === "IDEMPOTENCY_CONFLICT") {
      posWarnMetric(POS_METRICS.IDEMPOTENCY_CONFLICT, {
        route,
        method: req.method,
        requestId: req.requestId,
      });
    }
    if (error.code === "INSUFFICIENT_STOCK") {
      posWarnMetric(POS_METRICS.INSUFFICIENT_STOCK, {
        route,
        method: req.method,
        requestId: req.requestId,
      });
    }
    res
      .status(error.status)
      .type("application/problem+json")
      .json(error.toProblemJson(route, req.requestId));
    return;
  }

  const mapped = mapInfrastructureError(error);
  if (mapped) {
    posWarnMetric(POS_METRICS.TRANSACTION_CONTENTION, {
      route,
      method: req.method,
      requestId: req.requestId,
      errorCode: mapped.code,
    });
    res
      .status(mapped.status)
      .type("application/problem+json")
      .json(mapped.toProblemJson(route, req.requestId));
    return;
  }

  // Nunca se filtra el mensaje interno ni el stack al cliente.
  posErrorMetric(POS_METRICS.SERVER_ERROR, {
    route,
    method: req.method,
    requestId: req.requestId,
    result: "failure",
    errorCode: "INTERNAL_ERROR",
  });
  posLogger.error("pos_unhandled_error", {
    route,
    method: req.method,
    requestId: req.requestId,
    reason: error instanceof Error ? error.message : "unknown",
  });

  const problem = new PosProblemError("INTERNAL_ERROR");
  res
    .status(problem.status)
    .type("application/problem+json")
    .json(problem.toProblemJson(route, req.requestId));
}
