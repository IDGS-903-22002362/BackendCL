type FirebaseLikeError = {
  code?: string;
  message?: string;
};

type ErrorMappingOptions = {
  unauthorizedMessage: string;
  forbiddenMessage: string;
  notFoundMessage: string;
  internalMessage: string;
};

export type MappedFirebaseError = {
  status: number;
  code: string;
  message: string;
};

const normalizeCode = (rawCode?: string): string =>
  (rawCode ?? "unknown").toLowerCase();

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message.toLowerCase();
  }

  return "";
};

export const mapFirebaseError = (
  error: unknown,
  options: ErrorMappingOptions,
): MappedFirebaseError => {
  const firebaseError = error as FirebaseLikeError;
  const code = normalizeCode(firebaseError?.code);
  const message = getErrorMessage(error);

  const isUnauthorized =
    code.includes("auth/") ||
    code.includes("unauthenticated") ||
    code.includes("invalid-id-token") ||
    code.includes("id-token-expired") ||
    message.includes("token inválido") ||
    message.includes("invalid token") ||
    message.includes("id token");

  if (isUnauthorized) {
    return {
      status: 401,
      code,
      message: options.unauthorizedMessage,
    };
  }

  const isForbidden =
    code.includes("permission-denied") ||
    code.includes("insufficient-permission") ||
    message.includes("insufficient permissions") ||
    message.includes("missing or insufficient permissions") ||
    message.includes("permission denied");

  if (isForbidden) {
    return {
      status: 403,
      code,
      message: options.forbiddenMessage,
    };
  }

  const isNotFound =
    code.includes("not-found") || message.includes("no encontrado");

  if (isNotFound) {
    return {
      status: 404,
      code,
      message: options.notFoundMessage,
    };
  }

  return {
    status: 500,
    code,
    message: options.internalMessage,
  };
};

export function isFirestoreMissingIndexError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const candidate = error as {
    code?: number | string;
    message?: string;
    details?: string;
  };

  if (candidate.code === 9 || candidate.code === "failed-precondition") {
    return true;
  }

  const text = `${candidate.message ?? ""} ${candidate.details ?? ""}`.toLowerCase();
  return text.includes("requires an index");
}
