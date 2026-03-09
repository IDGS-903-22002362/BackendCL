import { createHash } from "crypto";
import Stripe from "stripe";
import { ApiError } from "../utils/error-handler";

const STRIPE_API_VERSION = "2025-02-24.acacia" as Stripe.LatestApiVersion;

const getRequiredEnv = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new ApiError(500, `La variable de entorno ${name} es requerida`);
  }

  return value;
};

export const getStripeSecretKey = (): string => getRequiredEnv("STRIPE_SECRET_KEY");

export const getStripeWebhookSecret = (): string =>
  getRequiredEnv("STRIPE_WEBHOOK_SECRET");

export const getStripePublishableKey = (): string | undefined => {
  const key = process.env.STRIPE_PUBLISHABLE_KEY?.trim();
  return key && key.length > 0 ? key : undefined;
};

export const getStripeCurrency = (): string => {
  const configured = process.env.STRIPE_CURRENCY?.trim().toLowerCase();
  return configured && configured.length > 0 ? configured : "mxn";
};

export const getAppUrl = (): string => {
  const appUrl = process.env.APP_URL?.trim();
  if (!appUrl) {
    throw new ApiError(500, "La variable de entorno APP_URL es requerida");
  }

  return appUrl;
};

let stripeClient: Stripe | null = null;

export const getStripeClient = (): Stripe => {
  if (!stripeClient) {
    stripeClient = new Stripe(getStripeSecretKey(), {
      apiVersion: STRIPE_API_VERSION,
    });
  }

  return stripeClient;
};

export type StripeIdempotencyInput = {
  operation: string;
  orderId?: string;
  cartId?: string;
  userId: string;
  amount: number;
  currency: string;
  extra?: string;
};

export const buildStripeIdempotencyKey = (
  input: StripeIdempotencyInput,
): string => {
  const payload = [
    input.operation,
    input.orderId || "",
    input.cartId || "",
    input.userId,
    String(input.amount),
    input.currency.toLowerCase(),
    input.extra || "",
  ].join("|");

  const digest = createHash("sha256").update(payload).digest("hex");
  return `${input.operation}_${digest.slice(0, 48)}`;
};
