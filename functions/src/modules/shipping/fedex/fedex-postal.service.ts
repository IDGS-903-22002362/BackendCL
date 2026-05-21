import { FedexProviderError } from "./fedex.errors";
import { fedexClient } from "./fedex-client";
import {
  FedexCarrierCode,
  FedexPostalAlert,
  FedexPostalLocationDescription,
  FedexPostalValidateRequest,
  FedexPostalValidateResponse,
  NormalizedPostalValidationResult,
  ValidatePostalCodeDto,
} from "./fedex-postal.types";

const FEDEX_POSTAL_VALIDATION_PATH = "/country/v1/postal/validate";
const DEFAULT_CARRIER_CODE: FedexCarrierCode = "FDXE";
const VALID_CARRIER_CODES = new Set<FedexCarrierCode>([
  "FDXE",
  "FDXG",
  "FXSP",
  "FDXC",
  "FXCC",
]);

const STATE_REQUIRED_COUNTRIES = new Set(["MX", "US", "CA"]);

type FedexClientLike = {
  post<T = unknown>(path: string, data?: unknown): Promise<T>;
};

export type FedexPostalErrorCode =
  | "FEDEX_POSTAL_VALIDATION_INPUT_ERROR"
  | "FEDEX_POSTAL_BAD_REQUEST"
  | "FEDEX_AUTH_FAILED"
  | "FEDEX_FORBIDDEN"
  | "FEDEX_POSTAL_UNPROCESSABLE"
  | "FEDEX_RATE_LIMITED"
  | "FEDEX_SERVICE_UNAVAILABLE"
  | "FEDEX_POSTAL_EMPTY_RESPONSE";

export class FedexPostalValidationError extends Error {
  provider: "FEDEX" = "FEDEX";
  code: FedexPostalErrorCode;
  statusCode: number;

  constructor(code: FedexPostalErrorCode, message: string, statusCode = 400) {
    super(message);
    this.name = "FedexPostalValidationError";
    this.code = code;
    this.statusCode = statusCode;
    Error.captureStackTrace(this, this.constructor);
  }
}

export function getDefaultFedexShipDate(): string {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return date.toISOString().slice(0, 10);
}

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

const assertValidShipDate = (shipDate: string): void => {
  if (!isPlainDate(shipDate) || shipDate < todayIsoDate()) {
    throw new FedexPostalValidationError(
      "FEDEX_POSTAL_VALIDATION_INPUT_ERROR",
      "La fecha de envio debe usar formato YYYY-MM-DD y no puede ser pasada.",
      400,
    );
  }
};

const removeEmptyFedexFields = <T extends Record<string, unknown>>(value: T): T =>
  Object.entries(value).reduce((acc, [key, fieldValue]) => {
    if (fieldValue === undefined || fieldValue === null || fieldValue === "") {
      return acc;
    }

    return {
      ...acc,
      [key]: fieldValue,
    };
  }, {} as T);

const normalizeAlerts = (alerts: unknown): FedexPostalAlert[] =>
  Array.isArray(alerts) ? (alerts as FedexPostalAlert[]) : [];

const normalizeLocationDescriptions = (
  locationDescriptions: unknown,
): FedexPostalLocationDescription[] =>
  Array.isArray(locationDescriptions)
    ? (locationDescriptions as FedexPostalLocationDescription[])
    : [];

const mapProviderError = (error: FedexProviderError): FedexPostalValidationError => {
  switch (error.status) {
    case 400:
      return new FedexPostalValidationError(
        "FEDEX_POSTAL_BAD_REQUEST",
        "No se pudo validar el codigo postal con los datos enviados.",
        400,
      );
    case 401:
      return new FedexPostalValidationError(
        "FEDEX_AUTH_FAILED",
        "No se pudo autenticar con FedEx.",
        401,
      );
    case 403:
      return new FedexPostalValidationError(
        "FEDEX_FORBIDDEN",
        "Las credenciales de FedEx no tienen permisos para esta operacion.",
        403,
      );
    case 422:
      return new FedexPostalValidationError(
        "FEDEX_POSTAL_UNPROCESSABLE",
        "El pais, estado o codigo postal no pudo ser validado por FedEx.",
        422,
      );
    case 429:
      return new FedexPostalValidationError(
        "FEDEX_RATE_LIMITED",
        "FedEx recibio demasiadas solicitudes. Intenta nuevamente mas tarde.",
        429,
      );
    case 500:
    case 503:
      return new FedexPostalValidationError(
        "FEDEX_SERVICE_UNAVAILABLE",
        "FedEx no esta disponible temporalmente.",
        error.status,
      );
    default:
      return new FedexPostalValidationError(
        "FEDEX_SERVICE_UNAVAILABLE",
        "FedEx no esta disponible temporalmente.",
        503,
      );
  }
};

export class FedexPostalCodeService {
  constructor(private readonly client: FedexClientLike = fedexClient) {}

  async validatePostalCode(
    dto: ValidatePostalCodeDto,
  ): Promise<NormalizedPostalValidationResult> {
    const payload = this.buildPayload(dto);

    console.log("[FedEx Postal Validation Request]", {
      carrierCode: payload.carrierCode,
      countryCode: payload.countryCode,
      stateOrProvinceCode: payload.stateOrProvinceCode || null,
      postalCode: payload.postalCode,
      checkForMismatch: payload.checkForMismatch,
    });

    try {
      const response = await this.client.post<FedexPostalValidateResponse>(
        FEDEX_POSTAL_VALIDATION_PATH,
        payload,
      );

      return this.normalizeResponse(payload, response);
    } catch (error) {
      if (error instanceof FedexProviderError) {
        console.error("[FedEx Postal Validation Error]", {
          status: error.status,
          code: error.fedexTransactionId ? "FEDEX_PROVIDER_ERROR" : undefined,
          transactionId: error.fedexTransactionId,
          message: error.message,
        });
        throw mapProviderError(error);
      }

      throw error;
    }
  }

  private buildPayload(dto: ValidatePostalCodeDto): FedexPostalValidateRequest {
    const carrierCode = dto.carrierCode || DEFAULT_CARRIER_CODE;
    const countryCode = dto.countryCode?.trim().toUpperCase();
    const stateOrProvinceCode = dto.stateOrProvinceCode?.trim().toUpperCase();
    const postalCode = dto.postalCode?.trim();
    const shipDate = dto.shipDate?.trim() || getDefaultFedexShipDate();

    if (!VALID_CARRIER_CODES.has(carrierCode)) {
      throw new FedexPostalValidationError(
        "FEDEX_POSTAL_VALIDATION_INPUT_ERROR",
        "El carrierCode de FedEx no es valido.",
        400,
      );
    }

    if (!countryCode || !/^[A-Z]{2}$/.test(countryCode)) {
      throw new FedexPostalValidationError(
        "FEDEX_POSTAL_VALIDATION_INPUT_ERROR",
        "El pais es requerido y debe tener 2 letras.",
        400,
      );
    }

    if (!postalCode) {
      throw new FedexPostalValidationError(
        "FEDEX_POSTAL_VALIDATION_INPUT_ERROR",
        "El codigo postal es requerido.",
        400,
      );
    }

    if (STATE_REQUIRED_COUNTRIES.has(countryCode) && !stateOrProvinceCode) {
      throw new FedexPostalValidationError(
        "FEDEX_POSTAL_VALIDATION_INPUT_ERROR",
        "El estado/provincia es requerido para validar el codigo postal.",
        400,
      );
    }

    assertValidShipDate(shipDate);

    const checkForMismatch =
      typeof dto.checkForMismatch === "boolean"
        ? dto.checkForMismatch
        : Boolean(stateOrProvinceCode);

    return removeEmptyFedexFields({
      carrierCode,
      countryCode,
      stateOrProvinceCode,
      postalCode,
      shipDate,
      routingCode: dto.routingCode?.trim(),
      checkForMismatch,
      city: dto.city?.trim(),
    });
  }

  private normalizeResponse(
    payload: FedexPostalValidateRequest,
    response: FedexPostalValidateResponse,
  ): NormalizedPostalValidationResult {
    if (!response.output) {
      throw new FedexPostalValidationError(
        "FEDEX_POSTAL_EMPTY_RESPONSE",
        "FedEx no devolvio informacion de validacion postal.",
        502,
      );
    }

    const alerts = normalizeAlerts(response.output.alerts);
    const locationDescriptions = normalizeLocationDescriptions(
      response.output.locationDescriptions,
    );

    return {
      isValid: true,
      carrierCode: payload.carrierCode,
      countryCode: response.output.countryCode || payload.countryCode,
      stateOrProvinceCode:
        response.output.stateOrProvinceCode || payload.stateOrProvinceCode,
      postalCode: payload.postalCode,
      cleanedPostalCode: response.output.cleanedPostalCode,
      cityFirstInitials: response.output.cityFirstInitials,
      alerts,
      locationDescriptions,
      transactionId: response.transactionId,
      customerTransactionId: response.customerTransactionId,
    };
  }
}

export const fedexPostalCodeService = new FedexPostalCodeService();
