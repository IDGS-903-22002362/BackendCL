import {
  AplazoChannel,
  AplazoWebhookAuthScheme,
  getAplazoConfig,
} from "../../config/aplazo.config";
import { sanitizeForStorage } from "./payment-sanitizer";

export interface AplazoContractPaths {
  auth?: string;
  create: string;
  status: string;
  cancelOrVoid?: string;
  refund?: string;
  refundStatus?: string;
}

export interface AplazoContractBaseUrls {
  api?: string;
  merchant?: string;
  refunds?: string;
}

export interface AplazoContractConfig {
  channel: AplazoChannel;
  timeoutMs: number;
  merchantId?: string;
  apiToken?: string;
  webhookSecret?: string;
  webhookAuthScheme?: AplazoWebhookAuthScheme;
  baseUrls: AplazoContractBaseUrls;
  paths: AplazoContractPaths;
}

const getEnv = (name: string): string | undefined => {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : undefined;
};

const getRequiredPath = (name: string): string => {
  return getEnv(name) || "";
};

export const getAplazoContractConfig = (
  channel: AplazoChannel,
): AplazoContractConfig => {
  const config = getAplazoConfig();
  const channelConfig = config.online;
  const prefix = "APLAZO_ONLINE";

  return {
    channel,
    timeoutMs: channelConfig.timeoutMs,
    merchantId: channelConfig.merchantId,
    apiToken: channelConfig.apiToken,
    webhookSecret: channelConfig.webhookSecret,
    webhookAuthScheme: channelConfig.webhookAuthScheme,
    baseUrls: {
      api: channelConfig.baseUrl,
      merchant: channelConfig.merchantBaseUrl,
      refunds: channelConfig.refundsBaseUrl,
    },
    paths: {
      auth: getEnv(`${prefix}_AUTH_PATH`),
      create: getRequiredPath(`${prefix}_CREATE_PATH`),
      status: getRequiredPath(`${prefix}_STATUS_PATH`),
      cancelOrVoid: getEnv(`${prefix}_CANCEL_PATH`),
      refund: getEnv(`${prefix}_REFUND_PATH`),
      refundStatus: getEnv(`${prefix}_REFUND_STATUS_PATH`),
    },
  };
};

export const getAplazoContractTodoMessage = (fieldName: string): string => {
  return `TODO: confirmar ${fieldName} exacto con colección Postman de Aplazo`;
};

export const sanitizeAplazoPayload = (payload: unknown): Record<string, unknown> => {
  return sanitizeForStorage(payload);
};
