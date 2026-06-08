import { z } from "zod";

export type FedexCarrierCode = "FDXE" | "FDXG" | "FXSP" | "FDXC" | "FXCC";

export type FedexPostalValidateRequest = {
  carrierCode: FedexCarrierCode;
  countryCode: string;
  stateOrProvinceCode?: string;
  postalCode: string;
  shipDate: string;
  routingCode?: string;
  checkForMismatch?: boolean;
  city?: string;
  version?: {
    major?: string;
    minor?: string;
    patch?: string;
  };
};

export type FedexPostalAlert = {
  code?: string;
  message?: string;
  alertType?: string;
};

export type FedexPostalLocationDescription = {
  locationId?: string;
  locationNumber?: string;
  airportId?: string;
  serviceArea?: string;
  locationName?: string;
  city?: string;
  stateOrProvinceCode?: string;
  postalCode?: string;
  countryCode?: string;
  residential?: boolean;
  [key: string]: unknown;
};

export type FedexPostalValidateResponse = {
  transactionId?: string;
  customerTransactionId?: string;
  output?: {
    countryCode?: string;
    cityFirstInitials?: string;
    stateOrProvinceCode?: string;
    alerts?: FedexPostalAlert[];
    locationDescriptions?: FedexPostalLocationDescription[];
    cleanedPostalCode?: string;
    [key: string]: unknown;
  };
};

export type ValidatePostalCodeDto = {
  carrierCode?: FedexCarrierCode;
  countryCode: string;
  stateOrProvinceCode?: string;
  postalCode: string;
  shipDate?: string;
  routingCode?: string;
  checkForMismatch?: boolean;
  city?: string;
};

export type NormalizedPostalValidationResult = {
  isValid: boolean;
  carrierCode: FedexCarrierCode;
  countryCode: string;
  stateOrProvinceCode?: string;
  postalCode: string;
  cleanedPostalCode?: string;
  cityFirstInitials?: string;
  alerts: FedexPostalAlert[];
  locationDescriptions: FedexPostalLocationDescription[];
  transactionId?: string;
  customerTransactionId?: string;
};

const normalizedOptionalString = (maxLength: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(maxLength)
    .optional()
    .transform((value) => value || undefined);

export const fedexCarrierCodeSchema = z.enum([
  "FDXE",
  "FDXG",
  "FXSP",
  "FDXC",
  "FXCC",
]);

export const fedexPostalValidationSchema = z
  .object({
    carrierCode: fedexCarrierCodeSchema.optional(),
    countryCode: z
      .string({
        required_error: "countryCode is required",
      })
      .trim()
      .transform((value) => value.toUpperCase())
      .refine((value) => /^[A-Z]{2}$/.test(value), {
        message: "countryCode must be exactly 2 letters",
      }),
    stateOrProvinceCode: normalizedOptionalString(10).transform((value) =>
      value ? value.toUpperCase() : undefined,
    ),
    postalCode: z
      .string({
        required_error: "postalCode is required",
      })
      .trim()
      .min(1, "postalCode is required")
      .max(20, "postalCode must be up to 20 characters"),
    shipDate: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "shipDate must use YYYY-MM-DD format")
      .optional(),
    routingCode: normalizedOptionalString(40),
    checkForMismatch: z.boolean().optional(),
    city: normalizedOptionalString(50),
  })
  .strict();

export type FedexPostalValidationSchemaInput = z.infer<
  typeof fedexPostalValidationSchema
>;
