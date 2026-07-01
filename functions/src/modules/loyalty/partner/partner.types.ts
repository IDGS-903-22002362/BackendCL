import {
  LoyaltyActorType,
  LoyaltyEnvironment,
  PartnerScope,
} from "../models/loyalty.enums";
import { LoyaltyActorContext } from "../models/loyalty.types";

export interface PartnerRecord {
  partnerId: string;
  name: string;
  environment: LoyaltyEnvironment;
  scopes: PartnerScope[];
  allowedLocations: string[];
  enabled: boolean;
  createdAt: FirebaseFirestore.Timestamp;
  updatedAt?: FirebaseFirestore.Timestamp;
}

export interface PartnerClientRecord {
  clientId: string;
  partnerId: string;
  environment: LoyaltyEnvironment;
  secretHash: string;
  secretSalt: string;
  enabled: boolean;
  scopes: PartnerScope[];
  allowedLocations: string[];
  createdAt: FirebaseFirestore.Timestamp;
  rotatedAt?: FirebaseFirestore.Timestamp;
  revokedAt?: FirebaseFirestore.Timestamp;
}

export interface PartnerTokenClaims {
  clientId: string;
  partnerId: string;
  environment: LoyaltyEnvironment;
  scopes: PartnerScope[];
  allowedLocations: string[];
  tokenId: string;
  iat: number;
  exp: number;
}

export interface PartnerAuthContext {
  clientId: string;
  partnerId: string;
  environment: LoyaltyEnvironment;
  scopes: PartnerScope[];
  allowedLocations: string[];
  tokenId: string;
}

export interface SandboxMemberRecord {
  memberId: string;
  partnerId: string;
  displayName: string;
  defaultPoints: number;
  environment: LoyaltyEnvironment.SANDBOX;
  createdAt: FirebaseFirestore.Timestamp;
  updatedAt?: FirebaseFirestore.Timestamp;
}

export interface SandboxMemberTokenRecord {
  token: string;
  memberId: string;
  partnerId: string;
  expiresAt: number;
  createdAt: FirebaseFirestore.Timestamp;
}

export interface PartnerAuditEntry {
  action: string;
  partnerId: string;
  clientId?: string;
  actorId: string;
  details?: Record<string, unknown>;
  createdAt: FirebaseFirestore.Timestamp;
}

export function buildPartnerActor(context: PartnerAuthContext): LoyaltyActorContext {
  return {
    actorType: LoyaltyActorType.PARTNER,
    actorId: context.partnerId,
    roles: ["PARTNER"],
    permissions: context.scopes.map(String),
  };
}

declare global {
  namespace Express {
    interface Request {
      partnerAuth?: PartnerAuthContext;
      loyaltyEnvironment?: LoyaltyEnvironment;
      requestId?: string;
    }
  }
}

export {};
