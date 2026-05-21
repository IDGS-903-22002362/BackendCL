import { z } from "zod";

export type FedexProvider = "FEDEX";

export type FedexCarrierCode = "FDXE" | "FDXG" | "FXSP" | "FXCC";

export type FedexRateRequestType =
  | "ACCOUNT"
  | "LIST"
  | "PREFERRED"
  | "INCENTIVE";

export type FedexPickupType =
  | "DROPOFF_AT_FEDEX_LOCATION"
  | "CONTACT_FEDEX_TO_SCHEDULE"
  | "USE_SCHEDULED_PICKUP"
  | "ON_CALL"
  | "PACKAGE_RETURN_PROGRAM"
  | "REGULAR_STOP"
  | "TAG";

export type FedexPackagingType =
  | "YOUR_PACKAGING"
  | "FEDEX_ENVELOPE"
  | "FEDEX_BOX"
  | "FEDEX_SMALL_BOX"
  | "FEDEX_MEDIUM_BOX"
  | "FEDEX_LARGE_BOX"
  | "FEDEX_EXTRA_LARGE_BOX"
  | "FEDEX_PAK"
  | "FEDEX_TUBE"
  | string;

export type FedexServiceType = string;

export type FedexRateAddress = {
  streetLines?: string[];
  city?: string;
  stateOrProvinceCode?: string;
  postalCode: string;
  countryCode: string;
  residential?: boolean;
};

export type FedexRatePackageDto = {
  weightKg: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  declaredValue?: number;
  quantity?: number;
};

export type FedexRateQuoteDto = {
  recipient: FedexRateAddress;
  packages: FedexRatePackageDto[];
  shipDateStamp?: string;
  serviceType?: FedexServiceType;
  carrierCodes?: FedexCarrierCode[];
  returnTransitTimes?: boolean;
  rateRequestTypes?: FedexRateRequestType[];
  preferredCurrency?: string;
  pickupType?: FedexPickupType;
  packagingType?: FedexPackagingType;
  includePickupRates?: boolean;
};

export type FedexRequestedPackageLineItem = {
  groupPackageCount: number;
  weight: {
    units: "KG" | "LB";
    value: number;
  };
  dimensions: {
    length: number;
    width: number;
    height: number;
    units: "CM" | "IN";
  };
  declaredValue?: {
    amount: number;
    currency: string;
  };
};

export type FedexRateQuoteRequest = {
  accountNumber: {
    value: string;
  };
  rateRequestControlParameters?: {
    returnTransitTimes?: boolean;
    servicesNeededOnRateFailure?: boolean;
    variableOptions?: string;
    rateSortOrder?: string;
  };
  requestedShipment: {
    shipper: {
      address: FedexRateAddress;
    };
    recipient: {
      address: FedexRateAddress;
    };
    serviceType?: string;
    preferredCurrency?: string;
    rateRequestType?: FedexRateRequestType[];
    shipDateStamp: string;
    pickupType: FedexPickupType;
    packagingType: FedexPackagingType;
    totalPackageCount: number;
    totalWeight?: number;
    requestedPackageLineItems: FedexRequestedPackageLineItem[];
    documentShipment?: boolean;
  };
  processingOptions?: string[];
  carrierCodes?: FedexCarrierCode[];
};

export interface FedexRateAddressInput {
  postalCode: string;
  city?: string;
  stateOrProvinceCode?: string;
  countryCode: string;
  residential: boolean;
  streetLines?: string[];
  contact?: {
    personName?: string;
    phoneNumber?: string;
  };
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
  useConfiguredServiceType?: boolean;
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
    astraDescription?: string;
    code?: string;
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
      dayOfWeek?: string;
      dayFormat?: string;
    };
    saturdayDelivery?: boolean;
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
  ratedWeightMethod?: string;
  totalBaseCharge?: FedexMoney;
  totalNetCharge?: FedexMoney;
  totalNetFedExCharge?: FedexMoney;
  totalSurcharges?: FedexMoney;
  totalTaxes?: FedexMoney;
  shipmentRateDetail?: {
    rateType?: string;
    totalNetCharge?: FedexMoney;
    totalBaseCharge?: FedexMoney;
    totalSurcharges?: FedexMoney;
    totalTaxes?: FedexMoney;
    currency?: string;
    totalNetFedExCharge?: FedexMoney;
    totalNetChargeWithDutiesAndTaxes?: FedexMoney;
    surcharges?: Array<{
      surchargeType?: string;
      description?: string;
      amount?: FedexMoney;
    }>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface FedexRateResponse {
  transactionId?: string;
  customerTransactionId?: string;
  output?: {
    rateReplyDetails?: FedexRateReplyDetail[];
    alerts?: Array<{
      code?: string;
      message?: string;
      alertType?: string;
    }>;
    quoteDate?: string;
    encoded?: boolean;
    [key: string]: unknown;
  };
}

export type FedexRatesResponse = FedexRateResponse;

export type NormalizedFedexRateQuote = {
  provider: "FEDEX";
  serviceType: string;
  serviceName?: string;
  carrierCode?: FedexCarrierCode;
  packagingType?: string;
  currency: string;
  amount: number;
  accountAmount?: number;
  listAmount?: number;
  baseCharge?: number;
  surcharges?: number;
  taxes?: number;
  transitTime?: string;
  deliveryTimestamp?: string;
  deliveryDayOfWeek?: string;
  saturdayDelivery?: boolean;
  rateType?: string;
  rawRateTypes: string[];
};

export type NormalizedFedexRatesResult = {
  success: true;
  transactionId?: string;
  customerTransactionId?: string;
  currency: string;
  quotes: NormalizedFedexRateQuote[];
  alerts: Array<{
    code?: string;
    message?: string;
    alertType?: string;
  }>;
};

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
    useConfiguredServiceType: z.boolean().optional(),
  })
  .strict();

export type FedexRateQuoteSchemaInput = z.infer<typeof fedexRateQuoteSchema>;

const publicStreetLineSchema = z.string().trim().min(1).max(70);

const publicRecipientSchema = z
  .object({
    streetLines: z.array(publicStreetLineSchema).max(3).optional(),
    city: z.string().trim().min(1).max(50).optional(),
    stateOrProvinceCode: z
      .string()
      .trim()
      .min(1)
      .max(10)
      .optional()
      .transform((value) => value?.toUpperCase()),
    postalCode: z
      .string({
        required_error: "recipient.postalCode is required",
      })
      .trim()
      .min(1, "recipient.postalCode is required")
      .max(20),
    countryCode: z
      .string({
        required_error: "recipient.countryCode is required",
      })
      .trim()
      .transform((value) => value.toUpperCase())
      .refine((value) => /^[A-Z]{2}$/.test(value), {
        message: "recipient.countryCode must be exactly 2 letters",
      }),
    residential: z.boolean().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      ["MX", "US", "CA"].includes(value.countryCode) &&
      !value.stateOrProvinceCode
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["stateOrProvinceCode"],
        message: "recipient.stateOrProvinceCode is required for MX, US and CA",
      });
    }
  });

const publicPackageSchema = z
  .object({
    weightKg: z.number().positive("weightKg must be greater than 0"),
    lengthCm: z.number().positive("lengthCm must be greater than 0"),
    widthCm: z.number().positive("widthCm must be greater than 0"),
    heightCm: z.number().positive("heightCm must be greater than 0"),
    declaredValue: z.number().min(0).optional(),
    quantity: z.number().int().positive().optional(),
  })
  .strict();

export const fedexCarrierCodeSchema = z.enum(["FDXE", "FDXG", "FXSP", "FXCC"]);
export const fedexRateRequestTypeSchema = z.enum([
  "ACCOUNT",
  "LIST",
  "PREFERRED",
  "INCENTIVE",
]);

export const fedexPublicRateQuoteSchema = z
  .object({
    recipient: publicRecipientSchema,
    packages: z
      .array(publicPackageSchema)
      .min(1, "packages must contain at least one package")
      .max(20, "packages can contain at most 20 packages"),
    shipDateStamp: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "shipDateStamp must use YYYY-MM-DD format")
      .optional(),
    serviceType: z.string().trim().min(1).optional(),
    carrierCodes: z.array(fedexCarrierCodeSchema).min(1).optional(),
    returnTransitTimes: z.boolean().optional(),
    rateRequestTypes: z.array(fedexRateRequestTypeSchema).min(1).optional(),
    preferredCurrency: z
      .string()
      .trim()
      .min(1)
      .max(3)
      .optional()
      .transform((value) => value?.toUpperCase()),
    pickupType: z.string().trim().min(1).optional(),
    packagingType: z.string().trim().min(1).optional(),
    includePickupRates: z.boolean().optional(),
  })
  .strict();

export type FedexPublicRateQuoteSchemaInput = z.infer<
  typeof fedexPublicRateQuoteSchema
>;
