import { fedexClient } from "./fedex-client";
import {
  mapFedexAddressValidationRequest,
  mapFedexAddressValidationResponse,
} from "./fedex-address.mapper";
import {
  FedexAddressValidationInput,
  FedexAddressValidationResponse,
  FedexAddressValidationResult,
} from "./fedex-address.types";

const FEDEX_ADDRESS_VALIDATION_PATH = "/address/v1/addresses/resolve";

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
}

export const fedexAddressService = new FedexAddressService();
