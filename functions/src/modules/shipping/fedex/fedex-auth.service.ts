import axios from "axios";
import { FedexConfig, getFedexConfig } from "./fedex.config";
import { mapFedexError } from "./fedex.errors";

const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

export interface FedexOAuthResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope?: string;
}

export interface FedexCachedToken {
  accessToken: string;
  tokenType: string;
  expiresAt: number;
  scope?: string;
}

export interface FedexTokenStatus {
  tokenType: string;
  expiresInSeconds: number;
}

const isValidOAuthResponse = (value: unknown): value is FedexOAuthResponse => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;

  return (
    typeof record.access_token === "string" &&
    Boolean(record.access_token.trim()) &&
    typeof record.token_type === "string" &&
    Boolean(record.token_type.trim()) &&
    typeof record.expires_in === "number" &&
    Number.isFinite(record.expires_in) &&
    record.expires_in > 0
  );
};

export class FedexAuthService {
  private cachedToken?: FedexCachedToken;
  private refreshPromise?: Promise<FedexCachedToken>;

  constructor(private readonly configResolver: () => FedexConfig = getFedexConfig) {}

  async getAccessToken(): Promise<string> {
    const token = await this.getValidToken();
    return token.accessToken;
  }

  async forceRefreshToken(): Promise<string> {
    const token = await this.refreshToken();
    return token.accessToken;
  }

  getTokenStatus(): FedexTokenStatus {
    if (!this.cachedToken) {
      return {
        tokenType: "",
        expiresInSeconds: 0,
      };
    }

    return {
      tokenType: this.cachedToken.tokenType.toLowerCase(),
      expiresInSeconds: Math.max(
        0,
        Math.floor((this.cachedToken.expiresAt - Date.now()) / 1000),
      ),
    };
  }

  clearCacheForTests(): void {
    this.cachedToken = undefined;
    this.refreshPromise = undefined;
  }

  private async getValidToken(): Promise<FedexCachedToken> {
    if (this.cachedToken && !this.shouldRefresh(this.cachedToken)) {
      return this.cachedToken;
    }

    return this.refreshToken();
  }

  private shouldRefresh(token: FedexCachedToken): boolean {
    return token.expiresAt - Date.now() <= TOKEN_REFRESH_BUFFER_MS;
  }

  private async refreshToken(): Promise<FedexCachedToken> {
    if (!this.refreshPromise) {
      this.refreshPromise = this.requestToken().finally(() => {
        this.refreshPromise = undefined;
      });
    }

    return this.refreshPromise;
  }

  private async requestToken(): Promise<FedexCachedToken> {
    const config = this.configResolver();
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: config.clientId,
      client_secret: config.clientSecret,
    });

    try {
      const response = await axios.post<unknown>(
        `${config.baseUrl}/oauth/token`,
        body.toString(),
        {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
        },
      );

      if (!isValidOAuthResponse(response.data)) {
        throw new Error("FedEx auth response did not include a valid token");
      }

      const token: FedexCachedToken = {
        accessToken: response.data.access_token,
        tokenType: response.data.token_type,
        expiresAt: Date.now() + response.data.expires_in * 1000,
        ...(response.data.scope ? { scope: response.data.scope } : {}),
      };

      this.cachedToken = token;
      return token;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw mapFedexError(error);
      }

      throw error;
    }
  }
}

export const fedexAuthService = new FedexAuthService();
