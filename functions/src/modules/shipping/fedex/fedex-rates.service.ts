import { getFedexConfig } from "./fedex.config";
import { createHash } from "crypto";
import { fedexClient } from "./fedex-client";
import { FedexProviderError } from "./fedex.errors";
import { getFedexShipperConfig } from "./fedex-ship.mapper";
import {
  mapFedexRateRequest,
  mapFedexRateResponse,
} from "./fedex-rates.mapper";
import {
  FedexCarrierCode,
  FedexMoney,
  FedexPickupType,
  FedexRateQuoteDto,
  FedexRateQuoteInput,
  FedexRateQuoteRequest,
  FedexRateQuoteResult,
  FedexRateResponse,
  FedexRatedShipmentDetail,
  FedexRateReplyDetail,
  FedexRateRequestType,
  FedexRatesResponse,
  NormalizedFedexRateQuote,
  NormalizedFedexRatesResult,
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

export type FedexPublicRateErrorCode =
  | "FEDEX_RATE_INPUT_ERROR"
  | "FEDEX_RATE_BAD_REQUEST"
  | "FEDEX_AUTH_FAILED"
  | "FEDEX_FORBIDDEN"
  | "FEDEX_NOT_FOUND"
  | "FEDEX_RATE_UNPROCESSABLE"
  | "FEDEX_RATE_LIMITED"
  | "FEDEX_SERVICE_UNAVAILABLE"
  | "FEDEX_RATE_UNAVAILABLE"
  | "FEDEX_PICKUP_RATES_NOT_SUPPORTED_YET";

export class FedexPublicRateError extends Error {
  provider: "FEDEX" = "FEDEX";
  code: FedexPublicRateErrorCode;
  statusCode: number;

  constructor(code: FedexPublicRateErrorCode, message: string, statusCode = 400) {
    super(message);
    this.name = "FedexPublicRateError";
    this.code = code;
    this.statusCode = statusCode;
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

const DEFAULT_CARRIER_CODES: FedexCarrierCode[] = ["FDXE", "FDXG"];
const DEFAULT_RATE_REQUEST_TYPES: FedexRateRequestType[] = ["ACCOUNT", "LIST"];
const DEFAULT_CURRENCY = "MXN";
const MX_DECLARED_VALUE_CURRENCY = "NMP";
const DEFAULT_WEIGHT_UNITS = "KG";
const DEFAULT_DIMENSION_UNITS = "CM";
const DEFAULT_PICKUP_TYPE: FedexPickupType = "DROPOFF_AT_FEDEX_LOCATION";
const DEFAULT_PACKAGING_TYPE = "YOUR_PACKAGING";

const readOptionalEnv = (name: string): string | undefined => {
  const value = process.env[name]?.trim();
  return value || undefined;
};

const readDefaultCurrency = (): string =>
  (readOptionalEnv("FEDEX_DEFAULT_CURRENCY") || DEFAULT_CURRENCY).toUpperCase();

const readDefaultPickupType = (): FedexPickupType =>
  (readOptionalEnv("FEDEX_DEFAULT_PICKUP_TYPE") ||
    DEFAULT_PICKUP_TYPE) as FedexPickupType;

const readDefaultPackagingType = (): string =>
  readOptionalEnv("FEDEX_DEFAULT_PACKAGING_TYPE") || DEFAULT_PACKAGING_TYPE;

export const getDefaultFedexRateShipDate = (): string => {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return date.toISOString().slice(0, 10);
};

const isPlainDate = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
};

const todayIsoDate = (): string => new Date().toISOString().slice(0, 10);

const toFedexWeight = (value: number): number =>
  Math.round(value * 100) / 100;

const toFedexDimension = (value: number): number =>
  Math.max(1, Math.ceil(value));

const toFedexMoney = (value: number): number =>
  Math.round(value * 100) / 100;

const cleanText = (value?: string): string | undefined => {
  const cleaned = value?.trim().replace(/\s+/g, " ");
  return cleaned || undefined;
};

const resolveDeclaredValueCurrency = (
  preferredCurrency: string,
  originCountryCode?: string,
  destinationCountryCode?: string,
): string => {
  const origin = cleanText(originCountryCode)?.toUpperCase();
  const destination = cleanText(destinationCountryCode)?.toUpperCase();

  return origin === "MX" && destination === "MX"
    ? MX_DECLARED_VALUE_CURRENCY
    : preferredCurrency;
};

const normalizeStreetLines = (streetLines?: string[]): string[] | undefined => {
  const cleaned = (streetLines || [])
    .map((value) => cleanText(value))
    .filter((value): value is string => Boolean(value))
    .slice(0, 3);
  return cleaned.length > 0 ? cleaned : undefined;
};

const getMoneyAmount = (money: FedexMoney | undefined): number | undefined =>
  typeof money?.amount === "number" && Number.isFinite(money.amount)
    ? money.amount
    : undefined;

const getMoneyCurrency = (
  money: FedexMoney | undefined,
  fallback: string,
): string => money?.currency || fallback;

const rateTypeOf = (detail: FedexRatedShipmentDetail): string | undefined =>
  detail.shipmentRateDetail?.rateType || detail.rateType;

const getDetailNetCharge = (
  detail: FedexRatedShipmentDetail,
): FedexMoney | undefined =>
  detail.shipmentRateDetail?.totalNetCharge ||
  detail.totalNetCharge ||
  detail.shipmentRateDetail?.totalNetFedExCharge ||
  detail.totalNetFedExCharge;

const getBaseCharge = (detail: FedexRatedShipmentDetail): number | undefined =>
  getMoneyAmount(
    detail.shipmentRateDetail?.totalBaseCharge || detail.totalBaseCharge,
  );

const getSurcharges = (detail: FedexRatedShipmentDetail): number | undefined =>
  getMoneyAmount(
    detail.shipmentRateDetail?.totalSurcharges || detail.totalSurcharges,
  );

const getTaxes = (detail: FedexRatedShipmentDetail): number | undefined =>
  getMoneyAmount(detail.shipmentRateDetail?.totalTaxes || detail.totalTaxes);

const getServiceName = (detail: FedexRateReplyDetail): string | undefined => {
  const longName = detail.serviceDescription?.names?.find(
    (name) => name.type?.toUpperCase() === "LONG" && name.value,
  );
  return (
    detail.serviceName ||
    longName?.value ||
    detail.serviceDescription?.description ||
    detail.serviceDescription?.astraDescription
  );
};

const getDeliveryDayOfWeek = (
  detail: FedexRateReplyDetail,
): string | undefined =>
  detail.commit?.dateDetail?.dayOfWeek ||
  detail.commit?.dateDetail?.dayFormat;

const mapProviderError = (error: FedexProviderError): FedexPublicRateError => {
  switch (error.status) {
    case 400:
      return new FedexPublicRateError(
        "FEDEX_RATE_BAD_REQUEST",
        "No se pudo cotizar el envio con los datos enviados.",
        400,
      );
    case 401:
      return new FedexPublicRateError(
        "FEDEX_AUTH_FAILED",
        "No se pudo autenticar con FedEx.",
        401,
      );
    case 403:
      return new FedexPublicRateError(
        "FEDEX_FORBIDDEN",
        "Las credenciales de FedEx no tienen permisos para cotizar envios.",
        403,
      );
    case 404:
      return new FedexPublicRateError(
        "FEDEX_NOT_FOUND",
        "El recurso de tarifas FedEx no esta disponible.",
        404,
      );
    case 422:
      return new FedexPublicRateError(
        "FEDEX_RATE_UNPROCESSABLE",
        "FedEx no pudo procesar la cotizacion con la direccion o paquetes enviados.",
        422,
      );
    case 429:
      return new FedexPublicRateError(
        "FEDEX_RATE_LIMITED",
        "FedEx recibio demasiadas solicitudes. Intenta nuevamente mas tarde.",
        429,
      );
    case 500:
    case 503:
      return new FedexPublicRateError(
        "FEDEX_SERVICE_UNAVAILABLE",
        "FedEx no esta disponible temporalmente.",
        error.status,
      );
    default:
      return new FedexPublicRateError(
        "FEDEX_SERVICE_UNAVAILABLE",
        "FedEx no esta disponible temporalmente.",
        503,
      );
  }
};

const logSafeRatePayload = (
  payload: ReturnType<typeof mapFedexRateRequest>,
): void => {
  console.log("[FedEx Rate Payload Debug]", JSON.stringify({
    accountNumberPresent: Boolean(payload.accountNumber?.value),
    carrierCodes: payload.carrierCodes || [],
    requestedShipment: {
      hasServiceType: Boolean(payload.requestedShipment?.serviceType),
      serviceType: payload.requestedShipment?.serviceType || null,
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
      recipientContact: {
        hasPhone: Boolean(payload.requestedShipment?.recipient?.contact?.phoneNumber),
        phoneNumber: payload.requestedShipment?.recipient?.contact?.phoneNumber,
      },
      streetLines: payload.requestedShipment?.recipient?.address?.streetLines,
      totalPackageCount: payload.requestedShipment?.totalPackageCount,
      totalWeight: payload.requestedShipment?.totalWeight,
      packages: payload.requestedShipment?.requestedPackageLineItems?.map((p: any) => ({
        groupPackageCount: p.groupPackageCount,
        weight: p.weight,
        dimensions: p.dimensions,
        hasDeclaredValue: Boolean(p.declaredValue),
        declaredValue: p.declaredValue,
        hasPackageType: Boolean(p.packageType),
        hasPackagingType: Boolean(p.packagingType),
      })),
    },
    sanitizedPayload: {
      carrierCodes: payload.carrierCodes || [],
      requestedShipment: {
        shipper: payload.requestedShipment.shipper,
        recipient: payload.requestedShipment.recipient,
        pickupType: payload.requestedShipment.pickupType,
        packagingType: payload.requestedShipment.packagingType,
        rateRequestType: payload.requestedShipment.rateRequestType,
        preferredCurrency: payload.requestedShipment.preferredCurrency,
        shipDateStamp: payload.requestedShipment.shipDateStamp,
        totalPackageCount: payload.requestedShipment.totalPackageCount,
        totalWeight: payload.requestedShipment.totalWeight,
        requestedPackageLineItems:
          payload.requestedShipment.requestedPackageLineItems,
      },
    },
  }, null, 2));
};

const sanitizeFedexRateError = (error: any): Record<string, unknown> => {
  const original = error?.originalError || error;
  const response = original?.response;
  const responseBody = response?.data;
  const errors = error?.errors || responseBody?.errors;
  const firstError = Array.isArray(errors) ? errors[0] : undefined;

  return {
    status: error?.status || response?.status,
    code: responseBody?.code || firstError?.code || error?.code,
    message: error?.message || responseBody?.message || original?.message,
    fedexCode: firstError?.code,
    fedexMessage: firstError?.message || responseBody?.message || error?.message,
    transactionId:
      error?.fedexTransactionId ||
      responseBody?.transactionId ||
      response?.headers?.["x-customer-transaction-id"] ||
      response?.headers?.["x-fedex-transaction-id"],
    details: errors,
    responseBody,
  };
};

export class FedexRatesService {
  constructor(private readonly client: FedexClientLike = fedexClient) {}

  async quotePublicRates(
    dto: FedexRateQuoteDto,
  ): Promise<NormalizedFedexRatesResult> {
    const requestPayload = this.buildPublicRatePayload(dto);

    console.log("[FedEx Public Rate Request]", {
      accountNumberPresent: Boolean(requestPayload.accountNumber.value),
      recipient: {
        postalCode: requestPayload.requestedShipment.recipient.address.postalCode,
        countryCode: requestPayload.requestedShipment.recipient.address.countryCode,
        stateOrProvinceCode:
          requestPayload.requestedShipment.recipient.address.stateOrProvinceCode,
      },
      carrierCodes: requestPayload.carrierCodes,
      totalPackageCount: requestPayload.requestedShipment.totalPackageCount,
      preferredCurrency: requestPayload.requestedShipment.preferredCurrency,
    });

    try {
      const response = await this.client.post<FedexRatesResponse>(
        FEDEX_RATES_PATH,
        requestPayload,
      );

      return this.normalizePublicRateResponse(
        response,
        requestPayload.requestedShipment.preferredCurrency || readDefaultCurrency(),
      );
    } catch (error) {
      if (error instanceof FedexProviderError) {
        console.error("[FedEx Public Rate Error]", {
          status: error.status,
          transactionId: error.fedexTransactionId,
          message: error.message,
        });
        throw mapProviderError(error);
      }

      throw error;
    }
  }

  async quoteRates(input: FedexRateQuoteInput): Promise<FedexRateQuoteResult> {
    const config = getFedexConfig();
    const requestPayload = mapFedexRateRequest(input);
    logSafeRatePayload(requestPayload);

    const recipient = requestPayload.requestedShipment.recipient;
    console.log("[FedEx Address Debug]", JSON.stringify({
      destination: {
        streetLines: recipient.address.streetLines,
        city: recipient.address.city,
        stateOrProvinceCode: recipient.address.stateOrProvinceCode,
        postalCode: recipient.address.postalCode,
        countryCode: recipient.address.countryCode,
        residential: recipient.address.residential,
      },
      phoneNumber: recipient.contact?.phoneNumber,
      requestedPackageLineItems:
        requestPayload.requestedShipment.requestedPackageLineItems,
    }, null, 2));

    let response: FedexRateResponse;
    try {
      response = await this.client.post<FedexRateResponse>(
        FEDEX_RATES_PATH,
        requestPayload,
      );
    } catch (error: any) {
      console.error(
        "[FedEx Error Raw]",
        JSON.stringify(sanitizeFedexRateError(error), null, 2),
      );
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

  private buildPublicRatePayload(
    dto: FedexRateQuoteDto,
  ): FedexRateQuoteRequest {
    const config = getFedexConfig();

    if (dto.includePickupRates) {
      throw new FedexPublicRateError(
        "FEDEX_PICKUP_RATES_NOT_SUPPORTED_YET",
        "Las tarifas de recoleccion FedEx todavia no estan habilitadas.",
        400,
      );
    }

    const shipDateStamp = dto.shipDateStamp || getDefaultFedexRateShipDate();
    if (!isPlainDate(shipDateStamp) || shipDateStamp < todayIsoDate()) {
      throw new FedexPublicRateError(
        "FEDEX_RATE_INPUT_ERROR",
        "La fecha de envio debe usar formato YYYY-MM-DD y no puede ser pasada.",
        400,
      );
    }

    const recipient = this.normalizeRecipient(dto.recipient);
    const preferredCurrency =
      (dto.preferredCurrency || readDefaultCurrency()).toUpperCase();
    const rateRequestTypes = dto.rateRequestTypes?.length
      ? dto.rateRequestTypes
      : DEFAULT_RATE_REQUEST_TYPES;
    const carrierCodes = dto.carrierCodes?.length
      ? dto.carrierCodes
      : DEFAULT_CARRIER_CODES;
    const pickupType = (dto.pickupType || readDefaultPickupType()) as FedexPickupType;
    const packagingType = dto.packagingType || readDefaultPackagingType();
    const shipper = getFedexShipperConfig();
    const declaredValueCurrency = resolveDeclaredValueCurrency(
      preferredCurrency,
      shipper.countryCode,
      recipient.countryCode,
    );
    const requestedPackageLineItems = this.mapPublicPackages(
      dto.packages,
      declaredValueCurrency,
    );
    const totalPackageCount = requestedPackageLineItems.reduce(
      (sum, item) => sum + item.groupPackageCount,
      0,
    );
    const totalWeight = toFedexWeight(
      dto.packages.reduce(
        (sum, item) => sum + item.weightKg * (item.quantity || 1),
        0,
      ),
    );

    return {
      accountNumber: {
        value: config.accountNumber,
      },
      rateRequestControlParameters: {
        returnTransitTimes:
          typeof dto.returnTransitTimes === "boolean"
            ? dto.returnTransitTimes
            : true,
        servicesNeededOnRateFailure: true,
        rateSortOrder: "SERVICENAMETRADITIONAL",
      },
      requestedShipment: {
        shipper: {
          address: {
            streetLines: shipper.streetLines,
            city: shipper.city,
            stateOrProvinceCode: shipper.stateOrProvinceCode,
            postalCode: shipper.postalCode,
            countryCode: shipper.countryCode,
            residential: shipper.residential,
          },
        },
        recipient: {
          address: recipient,
        },
        ...(dto.serviceType ? { serviceType: dto.serviceType } : {}),
        preferredCurrency,
        rateRequestType: rateRequestTypes,
        shipDateStamp,
        pickupType,
        packagingType,
        totalPackageCount,
        totalWeight,
        requestedPackageLineItems,
        documentShipment: false,
      },
      carrierCodes,
    };
  }

  private normalizeRecipient(recipient: FedexRateQuoteDto["recipient"]) {
    const countryCode = cleanText(recipient.countryCode)?.toUpperCase();
    const stateOrProvinceCode = cleanText(
      recipient.stateOrProvinceCode,
    )?.toUpperCase();
    const postalCode = cleanText(recipient.postalCode);

    if (!postalCode || !countryCode || !/^[A-Z]{2}$/.test(countryCode)) {
      throw new FedexPublicRateError(
        "FEDEX_RATE_INPUT_ERROR",
        "La direccion destino requiere codigo postal y pais valido.",
        400,
      );
    }

    if (["MX", "US", "CA"].includes(countryCode) && !stateOrProvinceCode) {
      throw new FedexPublicRateError(
        "FEDEX_RATE_INPUT_ERROR",
        "El estado/provincia es requerido para cotizar envios FedEx.",
        400,
      );
    }

    return {
      ...(normalizeStreetLines(recipient.streetLines)
        ? { streetLines: normalizeStreetLines(recipient.streetLines) }
        : {}),
      ...(cleanText(recipient.city) ? { city: cleanText(recipient.city) } : {}),
      ...(stateOrProvinceCode ? { stateOrProvinceCode } : {}),
      postalCode,
      countryCode,
      ...(typeof recipient.residential === "boolean"
        ? { residential: recipient.residential }
        : {}),
    };
  }

  private mapPublicPackages(
    packages: FedexRateQuoteDto["packages"],
    currency: string,
  ) {
    if (!Array.isArray(packages) || packages.length === 0) {
      throw new FedexPublicRateError(
        "FEDEX_RATE_INPUT_ERROR",
        "Debes enviar al menos un paquete para cotizar.",
        400,
      );
    }

    if (packages.length > 20) {
      throw new FedexPublicRateError(
        "FEDEX_RATE_INPUT_ERROR",
        "FedEx permite cotizar maximo 20 paquetes en este endpoint.",
        400,
      );
    }

    return packages.map((item) => ({
      groupPackageCount: item.quantity || 1,
      weight: {
        units: (readOptionalEnv("FEDEX_WEIGHT_UNITS") || DEFAULT_WEIGHT_UNITS) as
          | "KG"
          | "LB",
        value: toFedexWeight(item.weightKg),
      },
      dimensions: {
        length: toFedexDimension(item.lengthCm),
        width: toFedexDimension(item.widthCm),
        height: toFedexDimension(item.heightCm),
        units: (readOptionalEnv("FEDEX_DIMENSION_UNITS") ||
          DEFAULT_DIMENSION_UNITS) as "CM" | "IN",
      },
      ...(typeof item.declaredValue === "number"
        ? {
            declaredValue: {
              amount: toFedexMoney(item.declaredValue),
              currency,
            },
          }
        : {}),
    }));
  }

  private normalizePublicRateResponse(
    response: FedexRatesResponse,
    fallbackCurrency: string,
  ): NormalizedFedexRatesResult {
    const rateReplyDetails = response.output?.rateReplyDetails || [];
    const alerts = response.output?.alerts || [];
    const quotes = rateReplyDetails
      .map((detail) => this.normalizePublicRateQuote(detail, fallbackCurrency))
      .filter((quote): quote is NormalizedFedexRateQuote => Boolean(quote))
      .sort((first, second) => first.amount - second.amount);

    if (quotes.length === 0) {
      throw new FedexPublicRateError(
        "FEDEX_RATE_UNAVAILABLE",
        "FedEx no devolvio tarifas disponibles para esta direccion y paquetes.",
        422,
      );
    }

    return {
      success: true,
      transactionId: response.transactionId,
      customerTransactionId: response.customerTransactionId,
      currency: quotes[0]?.currency || fallbackCurrency,
      quotes,
      alerts,
    };
  }

  private normalizePublicRateQuote(
    detail: FedexRateReplyDetail,
    fallbackCurrency: string,
  ): NormalizedFedexRateQuote | undefined {
    const ratedShipmentDetails = Array.isArray(detail.ratedShipmentDetails)
      ? detail.ratedShipmentDetails
      : [];
    const rawRateTypes = ratedShipmentDetails
      .map(rateTypeOf)
      .filter((value): value is string => Boolean(value));
    const accountDetail = ratedShipmentDetails.find(
      (item) => rateTypeOf(item)?.toUpperCase() === "ACCOUNT",
    );
    const listDetail = ratedShipmentDetails.find(
      (item) => rateTypeOf(item)?.toUpperCase() === "LIST",
    );
    const fallbackDetail = ratedShipmentDetails.find((item) =>
      getMoneyAmount(getDetailNetCharge(item)),
    );
    const selectedDetail = accountDetail || fallbackDetail;
    const selectedCharge = selectedDetail
      ? getDetailNetCharge(selectedDetail)
      : undefined;
    const amount = getMoneyAmount(selectedCharge);

    if (!selectedDetail || amount === undefined) {
      return undefined;
    }

    const serviceType =
      detail.serviceType ||
      detail.serviceDescription?.serviceType ||
      detail.serviceDescription?.code;

    if (!serviceType) {
      return undefined;
    }

    const currency = getMoneyCurrency(selectedCharge, fallbackCurrency);
    const listAmount = listDetail
      ? getMoneyAmount(getDetailNetCharge(listDetail))
      : undefined;
    const accountAmount = accountDetail
      ? getMoneyAmount(getDetailNetCharge(accountDetail))
      : undefined;

    return {
      provider: "FEDEX",
      serviceType,
      serviceName: getServiceName(detail),
      packagingType: detail.packagingType,
      currency,
      amount,
      accountAmount,
      listAmount,
      baseCharge: getBaseCharge(selectedDetail),
      surcharges: getSurcharges(selectedDetail),
      taxes: getTaxes(selectedDetail),
      transitTime: detail.transitTime,
      deliveryTimestamp: detail.deliveryTimestamp,
      deliveryDayOfWeek: getDeliveryDayOfWeek(detail),
      saturdayDelivery:
        typeof detail.commit?.saturdayDelivery === "boolean"
          ? detail.commit.saturdayDelivery
          : undefined,
      rateType: rateTypeOf(selectedDetail),
      rawRateTypes,
    };
  }
}

export const fedexRatesService = new FedexRatesService();
