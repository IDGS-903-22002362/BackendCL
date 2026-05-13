import axios from "axios";

export interface FedexSafeErrorPayload {
  provider: "FEDEX";
  status: number;
  message: string;
  fedexTransactionId?: string;
}

export class FedexProviderError extends Error {
  provider: "FEDEX";
  status: number;
  fedexTransactionId?: string;
  isOperational: boolean;

  constructor(payload: FedexSafeErrorPayload) {
    super(payload.message);
    this.name = "FedexProviderError";
    this.provider = payload.provider;
    this.status = payload.status;
    this.fedexTransactionId = payload.fedexTransactionId;
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }

  toJSON(): FedexSafeErrorPayload {
    return {
      provider: this.provider,
      status: this.status,
      message: this.message,
      ...(this.fedexTransactionId
        ? { fedexTransactionId: this.fedexTransactionId }
        : {}),
    };
  }
}

const getHeader = (
  headers: Record<string, unknown> | undefined,
  name: string,
): string | undefined => {
  if (!headers) {
    return undefined;
  }

  const entry = Object.entries(headers).find(
    ([key]) => key.toLowerCase() === name.toLowerCase(),
  );
  const value = entry?.[1];

  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.find((item): item is string => typeof item === "string");
  }

  return undefined;
};

const pickString = (
  value: unknown,
  keys: readonly string[],
): string | undefined => {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const record = value as Record<string, unknown>;

  for (const key of keys) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  return undefined;
};

const pickFedexMessage = (data: unknown, fallback: string): string => {
  const directMessage = pickString(data, [
    "message",
    "error_description",
    "error",
    "detail",
  ]);

  if (directMessage) {
    return directMessage;
  }

  if (data && typeof data === "object") {
    const errors = (data as Record<string, unknown>).errors;

    if (Array.isArray(errors)) {
      const firstMessage = errors
        .map((item) =>
          pickString(item, ["message", "code", "description", "detail"]),
        )
        .find((item): item is string => Boolean(item));

      if (firstMessage) {
        return firstMessage;
      }
    }
  }

  return fallback;
};

export const mapFedexError = (error: unknown): FedexProviderError => {
  if (error instanceof FedexProviderError) {
    return error;
  }

  if (axios.isAxiosError(error)) {
    const status = error.response?.status ?? 502;
    const headers = error.response?.headers as Record<string, unknown> | undefined;
    const transactionId =
      getHeader(headers, "x-customer-transaction-id") ||
      getHeader(headers, "x-correlation-id") ||
      getHeader(headers, "transaction-id") ||
      pickString(error.response?.data, ["transactionId", "customerTransactionId"]);

    return new FedexProviderError({
      provider: "FEDEX",
      status,
      message: pickFedexMessage(
        error.response?.data,
        error.response
          ? "FedEx request failed"
          : "FedEx request failed before receiving a response",
      ),
      ...(transactionId ? { fedexTransactionId: transactionId } : {}),
    });
  }

  return new FedexProviderError({
    provider: "FEDEX",
    status: 502,
    message: "FedEx request failed",
  });
};
