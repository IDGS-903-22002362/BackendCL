import { z } from "zod";

export type FedexAddressClassification =
  | "RESIDENTIAL"
  | "BUSINESS"
  | "MIXED"
  | "UNKNOWN";

export type FedexAddressState =
  | "STANDARDIZED"
  | "NORMALIZED"
  | "RAW"
  | "UNKNOWN";

export interface FedexAddressInput {
  streetLines: string[];
  city?: string;
  stateOrProvinceCode?: string;
  postalCode?: string;
  countryCode: string;
  residential?: boolean;
}

export interface FedexAddressValidationInput {
  address: FedexAddressInput;
}

export interface FedexNormalizedAddress {
  streetLines: string[];
  city: string;
  stateOrProvinceCode: string;
  postalCode: string;
  countryCode: string;
  residential?: boolean;
}

export interface FedexAddressChange {
  field: string;
  input?: string | string[] | boolean;
  resolved?: string | string[] | boolean;
}

export interface FedexAddressValidationResult {
  ok: true;
  provider: "FEDEX";
  environment: "sandbox" | "production";
  isValid: boolean;
  classification: FedexAddressClassification;
  addressState: FedexAddressState;
  inputAddress: FedexNormalizedAddress;
  resolvedAddress: FedexNormalizedAddress;
  changes: FedexAddressChange[];
  warnings: string[];
  customerMessages: string[];
  rawScore: number | null;
}

export interface FedexAddressResolvedDetail {
  streetLines?: string[];
  city?: string;
  stateOrProvinceCode?: string;
  postalCode?: string;
  countryCode?: string;
  residential?: boolean;
}

export interface FedexAddressMessage {
  code?: string;
  message?: string;
  parameterList?: Array<{
    key?: string;
    value?: string;
  }>;
}

export interface FedexResolvedAddress {
  address?: FedexAddressResolvedDetail;
  classification?: string;
  addressState?: string;
  attributes?: Record<string, unknown>;
  customerMessages?: FedexAddressMessage[];
  annotations?: FedexAddressMessage[];
  score?: number;
}

export interface FedexAddressValidationResponse {
  output?: {
    resolvedAddresses?: FedexResolvedAddress[];
    resolvedAddress?: FedexResolvedAddress;
    customerMessages?: FedexAddressMessage[];
    alerts?: FedexAddressMessage[];
  };
}

const normalizeWhitespace = (value: string): string =>
  value.trim().replace(/\s+/g, " ");

const normalizedString = (maxLength: number, message: string) =>
  z
    .string()
    .transform(normalizeWhitespace)
    .refine((value) => value.length > 0, message)
    .refine((value) => value.length <= maxLength, message);

const streetLineSchema = normalizedString(
  70,
  "streetLine must be a non-empty string up to 70 characters",
);

const addressSchema = z
  .object({
    streetLines: z
      .array(streetLineSchema)
      .min(1, "streetLines must contain at least one line")
      .max(3, "streetLines can contain at most 3 lines"),
    city: normalizedString(50, "city must be up to 50 characters").optional(),
    stateOrProvinceCode: normalizedString(
      10,
      "stateOrProvinceCode must be up to 10 characters",
    ).optional(),
    postalCode: normalizedString(
      20,
      "postalCode must be up to 20 characters",
    ).optional(),
    countryCode: z
      .string({
        required_error: "countryCode is required",
      })
      .transform((value) => normalizeWhitespace(value).toUpperCase())
      .refine((value) => /^[A-Z]{2}$/.test(value), {
        message: "countryCode must be exactly 2 letters",
      }),
    residential: z.boolean().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.countryCode === "MX" && !value.postalCode) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["postalCode"],
        message: "postalCode is required for MX addresses",
      });
    }
  });

export const fedexAddressValidationSchema = z
  .object({
    address: addressSchema,
  })
  .strict();

export type FedexAddressValidationSchemaInput = z.infer<
  typeof fedexAddressValidationSchema
>;
