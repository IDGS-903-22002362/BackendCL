export const LOYALTY_COLLECTIONS = {
  WALLETS: "loyalty_wallets",
  TRANSACTIONS: "loyalty_transactions",
  REDEMPTIONS: "loyalty_redemptions",
  IDEMPOTENCY: "loyalty_idempotency",
  EXTERNAL_TXN_INDEX: "loyalty_external_txn_index",
} as const;

export const LOYALTY_DEFAULTS = {
  WELCOME_BONUS_POINTS: 40,
  MAX_POINTS_PER_TRANSACTION: 100_000,
  IDEMPOTENCY_TTL_MS: 24 * 60 * 60 * 1000,
  REDEMPTION_HOLD_TTL_MS: 30 * 60 * 1000,
  POINTS_CONVERSION_RATE: 0.1,
} as const;

export const LOYALTY_PROBLEM_BASE_URI =
  "https://tiendalaguarida.com/problems/loyalty";
