const SECRET_KEY_PATTERNS = [
  "authorization",
  "token",
  "secret",
  "signature",
  "password",
  "api-key",
  "apikey",
] as const;

const shouldMaskKey = (key: string): boolean => {
  const normalized = key.trim().toLowerCase();
  return SECRET_KEY_PATTERNS.some((pattern) => normalized.includes(pattern));
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

export const sanitizeForStorage = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const input = value as Record<string, unknown>;
  const sanitized: Record<string, unknown> = {};

  Object.entries(input).forEach(([key, rawValue]) => {
    if (rawValue === undefined) {
      return;
    }

    if (shouldMaskKey(key)) {
      sanitized[key] = "***";
      return;
    }

    if (key.toLowerCase().includes("email") && typeof rawValue === "string") {
      sanitized[key] = maskEmail(rawValue);
      return;
    }

    if (key.toLowerCase().includes("phone") && typeof rawValue === "string") {
      sanitized[key] = maskPhone(rawValue);
      return;
    }

    if (Array.isArray(rawValue)) {
      sanitized[key] = rawValue.map((entry) =>
        typeof entry === "object" && entry !== null
          ? sanitizeForStorage(entry)
          : entry,
      );
      return;
    }

    if (typeof rawValue === "object" && rawValue !== null) {
      sanitized[key] = sanitizeForStorage(rawValue);
      return;
    }

    sanitized[key] = rawValue;
  });

  return sanitized;
};
