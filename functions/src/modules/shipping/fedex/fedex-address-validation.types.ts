import { z } from "zod";

export type FedexAddressClassification =
  | "BUSINESS"
  | "RESIDENTIAL"
  | "MIXED"
  | "UNKNOWN";

export type FedexAddressResolutionMethod =
  | "USPS_VALIDATE"
  | "CA_VALIDATE"
  | "GENERIC_VALIDATE"
  | "NAVTEQ_GEO_VALIDATE"
  | "TELEATLAS_GEO_VALIDATE"
  | string;

export type FedexAddressAttributes = {
  POBox?: boolean;
  POBoxOnlyZIP?: boolean;
  SplitZip?: boolean;
  SuiteRequiredButMissing?: boolean | string;
  InvalidSuiteNumber?: boolean | string;
  ResolutionInput?: string;
  DPV?: boolean;
  ResolutionMethod?: string;
  DataVintage?: string;
  MatchSource?: string;
  CountrySupported?: boolean;
  ValidlyFormed?: boolean;
  Matched?: boolean;
  Resolved?: boolean;
  Inserted?: boolean;
  MultiUnitBase?: boolean;
  ZIP11Match?: boolean;
  ZIP4Match?: boolean;
  UniqueZIP?: boolean;
  StreetAddress?: boolean;
  RRConversion?: boolean;
  ValidMultiUnit?: boolean;
  AddressType?: "RAW" | "NORMALIZED" | "STANDARDIZED" | string;
  AddressPrecision?: string;
  MultipleMatches?: boolean;
  [key: string]: unknown;
};

export type FedexAddressCustomerMessage = {
  code?: string;
  message?: string;
  [key: string]: unknown;
};

export type FedexAddressAlert = {
  code?: string;
  message?: string;
  alertType?: "NOTE" | "WARNING" | string;
};

export type FedexResolutionToken = {
  changed?: boolean;
  value?: string;
};

export type FedexParsedPostalCode = {
  base?: string;
  addOn?: string;
  deliveryPoint?: string;
};

export type FedexResolvedAddress = {
  streetLinesToken?: string[];
  city?: string;
  stateOrProvinceCode?: string;
  postalCode?: string;
  countryCode?: string;
  customerMessage?: FedexAddressCustomerMessage[];
  customerMessages?: FedexAddressCustomerMessage[];
  cityToken?: FedexResolutionToken[];
  postalCodeToken?: FedexResolutionToken;
  parsedPostalCode?: FedexParsedPostalCode;
  classification?: FedexAddressClassification | string;
  postOfficeBox?: boolean;
  normalizedStatusNameDPV?: boolean;
  standardizedStatusNameMatchSource?: string;
  resolutionMethodName?: FedexAddressResolutionMethod;
  ruralRouteHighwayContract?: boolean;
  generalDelivery?: boolean;
  attributes?: FedexAddressAttributes;
  address?: {
    streetLines?: string[];
    city?: string;
    stateOrProvinceCode?: string;
    postalCode?: string;
    countryCode?: string;
  };
  [key: string]: unknown;
};

export type FedexAddressToValidate = {
  address: {
    streetLines: string[];
    city?: string;
    stateOrProvinceCode?: string;
    postalCode?: string;
    countryCode: string;
  };
  clientReferenceId?: string;
};

export type FedexValidateAddressRequest = {
  inEffectAsOfTimestamp?: string;
  validateAddressControlParameters?: {
    includeResolutionTokens?: boolean;
  };
  addressesToValidate: FedexAddressToValidate[];
};

export type FedexValidateAddressResponse = {
  transactionId?: string;
  customerTransactionId?: string;
  output?: {
    resolvedAddresses?: FedexResolvedAddress[];
    alerts?: FedexAddressAlert[];
  };
};

export type ValidateAddressDto = {
  streetLines: string[];
  city?: string;
  stateOrProvinceCode?: string;
  postalCode?: string;
  countryCode: string;
  clientReferenceId?: string;
  includeResolutionTokens?: boolean;
  inEffectAsOfTimestamp?: string;
};

export type ValidateAddressesDto = {
  addresses: ValidateAddressDto[];
  includeResolutionTokens?: boolean;
  inEffectAsOfTimestamp?: string;
};

export type NormalizedResolvedAddress = {
  inputIndex: number;
  clientReferenceId?: string;
  isResolved: boolean;
  isStandardized: boolean;
  isDeliveryPointValid?: boolean;
  isInterpolatedStreetAddress: boolean;
  isLikelyValid: boolean;
  classification: FedexAddressClassification;
  streetLines: string[];
  city?: string;
  stateOrProvinceCode?: string;
  postalCode?: string;
  countryCode?: string;
  parsedPostalCode?: FedexParsedPostalCode;
  customerMessages: FedexAddressCustomerMessage[];
  alerts: FedexAddressAlert[];
  attributes: FedexAddressAttributes;
  postOfficeBox?: boolean;
  resolutionMethodName?: FedexAddressResolutionMethod;
};

export type NormalizedAddressValidationResult = {
  success: true;
  transactionId?: string;
  customerTransactionId?: string;
  addresses: NormalizedResolvedAddress[];
  alerts: FedexAddressAlert[];
};

const normalizeWhitespace = (value: string): string =>
  value.trim().replace(/\s+/g, " ");

const optionalNormalizedString = (maxLength: number) =>
  z
    .string()
    .transform(normalizeWhitespace)
    .refine((value) => value.length > 0, "Field must not be empty")
    .refine((value) => value.length <= maxLength, "Field is too long")
    .optional()
    .transform((value) => value || undefined);

const streetLineSchema = z
  .string()
  .transform(normalizeWhitespace)
  .refine((value) => value.length > 0, "streetLine must be non-empty")
  .refine((value) => value.length <= 70, "streetLine must be up to 70 characters");

export const fedexAddressValidationPublicSchema = z
  .object({
    streetLines: z
      .array(streetLineSchema)
      .min(1, "streetLines must contain at least one line")
      .max(3, "streetLines can contain at most 3 lines"),
    city: optionalNormalizedString(50),
    stateOrProvinceCode: optionalNormalizedString(10).transform((value) =>
      value ? value.toUpperCase() : undefined,
    ),
    postalCode: optionalNormalizedString(20),
    countryCode: z
      .string({
        required_error: "countryCode is required",
      })
      .transform((value) => normalizeWhitespace(value).toUpperCase())
      .refine((value) => /^[A-Z]{2}$/.test(value), {
        message: "countryCode must be exactly 2 letters",
      }),
    clientReferenceId: optionalNormalizedString(80),
    includeResolutionTokens: z.boolean().optional(),
    inEffectAsOfTimestamp: z
      .string()
      .trim()
      .regex(
        /^\d{4}-\d{2}-\d{2}$/,
        "inEffectAsOfTimestamp must use YYYY-MM-DD format",
      )
      .optional(),
  })
  .strict();

export type FedexAddressValidationPublicSchemaInput = z.infer<
  typeof fedexAddressValidationPublicSchema
>;
