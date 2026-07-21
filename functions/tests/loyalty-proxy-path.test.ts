/**
 * Contract test: loyalty proxy path mapping (mirrors TiendaFrontCL loyalty-proxy-path.ts).
 */
function buildLoyaltyBackendPath(path?: string[]): string {
  if (!path || path.length === 0) {
    return "/api/loyalty/internal/v1";
  }
  return `/api/loyalty/internal/v1/${path.join("/")}`;
}

describe("loyalty proxy path mapping", () => {
  it("maps wallets/me without double v1", () => {
    expect(buildLoyaltyBackendPath(["wallets", "me"])).toBe(
      "/api/loyalty/internal/v1/wallets/me",
    );
  });

  it("maps earn-transactions", () => {
    expect(buildLoyaltyBackendPath(["earn-transactions"])).toBe(
      "/api/loyalty/internal/v1/earn-transactions",
    );
  });

  it("maps admin transactions", () => {
    expect(buildLoyaltyBackendPath(["admin", "transactions"])).toBe(
      "/api/loyalty/internal/v1/admin/transactions",
    );
  });

  it("returns base path when segments empty", () => {
    expect(buildLoyaltyBackendPath()).toBe("/api/loyalty/internal/v1");
    expect(buildLoyaltyBackendPath([])).toBe("/api/loyalty/internal/v1");
  });
});
