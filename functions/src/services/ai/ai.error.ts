export const AI_MODEL_UNSUPPORTED_CODE = "AI_MODEL_UNSUPPORTED";
export const AI_INTERNAL_ERROR_CODE = "AI_INTERNAL_ERROR";
export const AI_CONFIG_ERROR_CODE = "AI_CONFIG_ERROR";
export const AI_INVALID_CONFIGURATION_CODE = "AI_INVALID_CONFIGURATION";
export const RECOMMENDED_VERTEX_GEMINI_MODEL = "gemini-2.5-pro";

export class AiRuntimeError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly cause?: unknown;

  constructor(
    code: string,
    message: string,
    statusCode = 500,
    cause?: unknown,
  ) {
    super(message);
    this.name = "AiRuntimeError";
    this.code = code;
    this.statusCode = statusCode;
    this.cause = cause;
  }
}

export const isAiRuntimeError = (error: unknown): error is AiRuntimeError =>
  error instanceof AiRuntimeError;

export const toAiErrorPayload = (
  error: unknown,
): {
  code: string;
  message: string;
  statusCode: number;
} => {
  if (isAiRuntimeError(error)) {
    return {
      code: error.code,
      message: error.message,
      statusCode: error.statusCode,
    };
  }

  return {
    code: AI_INTERNAL_ERROR_CODE,
    message:
      error instanceof Error ? error.message : "Error interno del modulo AI",
    statusCode: 500,
  };
};
