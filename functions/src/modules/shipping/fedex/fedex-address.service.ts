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
  }): Promise<boolean> {
    try {
      const isMX = input.countryCode.toUpperCase() === "MX";
      const payload = {
        carrierCode: input.carrierCode || "FDXE",
        countryCode: input.countryCode,
        stateOrProvinceCode: isMX ? normalizeMxStateForFedEx(input.stateOrProvinceCode) : input.stateOrProvinceCode,
        postalCode: input.postalCode,
      };

      await this.client.post<any>(
        FEDEX_POSTAL_VALIDATION_PATH,
        payload,
      );
      
      return true;
    } catch (error: any) {
      console.warn("[FedEx Postal Validation Error]", {
        status: error?.originalError?.response?.status || error?.status,
        data: error?.originalError?.response?.data,
      });
      return false;
    }
  }
}

export const fedexAddressService = new FedexAddressService();
