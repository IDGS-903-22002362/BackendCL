const axiosPost = jest.fn();
const axiosRequest = jest.fn();
const axiosIsAxiosError = jest.fn((error: unknown) =>
  Boolean((error as { isAxiosError?: boolean })?.isAxiosError),
);

jest.mock("axios", () => ({
  __esModule: true,
  default: {
    post: axiosPost,
    request: axiosRequest,
    isAxiosError: axiosIsAxiosError,
  },
  isAxiosError: axiosIsAxiosError,
}));

import { getFedexConfig } from "../src/modules/shipping/fedex/fedex.config";
import { FedexAuthService } from "../src/modules/shipping/fedex/fedex-auth.service";
import { FedexClient } from "../src/modules/shipping/fedex/fedex-client";
import { mapFedexError } from "../src/modules/shipping/fedex/fedex.errors";

const originalEnv = { ...process.env };

const setFedexEnv = () => {
  process.env.FEDEX_ENV = "sandbox";
  process.env.FEDEX_BASE_URL = "https://apis-sandbox.fedex.com";
  process.env.FEDEX_CLIENT_ID = "client-id";
  process.env.FEDEX_CLIENT_SECRET = "client-secret";
  process.env.FEDEX_ACCOUNT_NUMBER = "740561073";
};

const mockTokenResponse = (
  accessToken: string,
  expiresIn = 3600,
  tokenType = "bearer",
) => ({
  data: {
    access_token: accessToken,
    token_type: tokenType,
    expires_in: expiresIn,
    scope: "CXS",
  },
});

describe("FedEx auth foundation", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    axiosPost.mockReset();
    axiosRequest.mockReset();
    axiosIsAxiosError.mockClear();
    process.env = { ...originalEnv };
    setFedexEnv();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("throws a clear error when a required env var is missing", () => {
    delete process.env.FEDEX_CLIENT_SECRET;

    expect(() => getFedexConfig()).toThrow(
      "Missing FedEx environment variable: FEDEX_CLIENT_SECRET",
    );
  });

  it("caches a valid OAuth token in memory", async () => {
    const service = new FedexAuthService();
    axiosPost.mockResolvedValueOnce(mockTokenResponse("token-one", 3600));

    await expect(service.getAccessToken()).resolves.toBe("token-one");
    await expect(service.getAccessToken()).resolves.toBe("token-one");

    expect(axiosPost).toHaveBeenCalledTimes(1);
  });

  it("refreshes when the token is within the five minute buffer", async () => {
    const service = new FedexAuthService();
    axiosPost
      .mockResolvedValueOnce(mockTokenResponse("token-short", 299))
      .mockResolvedValueOnce(mockTokenResponse("token-fresh", 3600));

    await expect(service.getAccessToken()).resolves.toBe("token-short");
    await expect(service.getAccessToken()).resolves.toBe("token-fresh");

    expect(axiosPost).toHaveBeenCalledTimes(2);
  });

  it("forceRefreshToken bypasses a valid cached token", async () => {
    const service = new FedexAuthService();
    axiosPost
      .mockResolvedValueOnce(mockTokenResponse("token-one", 3600))
      .mockResolvedValueOnce(mockTokenResponse("token-two", 3600));

    await expect(service.getAccessToken()).resolves.toBe("token-one");
    await expect(service.forceRefreshToken()).resolves.toBe("token-two");

    expect(axiosPost).toHaveBeenCalledTimes(2);
  });

  it("fedexClient refreshes and retries once after a 401", async () => {
    const service = new FedexAuthService();
    const client = new FedexClient(service);
    const unauthorizedError = Object.assign(new Error("Unauthorized"), {
      isAxiosError: true,
      response: { status: 401, data: { message: "Unauthorized" } },
    });

    axiosPost
      .mockResolvedValueOnce(mockTokenResponse("token-one", 3600))
      .mockResolvedValueOnce(mockTokenResponse("token-two", 3600));
    axiosRequest
      .mockRejectedValueOnce(unauthorizedError)
      .mockResolvedValueOnce({ data: { ok: true } });

    await expect(client.get("/rates/quotes")).resolves.toEqual({ ok: true });

    expect(axiosPost).toHaveBeenCalledTimes(2);
    expect(axiosRequest).toHaveBeenCalledTimes(2);
    expect(axiosRequest).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer token-one",
          "Content-Type": "application/json",
        }),
      }),
    );
    expect(axiosRequest).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer token-two",
        }),
      }),
    );
  });

  it("maps FedEx errors without exposing secrets or full payloads", () => {
    const error = Object.assign(new Error("Provider error"), {
      isAxiosError: true,
      response: {
        status: 400,
        headers: {
          "x-customer-transaction-id": "transaction-123",
        },
        data: {
          message: "Invalid FedEx request",
          client_secret: "client-secret",
          access_token: "token-secret",
        },
      },
    });

    const mapped = mapFedexError(error).toJSON();

    expect(mapped).toEqual({
      provider: "FEDEX",
      status: 400,
      message: "Invalid FedEx request",
      fedexTransactionId: "transaction-123",
    });
    expect(JSON.stringify(mapped)).not.toContain("client-secret");
    expect(JSON.stringify(mapped)).not.toContain("token-secret");
  });
});
