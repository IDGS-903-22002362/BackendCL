import { getFedexConfig } from "./fedex.config";
import { createHash } from "crypto";
import { fedexClient } from "./fedex-client";
import {
  mapFedexRateRequest,
  mapFedexRateResponse,
} from "./fedex-rates.mapper";
import {
  FedexRateQuoteInput,
  FedexRateQuoteResult,
  FedexRateResponse,
} from "./fedex-rates.types";

const FEDEX_RATES_PATH = "/rate/v1/rates/quotes";

export class FedexRatesUnavailableError extends Error {
  statusCode: number;

  constructor() {
    super("No FedEx rates available for this shipment");
    this.name = "FedexRatesUnavailableError";
    this.statusCode = 422;

    Error.captureStackTrace(this, this.constructor);
  }
}

type FedexClientLike = {
  post<T = unknown>(path: string, data?: unknown): Promise<T>;
};

const createQuoteId = (): string =>
  `fedex_quote_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

const createOptionId = (option: {
  serviceType: string;
  packagingType: string;
  amount: number;
  currency: string;
  estimatedDeliveryDate?: string;
  transitTime?: string;
}): string =>
  createHash("sha256")
    .update(
      [
        option.serviceType,
        option.packagingType,
        option.amount,
        option.currency,
        option.estimatedDeliveryDate || "",
        option.transitTime || "",
      ].join("|"),
    )
    .digest("hex")
    .slice(0, 24);

const logSafeRatePayload = (
  payload: ReturnType<typeof mapFedexRateRequest>,
): void => {
  const shipment = payload.requestedShipment;

  console.log("[FedEx Rate Debug]", {
    packagingType: shipment.packagingType,
    hasServiceType: Boolean(shipment.serviceType),
    serviceType: shipment.serviceType || null,
    hasOneRateSpecialService: JSON.stringify(shipment).includes("FEDEX_ONE_RATE"),
    pickupType: shipment.pickupType,
    originCountry: shipment.shipper.address.countryCode,
    originPostalCode: shipment.shipper.address.postalCode,
    recipientCountry: shipment.recipient.address.countryCode,
    recipientPostalCode: shipment.recipient.address.postalCode,
    packageCount: shipment.totalPackageCount,
    packages: shipment.requestedPackageLineItems.map((item) => ({
      groupPackageCount: item.groupPackageCount,
      weight: item.weight,
      dimensions: item.dimensions,
    })),
  });
};

export class FedexRatesService {
  constructor(private readonly client: FedexClientLike = fedexClient) {}

  async quoteRates(input: FedexRateQuoteInput): Promise<FedexRateQuoteResult> {
    const config = getFedexConfig();
    const requestPayload = mapFedexRateRequest(input);
    logSafeRatePayload(requestPayload);

    const response = await this.client.post<FedexRateResponse>(
      FEDEX_RATES_PATH,
      requestPayload,
    );
    const options = mapFedexRateResponse(response, input.currency).map((option) => ({
      ...option,
      optionId: option.optionId || createOptionId(option),
    }));

    if (options.length === 0) {
      throw new FedexRatesUnavailableError();
    }

    return {
      ok: true,
      provider: "FEDEX",
      environment: config.environment,
      quoteId: createQuoteId(),
      currency: options[0]?.currency || input.currency,
      options,
    };
  }
}

export const fedexRatesService = new FedexRatesService();
