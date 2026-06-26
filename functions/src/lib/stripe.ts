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

/**
 * Opciones de tarjeta para PaymentIntent legacy (automatic_payment_methods).
 * MSI solo aplica con MXN y cuenta Stripe México.
 */
export const buildStripePaymentIntentCardOptions = (
  currency: string,
): Stripe.PaymentIntentCreateParams.PaymentMethodOptions | undefined => {
  if (currency.trim().toLowerCase() !== "mxn") {
    return undefined;
  }

  return {
    card: {
      installments: {
        enabled: true,
      },
    },
  };
};

/** Montos mínimos en unidad menor (centavos). Fuente: Stripe docs /currencies */
const STRIPE_MIN_AMOUNT_MINOR_BY_CURRENCY: Record<string, number> = {
  mxn: 1000, // 10.00 MXN
  usd: 50, // 0.50 USD
};

export const getStripeMinimumAmountMinor = (currency: string): number => {
  const normalized = currency.trim().toLowerCase();
  return STRIPE_MIN_AMOUNT_MINOR_BY_CURRENCY[normalized] ?? 1000;
};

export const isStripeMissingResourceError = (error: unknown): boolean => {
  if (!error || typeof error !== "object") {
    return false;
  }

  const stripeError = error as { code?: string; type?: string };
  return (
    stripeError.type === "StripeInvalidRequestError" &&
    stripeError.code === "resource_missing"
  );
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
    assertStripeKeyEnvironment();
    stripeClient = new Stripe(getStripeSecretKey(), {
      apiVersion: STRIPE_API_VERSION,
    });
  }

  return stripeClient;
};

const isProductionRuntime = (): boolean =>
  Boolean(process.env.K_SERVICE || process.env.NODE_ENV === "production");

export const assertStripeKeyEnvironment = (): void => {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) {
    return;
  }

  if (!isProductionRuntime() && key.startsWith("sk_live_")) {
    throw new ApiError(
      500,
      "No usar claves Stripe live en entorno no productivo",
    );
  }

  if (isProductionRuntime() && key.startsWith("sk_test_")) {
    console.warn("stripe_key_env_mismatch", {
      runtime: "production",
      keyMode: "test",
    });
  }
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

/**
 * Opciones compartidas para Stripe Hosted Checkout con métodos dinámicos.
 * No fija payment_method_types: Apple Pay, Google Pay, Link y tarjetas los
 * controla el Dashboard + contexto del cliente (MXN, monto, navegador).
 */
export const buildHostedCheckoutSessionBaseParams = (
  currency: string,
): Pick<
  Stripe.Checkout.SessionCreateParams,
  "locale" | "payment_method_options"
> => {
  const normalizedCurrency = currency.trim().toLowerCase();
  const params: Pick<
    Stripe.Checkout.SessionCreateParams,
    "locale" | "payment_method_options"
  > = {
    locale: "es",
  };

  if (normalizedCurrency === "mxn") {
    params.payment_method_options = {
      card: {
        installments: {
          enabled: true,
        },
      },
    };
  }

  return params;
};

/** @deprecated Usa buildHostedCheckoutSessionBaseParams */
export const buildEmbeddedCheckoutSessionBaseParams =
  buildHostedCheckoutSessionBaseParams;

export const buildStripeCheckoutSessionExpiresAt = (
  ttlMinutes: number,
): number => {
  const safeTtl = Number.isFinite(ttlMinutes) && ttlMinutes > 0 ? ttlMinutes : 30;
  return Math.floor(Date.now() / 1000) + safeTtl * 60;
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
