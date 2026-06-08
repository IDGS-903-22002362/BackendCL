import { FedexProviderError } from "./fedex.errors";
import { fedexClient } from "./fedex-client";
import { getFedexConfig } from "./fedex.config";
import { getFedexShipperConfig } from "./fedex-ship.mapper";
import {
  FedexAvailabilityPickupType,
  FedexAvailabilityRequestedPackageLineItem,
  FedexAvailableServiceOption,
  FedexServiceAvailabilityDto,
  FedexServiceAvailabilityRequest,
  FedexServiceAvailabilityResponse,
  NormalizedFedexAvailableService,
  NormalizedFedexServiceAvailabilityResult,
} from "./fedex-service-availability.types";

const FEDEX_SERVICE_AVAILABILITY_PATH = "/availability/v1/transittimes";
const DEFAULT_CURRENCY = "MXN";
const DEFAULT_WEIGHT_UNITS = "KG";
const DEFAULT_DIMENSION_UNITS = "CM";
const DEFAULT_PICKUP_TYPE: FedexAvailabilityPickupType =
  "DROPOFF_AT_FEDEX_LOCATION";
const DEFAULT_PACKAGING_TYPE = "YOUR_PACKAGING";

type FedexClientLike = {
  post<T = unknown>(path: string, data?: unknown): Promise<T>;
};

export type FedexServiceAvailabilityErrorCode =
  | "FEDEX_AVAILABILITY_INPUT_ERROR"
  | "FEDEX_AVAILABILITY_BAD_REQUEST"
  | "FEDEX_AUTH_FAILED"
  | "FEDEX_FORBIDDEN"
  | "FEDEX_NOT_FOUND"
  | "FEDEX_AVAILABILITY_UNPROCESSABLE"
  | "FEDEX_RATE_LIMITED"
  | "FEDEX_SERVICE_UNAVAILABLE"
  | "FEDEX_AVAILABILITY_NO_SERVICES"
  | "FEDEX_AVAILABILITY_COMMODITIES_REQUIRED";

export class FedexServiceAvailabilityError extends Error {
  provider: "FEDEX" = "FEDEX";
  code: FedexServiceAvailabilityErrorCode;
  statusCode: number;

  constructor(
    code: FedexServiceAvailabilityErrorCode,
    message: string,
    statusCode = 400,
  ) {
    super(message);
    this.name = "FedexServiceAvailabilityError";
    this.code = code;
    this.statusCode = statusCode;
    Error.captureStackTrace(this, this.constructor);
  }
}

const readOptionalEnv = (name: string): string | undefined => {
  const value = process.env[name]?.trim();
  return value || undefined;
};

const readDefaultCurrency = (): string =>
  (readOptionalEnv("FEDEX_DEFAULT_CURRENCY") || DEFAULT_CURRENCY).toUpperCase();

const readDefaultPickupType = (): FedexAvailabilityPickupType =>
  (readOptionalEnv("FEDEX_DEFAULT_PICKUP_TYPE") ||
    DEFAULT_PICKUP_TYPE) as FedexAvailabilityPickupType;

const readDefaultPackagingType = (): string =>
  readOptionalEnv("FEDEX_DEFAULT_PACKAGING_TYPE") || DEFAULT_PACKAGING_TYPE;

const cleanText = (value?: string): string | undefined => {
  const cleaned = value?.trim().replace(/\s+/g, " ");
  return cleaned || undefined;
};

const normalizeStreetLines = (streetLines?: string[]): string[] | undefined => {
  const cleaned = (streetLines || [])
    .map((value) => cleanText(value))
    .filter((value): value is string => Boolean(value))
    .slice(0, 3);
  return cleaned.length > 0 ? cleaned : undefined;
};

const toFedexWeight = (value: number): number => Math.round(value * 100) / 100;
const toFedexDimension = (value: number): number => Math.max(1, Math.ceil(value));
const toFedexMoney = (value: number): number => Math.round(value * 100) / 100;

const getDefaultShipDatestamp = (): string => {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return date.toISOString().slice(0, 10);
};

const todayIsoDate = (): string => new Date().toISOString().slice(0, 10);

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

const toStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];

const mapProviderError = (
  error: FedexProviderError,
): FedexServiceAvailabilityError => {
  switch (error.status) {
    case 400:
      return new FedexServiceAvailabilityError(
        "FEDEX_AVAILABILITY_BAD_REQUEST",
        "No se pudo consultar disponibilidad con los datos enviados.",
        400,
      );
    case 401:
      return new FedexServiceAvailabilityError(
        "FEDEX_AUTH_FAILED",
        "No se pudo autenticar con FedEx.",
        401,
      );
    case 403:
      return new FedexServiceAvailabilityError(
        "FEDEX_FORBIDDEN",
        "Las credenciales de FedEx no tienen permisos para consultar disponibilidad.",
        403,
      );
    case 404:
      return new FedexServiceAvailabilityError(
        "FEDEX_NOT_FOUND",
        "El recurso de disponibilidad FedEx no esta disponible.",
        404,
      );
    case 422:
      return new FedexServiceAvailabilityError(
        "FEDEX_AVAILABILITY_UNPROCESSABLE",
        "FedEx no pudo procesar la disponibilidad con la direccion o paquetes enviados.",
        422,
      );
    case 429:
      return new FedexServiceAvailabilityError(
        "FEDEX_RATE_LIMITED",
        "FedEx recibio demasiadas solicitudes. Intenta nuevamente mas tarde.",
        429,
      );
    case 500:
    case 503:
      return new FedexServiceAvailabilityError(
        "FEDEX_SERVICE_UNAVAILABLE",
        "FedEx no esta disponible temporalmente.",
        error.status,
      );
    default:
      return new FedexServiceAvailabilityError(
        "FEDEX_SERVICE_UNAVAILABLE",
        "FedEx no esta disponible temporalmente.",
        503,
      );
  }
};

export class FedexServiceAvailabilityService {
  constructor(private readonly client: FedexClientLike = fedexClient) {}

  async retrieveServicesAndTransitTimes(
    dto: FedexServiceAvailabilityDto,
  ): Promise<NormalizedFedexServiceAvailabilityResult> {
    const payload = this.buildPayload(dto);

    console.log("[FedEx Service Availability Request]", {
      shipper: {
        postalCode: payload.requestedShipment.shipper.address.postalCode,
        countryCode: payload.requestedShipment.shipper.address.countryCode,
      },
      recipient: {
        postalCode: payload.requestedShipment.recipients[0]?.address.postalCode,
        countryCode: payload.requestedShipment.recipients[0]?.address.countryCode,
        stateOrProvinceCode:
          payload.requestedShipment.recipients[0]?.address.stateOrProvinceCode,
      },
      carrierCodes: payload.carrierCodes || [],
      serviceType: payload.requestedShipment.serviceType || null,
      packages: payload.requestedShipment.requestedPackageLineItems.length,
      accountNumberPresent: Boolean(
        payload.requestedShipment.shippingChargesPayment?.payor
          ?.responsibleParty?.accountNumber?.value,
      ),
    });

    try {
      const response = await this.client.post<FedexServiceAvailabilityResponse>(
        FEDEX_SERVICE_AVAILABILITY_PATH,
        payload,
      );
      return this.normalizeResponse(response);
    } catch (error) {
      if (error instanceof FedexProviderError) {
        console.error("[FedEx Service Availability Error]", {
          status: error.status,
          transactionId: error.fedexTransactionId,
          message: error.message,
        });
        throw mapProviderError(error);
      }
      throw error;
    }
  }

  private buildPayload(dto: FedexServiceAvailabilityDto): FedexServiceAvailabilityRequest {
    const config = getFedexConfig();
    const shipper = getFedexShipperConfig();
    const currency = (dto.preferredCurrency || readDefaultCurrency()).toUpperCase();
    const shipDatestamp = dto.shipDatestamp || getDefaultShipDatestamp();

    if (!isPlainDate(shipDatestamp) || shipDatestamp < todayIsoDate()) {
      throw new FedexServiceAvailabilityError(
        "FEDEX_AVAILABILITY_INPUT_ERROR",
        "La fecha de envio debe usar formato YYYY-MM-DD y no puede ser pasada.",
        400,
      );
    }

    const recipient = this.normalizeRecipient(dto.recipient);
    const isInternational = shipper.countryCode !== recipient.countryCode;

    if (isInternational && (!dto.commodities || dto.commodities.length === 0)) {
      throw new FedexServiceAvailabilityError(
        "FEDEX_AVAILABILITY_COMMODITIES_REQUIRED",
        "Para consultar servicios internacionales se requiere informacion basica de mercancias.",
        400,
      );
    }

    return {
      ...(typeof dto.earlyPickupIndicator === "boolean"
        ? { earlyPickupIndicator: dto.earlyPickupIndicator }
        : {}),
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
        recipients: [{ address: recipient }],
        ...(dto.serviceType ? { serviceType: dto.serviceType } : {}),
        packagingType: dto.packagingType || readDefaultPackagingType(),
        shipDatestamp,
        pickupType: dto.pickupType || readDefaultPickupType(),
        shippingChargesPayment: {
          paymentType: "SENDER",
          payor: {
            responsibleParty: {
              accountNumber: {
                value: config.accountNumber,
              },
            },
          },
        },
        requestedPackageLineItems: this.mapPackages(dto, currency),
        ...(isInternational
          ? { customsClearanceDetail: { commodities: this.mapCommodities(dto, currency) } }
          : {}),
      },
      ...(dto.carrierCodes && dto.carrierCodes.length > 0
        ? { carrierCodes: dto.carrierCodes }
        : {}),
    };
  }

  private normalizeRecipient(
    recipient: FedexServiceAvailabilityDto["recipient"],
  ) {
    const countryCode = cleanText(recipient.countryCode)?.toUpperCase();
    const stateOrProvinceCode = cleanText(
      recipient.stateOrProvinceCode,
    )?.toUpperCase();
    const postalCode = cleanText(recipient.postalCode);

    if (!postalCode || !countryCode || !/^[A-Z]{2}$/.test(countryCode)) {
      throw new FedexServiceAvailabilityError(
        "FEDEX_AVAILABILITY_INPUT_ERROR",
        "La direccion destino requiere codigo postal y pais valido.",
        400,
      );
    }

    if (["MX", "US", "CA"].includes(countryCode) && !stateOrProvinceCode) {
      throw new FedexServiceAvailabilityError(
        "FEDEX_AVAILABILITY_INPUT_ERROR",
        "El estado/provincia es requerido para consultar disponibilidad FedEx.",
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

  private mapPackages(
    dto: FedexServiceAvailabilityDto,
    currency: string,
  ): FedexAvailabilityRequestedPackageLineItem[] {
    if (!Array.isArray(dto.packages) || dto.packages.length === 0) {
      throw new FedexServiceAvailabilityError(
        "FEDEX_AVAILABILITY_INPUT_ERROR",
        "Debes enviar al menos un paquete para consultar disponibilidad.",
        400,
      );
    }

    if (dto.packages.length > 20) {
      throw new FedexServiceAvailabilityError(
        "FEDEX_AVAILABILITY_INPUT_ERROR",
        "FedEx permite consultar maximo 20 paquetes en este endpoint.",
        400,
      );
    }

    const packagingType = dto.packagingType || readDefaultPackagingType();

    return dto.packages.map((item) => {
      const hasDimensions =
        typeof item.lengthCm === "number" &&
        typeof item.widthCm === "number" &&
        typeof item.heightCm === "number";

      return {
        groupPackageCount: item.quantity || 1,
        physicalPackaging: packagingType,
        weight: {
          units: (readOptionalEnv("FEDEX_WEIGHT_UNITS") || DEFAULT_WEIGHT_UNITS) as
            | "KG"
            | "LB",
          value: toFedexWeight(item.weightKg),
        },
        ...(hasDimensions
          ? {
              dimensions: {
                length: toFedexDimension(item.lengthCm as number),
                width: toFedexDimension(item.widthCm as number),
                height: toFedexDimension(item.heightCm as number),
                units: (readOptionalEnv("FEDEX_DIMENSION_UNITS") ||
                  DEFAULT_DIMENSION_UNITS) as "CM" | "IN",
              },
            }
          : {}),
        ...(typeof item.declaredValue === "number"
          ? {
              declaredValue: {
                amount: toFedexMoney(item.declaredValue),
                currency,
              },
            }
          : {}),
      };
    });
  }

  private mapCommodities(dto: FedexServiceAvailabilityDto, fallbackCurrency: string) {
    return (dto.commodities || []).map((item) => {
      const currency = (item.currency || fallbackCurrency).toUpperCase();
      const quantity = item.quantity || 1;
      const value =
        typeof item.customsValue === "number" ? toFedexMoney(item.customsValue) : 0;

      return {
        description: item.description,
        quantity,
        numberOfPieces: quantity,
        ...(typeof item.customsValue === "number"
          ? {
              customsValue: { amount: value, currency },
              unitPrice: { amount: value, currency },
            }
          : {}),
        ...(typeof item.weightKg === "number"
          ? { weight: { units: "KG" as const, value: toFedexWeight(item.weightKg) } }
          : {}),
        ...(item.countryOfManufacture
          ? { countryOfManufacture: item.countryOfManufacture }
          : {}),
      };
    });
  }

  private normalizeResponse(
    response: FedexServiceAvailabilityResponse,
  ): NormalizedFedexServiceAvailabilityResult {
    const output = response.output || {};
    const alerts = Array.isArray(output.alerts) ? output.alerts : [];
    const services = [
      ...this.normalizeServiceOptions(output.services),
      ...this.normalizeServiceOptions(output.serviceOptions),
      ...this.normalizeServiceOptions(output.availableServices),
      ...this.normalizeServiceOptions(output.transitTimes),
    ];

    if (services.length === 0) {
      throw new FedexServiceAvailabilityError(
        "FEDEX_AVAILABILITY_NO_SERVICES",
        "FedEx no devolvio servicios disponibles para esta direccion y paquetes.",
        422,
      );
    }

    return {
      success: true,
      transactionId: response.transactionId,
      customerTransactionId: response.customerTransactionId,
      services,
      alerts,
    };
  }

  private normalizeServiceOptions(
    options: unknown,
  ): NormalizedFedexAvailableService[] {
    if (!Array.isArray(options)) {
      return [];
    }

    return options
      .map((option): NormalizedFedexAvailableService | undefined => {
        const service = option as FedexAvailableServiceOption;
        if (!service.serviceType) {
          return undefined;
        }

        return {
          provider: "FEDEX",
          serviceType: service.serviceType,
          serviceName: service.serviceName,
          carrierCode: service.carrierCode,
          packagingType:
            service.packagingType || service.packagingTypes?.[0],
          transitTime: service.transitTime,
          deliveryDate:
            service.deliveryDate ||
            service.deliveryTimestamp ||
            service.commit?.dateDetail?.dayFormat,
          deliveryDayOfWeek:
            service.deliveryDayOfWeek || service.commit?.dateDetail?.dayOfWeek,
          saturdayDelivery:
            typeof service.saturdayDelivery === "boolean"
              ? service.saturdayDelivery
              : service.commit?.saturdayDelivery,
          specialServices: toStringArray(service.specialServices),
          signatureOptions: toStringArray(service.signatureOptions),
          returnShipmentTypes: toStringArray(service.returnShipmentTypes),
          rawKeys: Object.keys(service),
        };
      })
      .filter((item): item is NormalizedFedexAvailableService => Boolean(item));
  }
}

export const fedexServiceAvailabilityService =
  new FedexServiceAvailabilityService();
