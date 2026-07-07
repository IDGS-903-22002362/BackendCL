export const LOYALTY_COLLECTIONS = {
  WALLETS: "loyalty_wallets",
  TRANSACTIONS: "loyalty_transactions",
  REDEMPTIONS: "loyalty_redemptions",
  IDEMPOTENCY: "loyalty_idempotency",
  EXTERNAL_TXN_INDEX: "loyalty_external_txn_index",
} as const;

export const LOYALTY_SANDBOX_COLLECTIONS = {
  WALLETS: "loyalty_sandbox_wallets",
  TRANSACTIONS: "loyalty_sandbox_transactions",
  REDEMPTIONS: "loyalty_sandbox_redemptions",
  IDEMPOTENCY: "loyalty_sandbox_idempotency",
  EXTERNAL_TXN_INDEX: "loyalty_sandbox_external_txn_index",
  MEMBERS: "loyalty_sandbox_members",
  MEMBER_TOKENS: "loyalty_sandbox_member_tokens",
} as const;

export const LOYALTY_PARTNER_COLLECTIONS = {
  PARTNERS: "loyalty_partners",
  CLIENTS: "loyalty_partner_clients",
  AUDIT: "loyalty_partner_audit",
} as const;

export const LOYALTY_DEFAULTS = {
  WELCOME_BONUS_POINTS: 40,
  STREAK_DAILY_BONUS_POINTS: 5,
  MAX_POINTS_PER_TRANSACTION: 100_000,
  IDEMPOTENCY_TTL_MS: 24 * 60 * 60 * 1000,
  REDEMPTION_HOLD_TTL_MS: 30 * 60 * 1000,
  POINTS_CONVERSION_RATE: 0.1,
  PARTNER_TOKEN_TTL_SECONDS: 3600,
  MEMBER_TOKEN_TTL_MS: 30 * 60 * 1000,
  SANDBOX_DEFAULT_POINTS: 500,
} as const;

export const LOYALTY_PROBLEM_BASE_URI =
  "https://clubleon.mx/developers/problems/loyalty";

export const LOYALTY_PROBLEM_BASE_URI_LEGACY =
  "https://tiendalaguarida.com/problems/loyalty";
