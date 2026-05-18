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
  console.log("[FedEx Rate Payload Debug]", JSON.stringify({
    accountNumberPresent: Boolean(payload.accountNumber?.value),
    requestedShipment: {
      hasServiceType: Boolean(payload.requestedShipment?.serviceType),
      serviceType: payload.requestedShipment?.serviceType || null,
      hasCarrierCode: Boolean((payload.requestedShipment as any)?.carrierCode),
      carrierCode: (payload.requestedShipment as any)?.carrierCode || null,
      hasCarrierCodes: Boolean(payload.requestedShipment?.carrierCodes?.length),
      carrierCodes: payload.requestedShipment?.carrierCodes || [],
      packagingType: payload.requestedShipment?.packagingType,
      pickupType: payload.requestedShipment?.pickupType,
      rateRequestType: payload.requestedShipment?.rateRequestType,
      hasOneRateSpecialService: JSON.stringify(payload.requestedShipment || {}).includes("FEDEX_ONE_RATE"),
      hasShipmentSpecialServices: Boolean((payload.requestedShipment as any)?.shipmentSpecialServices),
      origin: {
        city: payload.requestedShipment?.shipper?.address?.city,
        stateOrProvinceCode: payload.requestedShipment?.shipper?.address?.stateOrProvinceCode,
        postalCode: payload.requestedShipment?.shipper?.address?.postalCode,
        countryCode: payload.requestedShipment?.shipper?.address?.countryCode,
        residential: payload.requestedShipment?.shipper?.address?.residential,
      },
      destination: {
        city: payload.requestedShipment?.recipient?.address?.city,
        stateOrProvinceCode: payload.requestedShipment?.recipient?.address?.stateOrProvinceCode,
        postalCode: payload.requestedShipment?.recipient?.address?.postalCode,
        countryCode: payload.requestedShipment?.recipient?.address?.countryCode,
        residential: payload.requestedShipment?.recipient?.address?.residential,
      },
      totalPackageCount: payload.requestedShipment?.totalPackageCount,
      packages: payload.requestedShipment?.requestedPackageLineItems?.map((p: any) => ({
        groupPackageCount: p.groupPackageCount,
        weight: p.weight,
        dimensions: p.dimensions,
        hasPackageType: Boolean(p.packageType),
        hasPackagingType: Boolean(p.packagingType),
      })),
    },
  }, null, 2));
};

export class FedexRatesService {
  constructor(private readonly client: FedexClientLike = fedexClient) {}

  async quoteRates(input: FedexRateQuoteInput): Promise<FedexRateQuoteResult> {
    const config = getFedexConfig();
    const requestPayload = mapFedexRateRequest(input);
    logSafeRatePayload(requestPayload);

    let response: FedexRateResponse;
    try {
      response = await this.client.post<FedexRateResponse>(
        FEDEX_RATES_PATH,
        requestPayload,
      );
    } catch (error: any) {
      console.error("[FedEx Rate API Error]", {
        message: error.message,
        code: (error.errors as any)?.[0]?.code || error.status,
        transactionId: error.fedexTransactionId,
        errors: error.errors,
      });
      throw error;
    }
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
