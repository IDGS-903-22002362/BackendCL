export enum LoyaltyActorType {
  USER = "USER",
  ADMIN = "ADMIN",
  EMPLOYEE = "EMPLOYEE",
  SUPER_ADMIN = "SUPER_ADMIN",
  SERVICE = "SERVICE",
  PARTNER = "PARTNER",
}

export enum LoyaltyTransactionType {
  EARN = "EARN",
  ADJUSTMENT = "ADJUSTMENT",
  BONUS = "BONUS",
  REDEMPTION_HOLD = "REDEMPTION_HOLD",
  REDEMPTION_CONFIRM = "REDEMPTION_CONFIRM",
  REDEMPTION_RELEASE = "REDEMPTION_RELEASE",
  REVERSAL = "REVERSAL",
  EXPIRATION = "EXPIRATION",
}

export enum LoyaltyTransactionStatus {
  PENDING = "PENDING",
  CONFIRMED = "CONFIRMED",
  REVERSED = "REVERSED",
  FAILED = "FAILED",
}

export enum LoyaltyChannel {
  ECOMMERCE = "ECOMMERCE",
  STORE = "STORE",
  ADMIN = "ADMIN",
  SYSTEM = "SYSTEM",
  PARTNER = "PARTNER",
}

export enum LoyaltyPermission {
  WALLET_READ_SELF = "loyalty.wallet.read.self",
  WALLET_READ_ANY = "loyalty.wallet.read.any",
  TRANSACTIONS_READ_SELF = "loyalty.transactions.read.self",
  TRANSACTIONS_READ_ANY = "loyalty.transactions.read.any",
  POINTS_EARN = "loyalty.points.earn",
  POINTS_ADJUST = "loyalty.points.adjust",
  POINTS_REDEEM = "loyalty.points.redeem",
  POINTS_REVERSE = "loyalty.points.reverse",
}

export enum LoyaltyRedemptionStatus {
  PENDING = "PENDING",
  CONFIRMED = "CONFIRMED",
  CANCELLED = "CANCELLED",
  EXPIRED = "EXPIRED",
}

/** OAuth scopes for external partner integrations */
export enum PartnerScope {
  WALLET_READ = "loyalty.wallet.read",
  TRANSACTIONS_READ = "loyalty.transactions.read",
  POINTS_EARN = "loyalty.points.earn",
  REDEMPTIONS_CREATE = "loyalty.redemptions.create",
  REDEMPTIONS_CONFIRM = "loyalty.redemptions.confirm",
  REDEMPTIONS_CANCEL = "loyalty.redemptions.cancel",
  REVERSALS_CREATE = "loyalty.reversals.create",
}

export enum LoyaltyEnvironment {
  SANDBOX = "sandbox",
  PRODUCTION = "production",
}

export enum LoyaltyAdjustmentReason {
  MANUAL_CORRECTION = "MANUAL_CORRECTION",
  GOODWILL = "GOODWILL",
  FRAUD_REVERSAL = "FRAUD_REVERSAL",
  PROMOTION = "PROMOTION",
  SYSTEM_CORRECTION = "SYSTEM_CORRECTION",
}
