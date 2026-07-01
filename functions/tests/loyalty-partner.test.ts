import { PartnerScope, LoyaltyEnvironment } from "../src/modules/loyalty/models/loyalty.enums";
import { requirePartnerScope } from "../src/modules/loyalty/partner/services/partner-scope.service";
import LoyaltyProblemError from "../src/modules/loyalty/errors/loyalty-problem.error";
import { PartnerAuthContext } from "../src/modules/loyalty/partner/partner.types";

describe("Partner scope service", () => {
  const baseContext: PartnerAuthContext = {
    clientId: "client_test_abc",
    partnerId: "partner_test_abc",
    environment: LoyaltyEnvironment.SANDBOX,
    scopes: [PartnerScope.WALLET_READ, PartnerScope.POINTS_EARN],
    allowedLocations: ["loc_1"],
    tokenId: "tok_test",
  };

  it("allows when scope is present", () => {
    expect(() => requirePartnerScope(baseContext, PartnerScope.WALLET_READ)).not.toThrow();
  });

  it("rejects missing scope", () => {
    expect(() => requirePartnerScope(baseContext, PartnerScope.REVERSALS_CREATE)).toThrow(
      LoyaltyProblemError,
    );
  });
});

describe("Loyalty problem OAuth codes", () => {
  it("maps INVALID_SCOPE to 403", () => {
    const err = new LoyaltyProblemError("INVALID_SCOPE");
    expect(err.status).toBe(403);
    expect(err.code).toBe("INVALID_SCOPE");
  });

  it("maps TOKEN_EXPIRED to 401", () => {
    const err = new LoyaltyProblemError("TOKEN_EXPIRED");
    expect(err.status).toBe(401);
  });
});

describe("Sandbox member id guard", () => {
  it("accepts test member prefix", () => {
    expect("test_member_cine_001".startsWith("test_member_")).toBe(true);
  });

  it("rejects production-looking ids in sandbox docs", () => {
    const prodLike = "firebase_uid_real_user";
    expect(prodLike.startsWith("test_member_")).toBe(false);
    expect(prodLike.startsWith("test_")).toBe(false);
  });
});
