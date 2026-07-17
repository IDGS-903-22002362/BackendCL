import { NextFunction, Request, Response } from "express";
import { getAppCheck } from "firebase-admin/app-check";
import { admin } from "../config/firebase.admin";
import logger from "../utils/logger";

export type AiAppCheckMode = "observe" | "enforce";

type AiAppCheckReason =
  | "valid"
  | "missing"
  | "malformed"
  | "expired"
  | "invalid"
  | "local_bypass";

const appCheckLogger = logger.child({ component: "ai-app-check" });
const APP_CHECK_HEADER = "x-firebase-appcheck";
const MAX_APP_CHECK_TOKEN_LENGTH = 8192;

const isProductionRuntime = (): boolean =>
  process.env.NODE_ENV === "production" ||
  Boolean(process.env.K_SERVICE || process.env.FUNCTION_NAME);

export const resolveAiAppCheckMode = (): AiAppCheckMode => {
  const configuredMode = process.env.AI_APP_CHECK_MODE?.trim().toLowerCase();
  if (configuredMode === "observe" || configuredMode === "enforce") {
    return configuredMode;
  }

  // Preserve the existing global rollout flag while failing closed by default
  // for AI traffic in a deployed runtime.
  if (process.env.APP_CHECK_ENFORCED === "true") {
    return "enforce";
  }

  return isProductionRuntime() ? "enforce" : "observe";
};

const isControlledLocalBypassEnabled = (): boolean => {
  if (isProductionRuntime()) {
    return false;
  }

  if (process.env.AI_APP_CHECK_ALLOW_LOCAL_BYPASS !== "true") {
    return false;
  }

  return Boolean(
    process.env.FUNCTIONS_EMULATOR === "true" ||
      process.env.FIREBASE_EMULATOR_HUB ||
      process.env.IS_LOCAL === "true" ||
      process.env.NODE_ENV === "development",
  );
};

const getRequestMetadata = (req: Request) => ({
  metric: "ai_app_check_requests_total",
  method: req.method,
  route: (req.originalUrl || req.path || "").split("?")[0],
  requestId: req.requestId,
});

const recordAppCheckOutcome = (
  req: Request,
  input: {
    mode: AiAppCheckMode;
    outcome: "allowed" | "observed" | "rejected" | "bypassed";
    reason: AiAppCheckReason;
  },
): void => {
  const context = {
    ...getRequestMetadata(req),
    appCheckMode: input.mode,
    outcome: input.outcome,
    reason: input.reason,
  };

  if (input.outcome === "rejected" || input.reason === "invalid") {
    appCheckLogger.warn("ai_app_check_request", context);
    return;
  }

  appCheckLogger.info("ai_app_check_request", context);
};

const isWellFormedAppCheckToken = (token: string): boolean =>
  token.length > 0 &&
  token.length <= MAX_APP_CHECK_TOKEN_LENGTH &&
  token.trim() === token &&
  !token.includes(",") &&
  /^[A-Za-z0-9._-]+$/.test(token);

const getVerificationFailureReason = (error: unknown): AiAppCheckReason => {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: unknown }).code || "").toLowerCase()
      : "";

  return code.includes("expired") ? "expired" : "invalid";
};

const rejectAppCheck = (res: Response): void => {
  res.status(401).json({
    success: false,
    message: "Solicitud no autorizada",
    code: "AI_APP_CHECK_FAILED",
  });
};

export const aiAppCheckMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const mode = resolveAiAppCheckMode();

  if (isControlledLocalBypassEnabled()) {
    recordAppCheckOutcome(req, {
      mode,
      outcome: "bypassed",
      reason: "local_bypass",
    });
    next();
    return;
  }

  const token = req.header(APP_CHECK_HEADER);
  if (!token) {
    const outcome = mode === "enforce" ? "rejected" : "observed";
    recordAppCheckOutcome(req, { mode, outcome, reason: "missing" });
    if (mode === "enforce") {
      rejectAppCheck(res);
      return;
    }

    next();
    return;
  }

  if (!isWellFormedAppCheckToken(token)) {
    const outcome = mode === "enforce" ? "rejected" : "observed";
    recordAppCheckOutcome(req, { mode, outcome, reason: "malformed" });
    if (mode === "enforce") {
      rejectAppCheck(res);
      return;
    }

    next();
    return;
  }

  try {
    const appOficial = admin.app("APP_OFICIAL");
    await getAppCheck(appOficial).verifyToken(token);
    recordAppCheckOutcome(req, { mode, outcome: "allowed", reason: "valid" });
    next();
  } catch (error) {
    const reason = getVerificationFailureReason(error);
    const outcome = mode === "enforce" ? "rejected" : "observed";
    recordAppCheckOutcome(req, { mode, outcome, reason });
    if (mode === "enforce") {
      rejectAppCheck(res);
      return;
    }

    next();
  }
};

export default aiAppCheckMiddleware;
