import { z } from "zod";

export type FedexAvailabilityCarrierCode = "FDXE" | "FDXG" | "FXSP";

export type FedexAvailabilityPickupType =
  | "CONTACT_FEDEX_TO_SCHEDULE"
  | "DROPOFF_AT_FEDEX_LOCATION"
  | "USE_SCHEDULED_PICKUP";

export type FedexAvailabilityPackagingType =
  | "YOUR_PACKAGING"
  | "FEDEX_ENVELOPE"
  | "FEDEX_BOX"
  | "FEDEX_SMALL_BOX"
  | "FEDEX_MEDIUM_BOX"
  | "FEDEX_LARGE_BOX"
  | "FEDEX_EXTRA_LARGE_BOX"
  | "FEDEX_PAK"
  | "FEDEX_TUBE"
  | "FEDEX_10KG_BOX"
  | "FEDEX_25KG_BOX"
  | string;

export type FedexAvailabilityServiceType = string;

export type FedexAvailabilityAddress = {
  streetLines?: string[];
  city?: string;
  stateOrProvinceCode?: string;
  postalCode: string;
  countryCode: string;
  residential?: boolean;
};

export type FedexAvailabilityPackageDto = {
  weightKg: number;
  lengthCm?: number;
  widthCm?: number;
  heightCm?: number;
  declaredValue?: number;
  quantity?: number;
};

export type FedexAvailabilityCommodityDto = {
  description: string;
  quantity?: number;
  customsValue?: number;
  currency?: string;
  countryOfManufacture?: string;
  weightKg?: number;
};

export type FedexServiceAvailabilityDto = {
  recipient: FedexAvailabilityAddress;
  packages: FedexAvailabilityPackageDto[];
  shipDatestamp?: string;
  serviceType?: FedexAvailabilityServiceType;
  carrierCodes?: FedexAvailabilityCarrierCode[];
  packagingType?: FedexAvailabilityPackagingType;
  pickupType?: FedexAvailabilityPickupType;
  preferredCurrency?: string;
  earlyPickupIndicator?: boolean;
  includeCommodities?: boolean;
  commodities?: FedexAvailabilityCommodityDto[];
};

export type FedexAvailabilityRequestedPackageLineItem = {
  groupPackageCount?: number;
  physicalPackaging?: string;
  declaredValue?: {
    amount: number;
    currency: string;
  };
  insuredValue?: {
    amount: number;
    currency: string;
  };
  weight: {
    units: "KG" | "LB";
    value: number;
  };
  dimensions?: {
    length: number;
    width: number;
    height: number;
    units: "CM" | "IN";
  };
};

export type FedexServiceAvailabilityRequest = {
  earlyPickupIndicator?: boolean;
  requestedShipment: {
    shipper: {
      address: FedexAvailabilityAddress;
    };
    recipients: Array<{
      address: FedexAvailabilityAddress;
    }>;
    serviceType?: string;
    packagingType: FedexAvailabilityPackagingType;
    shipDatestamp: string;
    pickupType?: FedexAvailabilityPickupType;
    shippingChargesPayment?: {
      paymentType: "SENDER" | "RECIPIENT" | "THIRD_PARTY" | "COLLECT";
      payor?: {
        responsibleParty?: {
          accountNumber?: {
            value: string;
          };
          address?: FedexAvailabilityAddress;
        };
      };
    };
    requestedPackageLineItems: FedexAvailabilityRequestedPackageLineItem[];
    customsClearanceDetail?: {
      commodities: Array<{
        description: string;
        quantity?: number;
        numberOfPieces?: number;
        customsValue?: {
          amount: number;
          currency: string;
        };
        unitPrice?: {
          amount: number;
          currency: string;
        };
        weight?: {
          units: "KG" | "LB";
          value: number;
        };
        countryOfManufacture?: string;
        quantityUnits?: string;
        name?: string;
        harmonizedCode?: string;
        partNumber?: string;
      }>;
    };
  };
  carrierCodes?: FedexAvailabilityCarrierCode[];
  version?: {
    major?: string;
    minor?: string;
    patch?: string;
  };
};

export type FedexAvailabilityAlert = {
  code?: string;
  message?: string;
  alertType?: string;
};

export type FedexAvailableServiceOption = {
  serviceType?: string;
  serviceName?: string;
  serviceCategory?: string;
  packagingType?: string;
  packagingTypes?: string[];
  transitTime?: string;
  deliveryDate?: string;
  deliveryTimestamp?: string;
  deliveryDayOfWeek?: string;
  saturdayDelivery?: boolean;
  commit?: {
    dateDetail?: {
      dayOfWeek?: string;
      dayFormat?: string;
    };
    saturdayDelivery?: boolean;
    [key: string]: unknown;
  };
  specialServices?: string[];
  signatureOptions?: string[];
  returnShipmentTypes?: string[];
  carrierCode?: FedexAvailabilityCarrierCode | string;
  [key: string]: unknown;
};

export type FedexServiceAvailabilityResponse = {
  transactionId?: string;
  customerTransactionId?: string;
  output?: {
    services?: FedexAvailableServiceOption[];
    serviceOptions?: FedexAvailableServiceOption[];
    availableServices?: FedexAvailableServiceOption[];
    transitTimes?: FedexAvailableServiceOption[];
    alerts?: FedexAvailabilityAlert[];
    [key: string]: unknown;
  };
};

export type NormalizedFedexAvailableService = {
  provider: "FEDEX";
  serviceType: string;
  serviceName?: string;
  carrierCode?: string;
  packagingType?: string;
  transitTime?: string;
  deliveryDate?: string;
  deliveryDayOfWeek?: string;
  saturdayDelivery?: boolean;
  specialServices: string[];
  signatureOptions: string[];
  returnShipmentTypes: string[];
  rawKeys: string[];
};

export type NormalizedFedexServiceAvailabilityResult = {
  success: true;
  transactionId?: string;
  customerTransactionId?: string;
  services: NormalizedFedexAvailableService[];
  alerts: FedexAvailabilityAlert[];
};

const normalizedOptionalString = (maxLength: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(maxLength)
    .optional()
    .transform((value) => value || undefined);

const addressSchema = z
  .object({
    streetLines: z.array(z.string().trim().min(1).max(70)).max(3).optional(),
    city: normalizedOptionalString(50),
    stateOrProvinceCode: normalizedOptionalString(10).transform((value) =>
      value ? value.toUpperCase() : undefined,
    ),
    postalCode: z
      .string({ required_error: "recipient.postalCode is required" })
      .trim()
      .min(1, "recipient.postalCode is required")
      .max(20),
    countryCode: z
      .string({ required_error: "recipient.countryCode is required" })
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

const packageSchema = z
  .object({
    weightKg: z.number().positive("weightKg must be greater than 0"),
    lengthCm: z.number().positive("lengthCm must be greater than 0").optional(),
    widthCm: z.number().positive("widthCm must be greater than 0").optional(),
    heightCm: z.number().positive("heightCm must be greater than 0").optional(),
    declaredValue: z.number().min(0).optional(),
    quantity: z.number().int().positive().optional(),
  })
  .strict();

const commoditySchema = z
  .object({
    description: z.string().trim().min(1).max(120),
    quantity: z.number().int().positive().optional(),
    customsValue: z.number().min(0).optional(),
    currency: z.string().trim().min(1).max(3).optional().transform((value) => value?.toUpperCase()),
    countryOfManufacture: z
      .string()
      .trim()
      .length(2)
      .optional()
      .transform((value) => value?.toUpperCase()),
    weightKg: z.number().positive().optional(),
  })
  .strict();

export const fedexServiceAvailabilitySchema = z
  .object({
    recipient: addressSchema,
    packages: z
      .array(packageSchema)
      .min(1, "packages must contain at least one package")
      .max(20, "packages can contain at most 20 packages"),
    shipDatestamp: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "shipDatestamp must use YYYY-MM-DD format")
      .optional(),
    serviceType: normalizedOptionalString(80),
    carrierCodes: z.array(z.enum(["FDXE", "FDXG", "FXSP"])).min(1).optional(),
    packagingType: normalizedOptionalString(40),
    pickupType: z
      .enum([
        "CONTACT_FEDEX_TO_SCHEDULE",
        "DROPOFF_AT_FEDEX_LOCATION",
        "USE_SCHEDULED_PICKUP",
      ])
      .optional(),
    preferredCurrency: z
      .string()
      .trim()
      .min(1)
      .max(3)
      .optional()
      .transform((value) => value?.toUpperCase()),
    earlyPickupIndicator: z.boolean().optional(),
    includeCommodities: z.boolean().optional(),
    commodities: z.array(commoditySchema).optional(),
  })
  .strict();

export type FedexServiceAvailabilitySchemaInput = z.infer<
  typeof fedexServiceAvailabilitySchema
>;
