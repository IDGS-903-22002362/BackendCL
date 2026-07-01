import { Timestamp } from "firebase-admin/firestore";
import {
  LoyaltyActorType,
  LoyaltyChannel,
  LoyaltyRedemptionStatus,
  LoyaltyTransactionStatus,
  LoyaltyTransactionType,
} from "./loyalty.enums";

export interface LoyaltyActorContext {
  actorType: LoyaltyActorType;
  actorId: string;
  roles: string[];
  permissions: string[];
}

export interface LoyaltyWallet {
  memberId: string;
  availablePoints: number;
  heldPoints: number;
  pendingPoints: number;
  lifetimeEarnedPoints: number;
  lifetimeRedeemedPoints: number;
  level: string;
  nextExpirationAt?: Timestamp;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface LoyaltyTransaction {
  transactionId: string;
  memberId: string;
  actorId: string;
  actorType: LoyaltyActorType;
  type: LoyaltyTransactionType;
  status: LoyaltyTransactionStatus;
  points: number;
  balanceBefore: number;
  balanceAfter: number;
  channel: LoyaltyChannel;
  amountCents?: number;
  currency?: string;
  externalTransactionId?: string;
  idempotencyKeyHash?: string;
  originalTransactionId?: string;
  description?: string;
  reasonCode?: string;
  locationId?: string;
  metadata?: Record<string, string | number | boolean>;
  reversedPoints?: number;
  partiallyReversed?: boolean;
  createdAt: Timestamp;
}

export interface LoyaltyRedemption {
  redemptionId: string;
  memberId: string;
  points: number;
  holdTransactionId: string;
  status: LoyaltyRedemptionStatus;
  expiresAt: Timestamp;
  createdAt: Timestamp;
  updatedAt?: Timestamp;
}

export interface EarnTransactionInput {
  memberId: string;
  externalTransactionId: string;
  amountCents: number;
  currency: string;
  channel: LoyaltyChannel;
  description?: string;
  locationId?: string;
  metadata?: Record<string, string | number | boolean>;
  idempotencyKey: string;
  actor: LoyaltyActorContext;
}

export interface AdjustmentInput {
  memberId: string;
  points: number;
  reasonCode: string;
  description: string;
  externalReference: string;
  idempotencyKey: string;
  actor: LoyaltyActorContext;
}

export interface RedemptionInput {
  memberId: string;
  points: number;
  description?: string;
  idempotencyKey: string;
  actor: LoyaltyActorContext;
}

export interface ReversalInput {
  originalTransactionId: string;
  points?: number;
  reason: string;
  idempotencyKey: string;
  actor: LoyaltyActorContext;
}

export interface WalletResponseDto {
  memberId: string;
  availablePoints: number;
  heldPoints: number;
  pendingPoints: number;
  lifetimeEarnedPoints: number;
  lifetimeRedeemedPoints: number;
  level: string;
  nextExpirationAt?: string;
  upcomingExpirations: Array<{ points: number; expiresAt: string }>;
}

export interface TransactionResponseDto {
  transactionId: string;
  memberId: string;
  type: LoyaltyTransactionType;
  status: LoyaltyTransactionStatus;
  points: number;
  balanceBefore: number;
  balanceAfter: number;
  channel: LoyaltyChannel;
  amountCents?: number;
  currency?: string;
  externalTransactionId?: string;
  originalTransactionId?: string;
  description?: string;
  reasonCode?: string;
  actorId: string;
  createdAt: string;
}

export interface RedemptionResponseDto {
  redemptionId: string;
  memberId: string;
  points: number;
  status: LoyaltyRedemptionStatus;
  holdTransactionId: string;
  expiresAt: string;
  createdAt: string;
}

export interface IdempotencyRecord {
  operation: string;
  actorId: string;
  requestHash: string;
  statusCode: number;
  responseBody: unknown;
  expiresAt: number;
  createdAt?: Timestamp;
}

export interface ExternalTxnIndexRecord {
  transactionId: string;
  memberId: string;
  channel?: LoyaltyChannel;
}
