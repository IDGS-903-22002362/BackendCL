import { z } from "zod";

export type FedexProvider = "FEDEX";

export interface FedexRateAddressInput {
  postalCode: string;
  city?: string;
  stateOrProvinceCode?: string;
  countryCode: string;
  residential: boolean;
}

export interface FedexRatePackageInput {
  weightKg: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
}

export interface FedexRateQuoteInput {
  origin: FedexRateAddressInput;
  destination: FedexRateAddressInput;
  packages: FedexRatePackageInput[];
  shipDate: string;
  currency: string;
  rateRequestTypes: string[];
  serviceType?: string;
  carrierCodes?: string[];
}

export interface FedexRateSurcharge {
  type?: string;
  description?: string;
  amount: number;
  currency: string;
}

export interface FedexRateOption {
  optionId?: string;
  provider: FedexProvider;
  serviceType: string;
  serviceName: string;
  packagingType: string;
  amount: number;
  currency: string;
  estimatedDeliveryDate?: string;
  transitTime?: string;
  rateType?: string;
  surcharges: FedexRateSurcharge[];
  rawServiceDescription?: string;
}

export interface FedexRateQuoteResult {
  ok: true;
  provider: FedexProvider;
  environment: "sandbox" | "production";
  quoteId: string;
  currency: string;
  options: FedexRateOption[];
}

export interface FedexMoney {
  amount?: number;
  currency?: string;
}

export interface FedexRateReplyDetail {
  serviceType?: string;
  serviceName?: string;
  serviceDescription?: {
    description?: string;
    serviceId?: string;
    serviceType?: string;
    names?: Array<{
      type?: string;
      encoding?: string;
      value?: string;
    }>;
  };
  packagingType?: string;
  deliveryTimestamp?: string;
  transitTime?: string;
  commit?: {
    dateDetail?: {
      dayFormat?: string;
    };
  };
  commitDetails?: Array<{
    dateDetail?: {
      dayFormat?: string;
    };
  }>;
  ratedShipmentDetails?: FedexRatedShipmentDetail[];
}

export interface FedexRatedShipmentDetail {
  rateType?: string;
  shipmentRateDetail?: {
    rateType?: string;
    totalNetCharge?: FedexMoney;
    totalNetFedExCharge?: FedexMoney;
    totalNetChargeWithDutiesAndTaxes?: FedexMoney;
    surcharges?: Array<{
      surchargeType?: string;
      description?: string;
      amount?: FedexMoney;
    }>;
  };
}

export interface FedexRateResponse {
  output?: {
    rateReplyDetails?: FedexRateReplyDetail[];
  };
}

const createAddressSchema = (prefix: "origin" | "destination") =>
  z
  .object({
    postalCode: z
      .string({
        required_error: `${prefix}.postalCode is required`,
      })
      .trim()
      .min(1, `${prefix}.postalCode is required`),
    city: z.string().trim().min(1).optional(),
    stateOrProvinceCode: z.string().trim().min(1).optional(),
    countryCode: z
      .string({
        required_error: `${prefix}.countryCode is required`,
      })
      .trim()
      .min(1, `${prefix}.countryCode is required`)
      .transform((value) => value.toUpperCase()),
    residential: z.boolean().optional().default(false),
  })
  .strict();

const packageSchema = z
  .object({
    weightKg: z
      .number({
        required_error: "weightKg must be greater than 0",
        invalid_type_error: "weightKg must be greater than 0",
      })
      .positive("weightKg must be greater than 0"),
    lengthCm: z.number().positive("lengthCm must be greater than 0"),
    widthCm: z.number().positive("widthCm must be greater than 0"),
    heightCm: z.number().positive("heightCm must be greater than 0"),
  })
  .strict();

const todayIsoDate = (): string => new Date().toISOString().slice(0, 10);

export const fedexRateQuoteSchema = z
  .object({
    origin: createAddressSchema("origin"),
    destination: createAddressSchema("destination"),
    packages: z
      .array(packageSchema)
      .min(1, "packages must contain at least one package"),
    shipDate: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "shipDate must use YYYY-MM-DD format")
      .optional()
      .default(todayIsoDate),
    currency: z
      .string()
      .trim()
      .min(1)
      .optional()
      .default("MXN")
      .transform((value) => value.toUpperCase()),
    rateRequestTypes: z
      .array(z.string().trim().min(1).transform((value) => value.toUpperCase()))
      .min(1)
      .optional()
      .default(["ACCOUNT"]),
    serviceType: z
      .string()
      .trim()
      .min(1)
      .nullable()
      .optional()
      .transform((value) => value || undefined),
    carrierCodes: z
      .array(z.string().trim().min(1).transform((value) => value.toUpperCase()))
      .optional(),
  })
  .strict();

export type FedexRateQuoteSchemaInput = z.infer<typeof fedexRateQuoteSchema>;
