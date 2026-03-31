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
  registerBranch?: string;
  resendCheckout?: string;
  getQr?: string;
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
  const channelConfig = channel === "online" ? config.online : config.inStore;
  const prefix = channel === "online" ? "APLAZO_ONLINE" : "APLAZO_INSTORE";

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
      auth: channel === "online" ? getEnv(`${prefix}_AUTH_PATH`) : undefined,
      create: getRequiredPath(`${prefix}_CREATE_PATH`),
      status: getRequiredPath(`${prefix}_STATUS_PATH`),
      cancelOrVoid: getEnv(`${prefix}_CANCEL_PATH`),
      refund: getEnv(`${prefix}_REFUND_PATH`),
      refundStatus: getEnv(`${prefix}_REFUND_STATUS_PATH`),
      registerBranch:
        channel === "in_store"
          ? getEnv(`${prefix}_REGISTER_BRANCH_PATH`)
          : undefined,
      resendCheckout:
        channel === "in_store"
          ? getEnv(`${prefix}_RESEND_CHECKOUT_PATH`)
          : undefined,
      getQr:
        channel === "in_store" ? getEnv(`${prefix}_GET_QR_PATH`) : undefined,
    },
  };
};

export const getAplazoContractTodoMessage = (fieldName: string): string => {
  return `TODO: confirmar ${fieldName} exacto con colección Postman de Aplazo`;
};

export const sanitizeAplazoPayload = (payload: unknown): Record<string, unknown> => {
  return sanitizeForStorage(payload);
};
