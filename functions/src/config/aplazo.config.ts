import { ApiError } from "../utils/error-handler";

export type AplazoChannel = "online";
export type AplazoWebhookAuthScheme = "Bearer" | "Basic";

export interface AplazoChannelConfig {
  enabled: boolean;
  baseUrl?: string;
  merchantBaseUrl?: string;
  refundsBaseUrl?: string;
  merchantId?: string;
  apiToken?: string;
  webhookSecret?: string;
  webhookAuthScheme?: AplazoWebhookAuthScheme;
  timeoutMs: number;
  successUrl?: string;
  cancelUrl?: string;
  failureUrl?: string;
  cartUrl?: string;
}

export interface AplazoConfig {
  enabled: boolean;
  env: string;
  integrationVersion: string;
  refundsEnabled: boolean;
  reconcileEnabled: boolean;
  online: AplazoChannelConfig;
}

const getBoolean = (name: string, fallback: boolean): boolean => {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) {
    return fallback;
  }

  return raw === "1" || raw === "true" || raw === "yes";
};

const getNumber = (name: string, fallback: number): number => {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return fallback;
  }

  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const getOptional = (name: string): string | undefined => {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : undefined;
};

const getWebhookAuthScheme = (
  name: string,
): AplazoWebhookAuthScheme | undefined => {
  const value = getOptional(name)?.toLowerCase();
  if (!value) {
    return undefined;
  }

  return value === "basic" ? "Basic" : "Bearer";
};

export const getAplazoConfig = (): AplazoConfig => {
  return {
    enabled: getBoolean("APLAZO_ENABLED", false),
    env: getOptional("APLAZO_ENV") || "sandbox",
    integrationVersion:
      getOptional("APLAZO_INTEGRATION_VERSION") || "unconfirmed-contract",
    refundsEnabled: getBoolean("APLAZO_REFUNDS_ENABLED", false),
    reconcileEnabled: getBoolean("APLAZO_RECONCILE_ENABLED", true),
    online: {
      enabled: getBoolean("APLAZO_ONLINE_ENABLED", false),
      baseUrl: getOptional("APLAZO_ONLINE_BASE_URL"),
      merchantBaseUrl: getOptional("APLAZO_ONLINE_MERCHANT_BASE_URL"),
      refundsBaseUrl: getOptional("APLAZO_ONLINE_REFUNDS_BASE_URL"),
      merchantId: getOptional("APLAZO_ONLINE_MERCHANT_ID"),
      apiToken: getOptional("APLAZO_ONLINE_API_TOKEN"),
      webhookSecret: getOptional("APLAZO_ONLINE_WEBHOOK_SECRET"),
      webhookAuthScheme:
        getWebhookAuthScheme("APLAZO_ONLINE_WEBHOOK_AUTH_SCHEME") || "Bearer",
      timeoutMs: getNumber("APLAZO_ONLINE_TIMEOUT_MS", 15000),
      successUrl: getOptional("APLAZO_ONLINE_SUCCESS_URL"),
      cancelUrl: getOptional("APLAZO_ONLINE_CANCEL_URL"),
      failureUrl: getOptional("APLAZO_ONLINE_FAILURE_URL"),
      cartUrl: getOptional("APLAZO_ONLINE_CART_URL"),
    },
  };
};

export const assertAplazoEnabled = (channel: AplazoChannel): AplazoConfig => {
  const config = getAplazoConfig();
  const channelConfig = channel === "online" ? config.online : undefined;

  if (!config.enabled || !channelConfig?.enabled) {
    throw new ApiError(503, "APLAZO_DISABLED");
  }

  return config;
};
