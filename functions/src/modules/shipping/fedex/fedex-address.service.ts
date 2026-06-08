import { fedexClient } from "./fedex-client";
import {
  mapFedexAddressValidationRequest,
  mapFedexAddressValidationResponse,
} from "./fedex-address.mapper";
import { normalizeMxStateForFedEx } from "./fedex-address.helper";
import {
  FedexAddressValidationInput,
  FedexAddressValidationResponse,
  FedexAddressValidationResult,
} from "./fedex-address.types";

const FEDEX_ADDRESS_VALIDATION_PATH = "/address/v1/addresses/resolve";
const FEDEX_POSTAL_VALIDATION_PATH = "/country/v1/postal/validate";

type FedexClientLike = {
  post<T = unknown>(path: string, data?: unknown): Promise<T>;
};

type FedexPostalValidationRole = "ORIGIN" | "DESTINATION";
type FedexPostalValidationMode = "WITHOUT_STATE" | "WITH_STATE_FALLBACK";

export class FedexAddressService {
  constructor(private readonly client: FedexClientLike = fedexClient) {}

  async validateAddress(
    input: FedexAddressValidationInput,
  ): Promise<FedexAddressValidationResult> {
    const payload = mapFedexAddressValidationRequest(input);
    const response = await this.client.post<FedexAddressValidationResponse>(
      FEDEX_ADDRESS_VALIDATION_PATH,
      payload,
    );

    return mapFedexAddressValidationResponse(input, response);
  }

  async validatePostalCode(input: {
    countryCode: string;
    stateOrProvinceCode?: string;
    postalCode: string;
    carrierCode?: string;
    role?: FedexPostalValidationRole;
    shipDate?: string;
  }): Promise<boolean> {
    const countryCode = input.countryCode.toUpperCase();
    const carrierCode = input.carrierCode || "FDXE";
    const role = input.role || "DESTINATION";
    const normalizedState =
      countryCode === "MX"
        ? normalizeMxStateForFedEx(input.stateOrProvinceCode)
        : input.stateOrProvinceCode;

    const postPostalValidation = async (
      mode: FedexPostalValidationMode,
      stateOrProvinceCode?: string,
    ): Promise<void> => {
      const payload = {
        carrierCode,
        countryCode,
        ...(stateOrProvinceCode ? { stateOrProvinceCode } : {}),
        postalCode: input.postalCode,
        ...(input.shipDate ? { shipDate: input.shipDate } : {}),
      };

      console.log("[FedEx Postal Validation Request]", {
        role,
        countryCode,
        postalCode: input.postalCode,
        stateOrProvinceCode: stateOrProvinceCode || null,
        carrierCode,
        mode,
      });

      await this.client.post<any>(FEDEX_POSTAL_VALIDATION_PATH, payload);
    };

    const logPostalValidationError = (
      error: any,
      mode: FedexPostalValidationMode,
    ) => {
      const response =
        error?.response || error?.originalError?.response;
      console.error("[FedEx Postal Validation Error]", {
        role,
        mode,
        status: response?.status || error?.status,
        transactionId:
          response?.data?.transactionId ||
          response?.headers?.["x-customer-transaction-id"] ||
          response?.headers?.["x-fedex-transaction-id"] ||
          error?.fedexTransactionId,
        errors: response?.data?.errors || error?.errors,
        message:
          response?.data?.errors?.[0]?.message ||
          error?.message,
      });
    };

    try {
      if (countryCode === "MX") {
        try {
          await postPostalValidation("WITHOUT_STATE");
          return true;
        } catch (error: any) {
          logPostalValidationError(error, "WITHOUT_STATE");

          if (normalizedState) {
            try {
              await postPostalValidation("WITH_STATE_FALLBACK", normalizedState);
              return true;
            } catch (fallbackError: any) {
              logPostalValidationError(fallbackError, "WITH_STATE_FALLBACK");
              return false;
            }
          }

          return false;
        }
      }

      await postPostalValidation("WITH_STATE_FALLBACK", normalizedState);
      return true;
    } catch (error: any) {
      logPostalValidationError(error, "WITH_STATE_FALLBACK");
      return false;
    }
  }
}

export const fedexAddressService = new FedexAddressService();
