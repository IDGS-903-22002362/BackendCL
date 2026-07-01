import { PartnerScope } from "../../models/loyalty.enums";
import LoyaltyProblemError from "../../errors/loyalty-problem.error";
import { PartnerAuthContext } from "../partner.types";

const ENDPOINT_SCOPES: Record<string, PartnerScope> = {
  "GET /members/:memberId/wallet": PartnerScope.WALLET_READ,
  "GET /members/:memberId/transactions": PartnerScope.TRANSACTIONS_READ,
  "POST /earn-transactions": PartnerScope.POINTS_EARN,
  "GET /transactions/:transactionId": PartnerScope.TRANSACTIONS_READ,
  "POST /redemptions": PartnerScope.REDEMPTIONS_CREATE,
  "POST /redemptions/:redemptionId/confirm": PartnerScope.REDEMPTIONS_CONFIRM,
  "POST /redemptions/:redemptionId/cancel": PartnerScope.REDEMPTIONS_CANCEL,
  "POST /transactions/:transactionId/reversals": PartnerScope.REVERSALS_CREATE,
  "POST /member-tokens": PartnerScope.WALLET_READ,
};

export function requirePartnerScope(
  context: PartnerAuthContext,
  scope: PartnerScope,
): void {
  if (!context.scopes.includes(scope)) {
    throw new LoyaltyProblemError("INVALID_SCOPE");
  }
}

export function validateLocation(
  context: PartnerAuthContext,
  locationId?: string,
): void {
  if (!locationId || context.allowedLocations.length === 0) {
    return;
  }
  if (!context.allowedLocations.includes(locationId)) {
    throw new LoyaltyProblemError("LOCATION_NOT_ALLOWED");
  }
}

export function scopeForOperation(operationKey: string): PartnerScope | undefined {
  return ENDPOINT_SCOPES[operationKey];
}

export default { requirePartnerScope, validateLocation, scopeForOperation };
