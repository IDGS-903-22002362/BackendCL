import { FedexProviderError } from "./fedex.errors";
import { fedexClient } from "./fedex-client";
import {
  FedexAddressAlert,
  FedexAddressAttributes,
  FedexAddressClassification,
  FedexAddressCustomerMessage,
  FedexResolvedAddress,
  FedexValidateAddressRequest,
  FedexValidateAddressResponse,
  NormalizedAddressValidationResult,
  NormalizedResolvedAddress,
  ValidateAddressDto,
  ValidateAddressesDto,
} from "./fedex-address-validation.types";

const FEDEX_ADDRESS_VALIDATION_PATH = "/address/v1/addresses/resolve";
const MAX_BATCH_ADDRESSES = 100;

type FedexClientLike = {
  post<T = unknown>(path: string, data?: unknown): Promise<T>;
};

export type FedexAddressValidationErrorCode =
  | "FEDEX_ADDRESS_INPUT_ERROR"
  | "FEDEX_ADDRESS_TOO_MANY_ADDRESSES"
  | "FEDEX_ADDRESS_STREET_REQUIRED"
  | "FEDEX_ADDRESS_COUNTRY_REQUIRED"
  | "FEDEX_ADDRESS_LOCATION_REQUIRED"
  | "FEDEX_ADDRESS_INVALID_DATE"
  | "FEDEX_ADDRESS_EMPTY_RESPONSE"
  | "FEDEX_ADDRESS_BAD_REQUEST"
  | "FEDEX_AUTH_FAILED"
  | "FEDEX_FORBIDDEN"
  | "FEDEX_NOT_FOUND"
  | "FEDEX_ADDRESS_UNPROCESSABLE"
  | "FEDEX_RATE_LIMITED"
  | "FEDEX_SERVICE_UNAVAILABLE";

export class FedexAddressValidationError extends Error {
  provider: "FEDEX" = "FEDEX";
  code: FedexAddressValidationErrorCode;
  statusCode: number;

  constructor(
    code: FedexAddressValidationErrorCode,
    message: string,
    statusCode = 400,
  ) {
    super(message);
    this.name = "FedexAddressValidationError";
    this.code = code;
    this.statusCode = statusCode;
    Error.captureStackTrace(this, this.constructor);
  }
}

const normalizeText = (value?: string): string | undefined => {
  const cleaned = value?.trim().replace(/\s+/g, " ");
  return cleaned || undefined;
};

const normalizeStreetLines = (streetLines: string[]): string[] =>
  streetLines
    .map((line) => normalizeText(String(line ?? "")))
    .filter((line): line is string => Boolean(line))
    .slice(0, 3);

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

const toBoolean = (value: unknown): boolean | undefined => {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "y", "yes", "1"].includes(normalized)) {
      return true;
    }
    if (["false", "n", "no", "0"].includes(normalized)) {
      return false;
    }
  }

  return undefined;
};

const normalizeClassification = (
  value: unknown,
): FedexAddressClassification => {
  const normalized = typeof value === "string" ? value.toUpperCase() : "";

  if (
    normalized === "BUSINESS" ||
    normalized === "RESIDENTIAL" ||
    normalized === "MIXED"
  ) {
    return normalized;
  }

  return "UNKNOWN";
};

const collectCustomerMessages = (
  address: FedexResolvedAddress,
): FedexAddressCustomerMessage[] => {
  const customerMessage = Array.isArray(address.customerMessage)
    ? address.customerMessage
    : [];
  const customerMessages = Array.isArray(address.customerMessages)
    ? address.customerMessages
    : [];

  return [...customerMessage, ...customerMessages];
};

const hasInterpolatedStreetAddress = (
  messages: FedexAddressCustomerMessage[],
): boolean =>
  messages.some((message) => message.code === "INTERPOLATED.STREET.ADDRESS");

export function buildAddressValidityFlags(address: FedexResolvedAddress): {
  isResolved: boolean;
  isStandardized: boolean;
  isDeliveryPointValid?: boolean;
  isInterpolatedStreetAddress: boolean;
  isLikelyValid: boolean;
} {
  const attributes = address.attributes || {};
  const isResolved = toBoolean(attributes.Resolved) === true;
  const isStandardized =
    typeof attributes.AddressType === "string" &&
    attributes.AddressType.toUpperCase() === "STANDARDIZED";
  const isDeliveryPointValid =
    toBoolean(attributes.DPV) ?? toBoolean(address.normalizedStatusNameDPV);
  const isInterpolatedStreetAddress = hasInterpolatedStreetAddress(
    collectCustomerMessages(address),
  );
  const isLikelyValid =
    isResolved &&
    isStandardized &&
    !isInterpolatedStreetAddress &&
    (typeof isDeliveryPointValid === "boolean" ? isDeliveryPointValid : true);

  return {
    isResolved,
    isStandardized,
    isDeliveryPointValid,
    isInterpolatedStreetAddress,
    isLikelyValid,
  };
}

const mapProviderError = (
  error: FedexProviderError,
): FedexAddressValidationError => {
  switch (error.status) {
    case 400:
      return new FedexAddressValidationError(
        "FEDEX_ADDRESS_BAD_REQUEST",
        "No se pudo validar la direccion con los datos enviados.",
        400,
      );
    case 401:
      return new FedexAddressValidationError(
        "FEDEX_AUTH_FAILED",
        "No se pudo autenticar con FedEx.",
        401,
      );
    case 403:
      return new FedexAddressValidationError(
        "FEDEX_FORBIDDEN",
        "Las credenciales de FedEx no tienen permisos para esta operacion.",
        403,
      );
    case 404:
      return new FedexAddressValidationError(
        "FEDEX_NOT_FOUND",
        "El recurso de validacion de direcciones de FedEx no esta disponible.",
        404,
      );
    case 422:
      return new FedexAddressValidationError(
        "FEDEX_ADDRESS_UNPROCESSABLE",
        "La direccion no pudo ser procesada por FedEx.",
        422,
      );
    case 429:
      return new FedexAddressValidationError(
        "FEDEX_RATE_LIMITED",
        "FedEx recibio demasiadas solicitudes. Intenta nuevamente mas tarde.",
        429,
      );
    case 500:
    case 503:
      return new FedexAddressValidationError(
        "FEDEX_SERVICE_UNAVAILABLE",
        "FedEx no esta disponible temporalmente.",
        error.status,
      );
    default:
      return new FedexAddressValidationError(
        "FEDEX_SERVICE_UNAVAILABLE",
        "FedEx no esta disponible temporalmente.",
        503,
      );
  }
};

export class FedexAddressValidationService {
  constructor(private readonly client: FedexClientLike = fedexClient) {}

  validateAddress(
    dto: ValidateAddressDto,
  ): Promise<NormalizedAddressValidationResult> {
    return this.validateAddresses({
      addresses: [dto],
      includeResolutionTokens: dto.includeResolutionTokens,
      inEffectAsOfTimestamp: dto.inEffectAsOfTimestamp,
    });
  }

  async validateAddresses(
    dto: ValidateAddressesDto,
  ): Promise<NormalizedAddressValidationResult> {
    const payload = this.buildPayload(dto);

    console.log("[FedEx Address Validation Request]", {
      addressesCount: payload.addressesToValidate.length,
      countryCodes: payload.addressesToValidate.map(
        (item) => item.address.countryCode,
      ),
      includeResolutionTokens:
        payload.validateAddressControlParameters?.includeResolutionTokens,
    });

    try {
      const response = await this.client.post<FedexValidateAddressResponse>(
        FEDEX_ADDRESS_VALIDATION_PATH,
        payload,
      );

      return this.normalizeResponse(dto, response);
    } catch (error) {
      if (error instanceof FedexProviderError) {
        console.error("[FedEx Address Validation Error]", {
          status: error.status,
          transactionId: error.fedexTransactionId,
          message: error.message,
        });
        throw mapProviderError(error);
      }

      throw error;
    }
  }

  private buildPayload(dto: ValidateAddressesDto): FedexValidateAddressRequest {
    if (!Array.isArray(dto.addresses) || dto.addresses.length === 0) {
      throw new FedexAddressValidationError(
        "FEDEX_ADDRESS_INPUT_ERROR",
        "La direccion enviada no tiene datos suficientes para validarse.",
        400,
      );
    }

    if (dto.addresses.length > MAX_BATCH_ADDRESSES) {
      throw new FedexAddressValidationError(
        "FEDEX_ADDRESS_TOO_MANY_ADDRESSES",
        "FedEx permite validar maximo 100 direcciones por solicitud.",
        400,
      );
    }

    if (
      dto.inEffectAsOfTimestamp &&
      !isPlainDate(dto.inEffectAsOfTimestamp)
    ) {
      throw new FedexAddressValidationError(
        "FEDEX_ADDRESS_INVALID_DATE",
        "La fecha de validacion debe usar formato YYYY-MM-DD.",
        400,
      );
    }

    const addressesToValidate = dto.addresses.map((address) =>
      this.normalizeAddressToValidate(address),
    );

    return {
      ...(dto.inEffectAsOfTimestamp
        ? { inEffectAsOfTimestamp: dto.inEffectAsOfTimestamp }
        : {}),
      validateAddressControlParameters: {
        includeResolutionTokens:
          typeof dto.includeResolutionTokens === "boolean"
            ? dto.includeResolutionTokens
            : true,
      },
      addressesToValidate,
    };
  }

  private normalizeAddressToValidate(
    dto: ValidateAddressDto,
  ): FedexValidateAddressRequest["addressesToValidate"][number] {
    const streetLines = normalizeStreetLines(dto.streetLines || []);
    const countryCode = normalizeText(dto.countryCode)?.toUpperCase();
    const stateOrProvinceCode = normalizeText(
      dto.stateOrProvinceCode,
    )?.toUpperCase();
    const postalCode = normalizeText(dto.postalCode);
    const city = normalizeText(dto.city);
    const clientReferenceId = normalizeText(dto.clientReferenceId);

    if (streetLines.length === 0) {
      throw new FedexAddressValidationError(
        "FEDEX_ADDRESS_STREET_REQUIRED",
        "Debes ingresar al menos una linea de direccion.",
        400,
      );
    }

    if (!countryCode || !/^[A-Z]{2}$/.test(countryCode)) {
      throw new FedexAddressValidationError(
        "FEDEX_ADDRESS_COUNTRY_REQUIRED",
        "El pais es requerido y debe tener 2 letras.",
        400,
      );
    }

    if (!postalCode && (!city || !stateOrProvinceCode)) {
      throw new FedexAddressValidationError(
        "FEDEX_ADDRESS_LOCATION_REQUIRED",
        "La direccion enviada no tiene datos suficientes para validarse.",
        400,
      );
    }

    return {
      address: {
        streetLines,
        ...(city ? { city } : {}),
        ...(stateOrProvinceCode ? { stateOrProvinceCode } : {}),
        ...(postalCode ? { postalCode } : {}),
        countryCode,
      },
      ...(clientReferenceId ? { clientReferenceId } : {}),
    };
  }

  private normalizeResponse(
    dto: ValidateAddressesDto,
    response: FedexValidateAddressResponse,
  ): NormalizedAddressValidationResult {
    const output = response.output;
    const resolvedAddresses = output?.resolvedAddresses;

    if (!Array.isArray(resolvedAddresses)) {
      throw new FedexAddressValidationError(
        "FEDEX_ADDRESS_EMPTY_RESPONSE",
        "FedEx no devolvio direcciones resueltas.",
        502,
      );
    }

    const outputAlerts = output?.alerts;
    const responseAlerts = Array.isArray(outputAlerts)
      ? outputAlerts
      : [];

    return {
      success: true,
      transactionId: response.transactionId,
      customerTransactionId: response.customerTransactionId,
      addresses: resolvedAddresses.map((address, index) =>
        this.normalizeResolvedAddress(address, index, dto, responseAlerts),
      ),
      alerts: responseAlerts,
    };
  }

  private normalizeResolvedAddress(
    address: FedexResolvedAddress,
    index: number,
    dto: ValidateAddressesDto,
    responseAlerts: FedexAddressAlert[],
  ): NormalizedResolvedAddress {
    const input = dto.addresses[index];
    const attributes: FedexAddressAttributes = address.attributes || {};
    const customerMessages = collectCustomerMessages(address);
    const flags = buildAddressValidityFlags(address);
    const nestedAddress = address.address || {};

    return {
      inputIndex: index,
      ...(input?.clientReferenceId
        ? { clientReferenceId: normalizeText(input.clientReferenceId) }
        : {}),
      ...flags,
      classification: normalizeClassification(address.classification),
      streetLines:
        address.streetLinesToken ||
        nestedAddress.streetLines ||
        normalizeStreetLines(input?.streetLines || []),
      city: address.city || nestedAddress.city || normalizeText(input?.city),
      stateOrProvinceCode:
        address.stateOrProvinceCode ||
        nestedAddress.stateOrProvinceCode ||
        normalizeText(input?.stateOrProvinceCode)?.toUpperCase(),
      postalCode:
        address.postalCode || nestedAddress.postalCode || normalizeText(input?.postalCode),
      countryCode:
        address.countryCode ||
        nestedAddress.countryCode ||
        normalizeText(input?.countryCode)?.toUpperCase(),
      parsedPostalCode: address.parsedPostalCode,
      customerMessages,
      alerts: responseAlerts,
      attributes,
      postOfficeBox: address.postOfficeBox,
      resolutionMethodName: address.resolutionMethodName,
    };
  }
}

export const fedexAddressValidationService =
  new FedexAddressValidationService();
