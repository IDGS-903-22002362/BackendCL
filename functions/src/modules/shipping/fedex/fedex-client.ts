import axios, { AxiosRequestConfig, Method } from "axios";
import { FedexConfig, getFedexConfig } from "./fedex.config";
import { FedexAuthService, fedexAuthService } from "./fedex-auth.service";
import { mapFedexError } from "./fedex.errors";

type FedexRequestConfig = Omit<
  AxiosRequestConfig,
  "baseURL" | "headers" | "method" | "url" | "data"
> & {
  headers?: Record<string, string>;
};

export class FedexClient {
  constructor(
    private readonly authService: FedexAuthService,
    private readonly configResolver: () => FedexConfig = getFedexConfig,
  ) {}

  async get<T = unknown>(
    path: string,
    config: FedexRequestConfig = {},
  ): Promise<T> {
    return this.request<T>("GET", path, undefined, config);
  }

  async post<T = unknown>(
    path: string,
    data?: unknown,
    config: FedexRequestConfig = {},
  ): Promise<T> {
    return this.request<T>("POST", path, data, config);
  }

  async put<T = unknown>(
    path: string,
    data?: unknown,
    config: FedexRequestConfig = {},
  ): Promise<T> {
    return this.request<T>("PUT", path, data, config);
  }

  private async request<T>(
    method: Method,
    path: string,
    data: unknown,
    config: FedexRequestConfig,
    retried = false,
  ): Promise<T> {
    const fedexConfig = this.configResolver();
    const accessToken = await this.authService.getAccessToken();

    try {
      const response = await axios.request<T>({
        ...config,
        method,
        baseURL: fedexConfig.baseUrl,
        url: path,
        data,
        headers: {
          ...config.headers,
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      });

      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 401 && !retried) {
        await this.authService.forceRefreshToken();
        return this.request<T>(method, path, data, config, true);
      }

      throw mapFedexError(error);
    }
  }
}

export const fedexClient = new FedexClient(fedexAuthService);
