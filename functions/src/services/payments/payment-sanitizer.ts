const SECRET_KEY_PATTERNS = [
  "authorization",
  "token",
  "secret",
  "signature",
  "password",
  "api-key",
  "apikey",
] as const;

const EMAIL_REGEX =
  /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+$/i;

const shouldMaskKey = (key: string): boolean => {
  const normalized = key.trim().toLowerCase();
  return SECRET_KEY_PATTERNS.some((pattern) => normalized.includes(pattern));
};

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
};

export const normalizeWhitespace = (value?: string): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized.length > 0 ? normalized : undefined;
};

export const normalizeEmail = (value?: string): string | undefined => {
  const normalized = normalizeWhitespace(value);
  return normalized ? normalized.toLowerCase() : undefined;
};

export const isValidEmail = (value?: string): boolean => {
  return Boolean(value && EMAIL_REGEX.test(value));
};

export const normalizeMxPhoneForAplazo = (value?: string): string | undefined => {
  const normalized = normalizeWhitespace(value);
  if (!normalized) {
    return undefined;
  }

  let digits = normalized.replace(/\D+/g, "");
  if (digits.startsWith("52") && digits.length === 12) {
    digits = digits.slice(2);
  }

  return /^\d{10}$/.test(digits) ? digits : undefined;
};

export const maskToken = (value?: string): string | undefined => {
  const normalized = normalizeWhitespace(value);
  if (!normalized) {
    return undefined;
  }

  if (normalized.length <= 8) {
    return "***";
  }

  return `${normalized.slice(0, 4)}***${normalized.slice(-4)}`;
};

export const maskEmail = (email?: string): string | undefined => {
  if (!email) {
    return undefined;
  }

  const normalized = email.trim();
  const [localPart, domain] = normalized.split("@");
  if (!localPart || !domain) {
    return "***";
  }

  const prefix = localPart.slice(0, 2);
  return `${prefix}***@${domain}`;
};

export const maskPhone = (phone?: string): string | undefined => {
  if (!phone) {
    return undefined;
  }

  const normalized = phone.replace(/\D/g, "");
  if (normalized.length <= 4) {
    return "***";
  }

  return `***${normalized.slice(-4)}`;
};

const sanitizeValue = (key: string | undefined, rawValue: unknown): unknown => {
  if (rawValue === undefined) {
    return undefined;
  }

  if (typeof rawValue === "string") {
    if (key && shouldMaskKey(key)) {
      return maskToken(rawValue) || "***";
    }

    if (key && key.toLowerCase().includes("email")) {
      return maskEmail(rawValue);
    }

    if (key && key.toLowerCase().includes("phone")) {
      return maskPhone(rawValue);
    }

    return rawValue;
  }

  if (Array.isArray(rawValue)) {
    return rawValue.map((entry) => sanitizeValue(undefined, entry));
  }

  if (isPlainObject(rawValue)) {
    return sanitizeObject(rawValue);
  }

  return rawValue;
};

const sanitizeObject = (input: Record<string, unknown>): Record<string, unknown> => {
  const sanitized: Record<string, unknown> = {};

  Object.entries(input).forEach(([key, rawValue]) => {
    if (rawValue === undefined) {
      return;
    }

    sanitized[key] = sanitizeValue(key, rawValue);
  });

  return sanitized;
};

export const sanitizeProviderHeaders = (
  headers: unknown,
): Record<string, unknown> => {
  if (!isPlainObject(headers)) {
    return {};
  }

  return sanitizeObject(headers);
};

export const sanitizeAxiosErrorData = (data: unknown): Record<string, unknown> => {
  if (Array.isArray(data)) {
    return { items: data.map((entry) => sanitizeValue(undefined, entry)) };
  }

  if (isPlainObject(data)) {
    return sanitizeObject(data);
  }

  if (data instanceof Error) {
    return sanitizeObject({
      name: data.name,
      message: data.message,
    });
  }

  if (data === undefined || data === null) {
    return {};
  }

  return { value: sanitizeValue(undefined, data) };
};

export const sanitizeOutgoingProviderPayload = (
  payload: unknown,
): Record<string, unknown> => {
  return sanitizeAxiosErrorData(payload);
};

export const sanitizeForStorage = (value: unknown): Record<string, unknown> => {
  return sanitizeAxiosErrorData(value);
};
