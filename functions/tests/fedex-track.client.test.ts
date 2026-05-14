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

import { FedexAuthService } from "../src/modules/shipping/fedex/fedex-auth.service";
import { FedexClient } from "../src/modules/shipping/fedex/fedex-client";
import {
  getFedexConfig,
  getFedexTrackConfig,
} from "../src/modules/shipping/fedex/fedex.config";

const originalEnv = { ...process.env };

const setEnv = () => {
  process.env.FEDEX_ENV = "sandbox";
  process.env.FEDEX_BASE_URL = "https://apis-sandbox.fedex.com";
  process.env.FEDEX_CLIENT_ID = "base-client";
  process.env.FEDEX_CLIENT_SECRET = "base-secret";
  process.env.FEDEX_ACCOUNT_NUMBER = "740561073";
};

describe("FedEx track client config", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    axiosIsAxiosError.mockImplementation((error: unknown) =>
      Boolean((error as { isAxiosError?: boolean })?.isAxiosError),
    );
    process.env = { ...originalEnv };
    setEnv();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("falls back to base FedEx credentials when track credentials are absent", () => {
    expect(getFedexTrackConfig()).toMatchObject(getFedexConfig());
  });

  it("uses explicit Track base URL and credentials with retry on 401", async () => {
    process.env.FEDEX_TRACK_BASE_URL = "https://track.example.test";
    process.env.FEDEX_TRACK_CLIENT_ID = "track-client";
    process.env.FEDEX_TRACK_CLIENT_SECRET = "track-secret";

    const auth = new FedexAuthService(getFedexTrackConfig);
    const client = new FedexClient(auth, getFedexTrackConfig);
    const unauthorized = Object.assign(new Error("Unauthorized"), {
      isAxiosError: true,
      response: { status: 401, data: { message: "Unauthorized" } },
    });

    axiosPost
      .mockResolvedValueOnce({
        data: { access_token: "track-token-1", token_type: "bearer", expires_in: 3600 },
      })
      .mockResolvedValueOnce({
        data: { access_token: "track-token-2", token_type: "bearer", expires_in: 3600 },
      });
    axiosRequest
      .mockRejectedValueOnce(unauthorized)
      .mockResolvedValueOnce({ data: { ok: true } });

    await expect(client.post("/track/v1/trackingnumbers", {})).resolves.toEqual({
      ok: true,
    });

    expect(axiosPost).toHaveBeenCalledWith(
      "https://track.example.test/oauth/token",
      expect.stringContaining("client_id=track-client"),
      expect.any(Object),
    );
    expect(axiosRequest).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        baseURL: "https://track.example.test",
        headers: expect.objectContaining({
          Authorization: "Bearer track-token-1",
        }),
      }),
    );
    expect(axiosRequest).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer track-token-2",
        }),
      }),
    );
  });
});
