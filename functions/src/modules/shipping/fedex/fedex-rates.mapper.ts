import { getFedexConfig } from "./fedex.config";
import {
  FedexMoney,
  FedexRateAddressInput,
  FedexRateOption,
  FedexRatePackageInput,
  FedexRateQuoteInput,
  FedexRateReplyDetail,
  FedexRateResponse,
  FedexRateSurcharge,
  FedexRatedShipmentDetail,
} from "./fedex-rates.types";

type FedexRateRequestPayload = {
  accountNumber: {
    value: string;
  };
  requestedShipment: {
    shipper: {
      address: Record<string, unknown>;
    };
    recipient: {
      contact?: Record<string, unknown>;
      address: Record<string, unknown>;
    };
    pickupType: "USE_SCHEDULED_PICKUP";
    serviceType?: string;
    carrierCodes?: string[];
    packagingType: "YOUR_PACKAGING";
    rateRequestType: string[];
    preferredCurrency: string;
    shipDateStamp: string;
    totalPackageCount: number;
    requestedPackageLineItems: Array<{
      groupPackageCount: number;
      weight: {
        units: "KG";
        value: number;
      };
      dimensions: {
        length: number;
        width: number;
        height: number;
        units: "CM";
      };
    }>;
  };
  rateRequestControlParameters: {
    returnTransitTimes: true;
  };
};

export class FedexRateRequestConfigError extends Error {
  statusCode = 400;

  constructor(message: string) {
    super(message);
    this.name = "FedexRateRequestConfigError";
    Error.captureStackTrace(this, this.constructor);
  }
}

const roundWeight = (value: number): number => Math.round(value * 100) / 100;

const roundDimension = (value: number): number => Math.max(1, Math.ceil(value));

const BLOCKED_SERVICE_TYPES = new Set([
  "FEDEX_ONE_RATE",
  "SMART_POST",
  "FEDEX_GROUND_ECONOMY",
  "GROUND_HOME_DELIVERY",
  "FEDEX_GROUND",
]);

const readConfiguredServiceType = (): string | undefined => {
  const rawValue = process.env.FEDEX_SERVICE_TYPE?.trim();

  if (
    !rawValue ||
    rawValue.toLowerCase() === "null" ||
    rawValue.toLowerCase() === "undefined"
  ) {
    return undefined;
  }

  const serviceType = rawValue.toUpperCase();
  if (!/^[A-Z0-9_]+$/.test(serviceType)) {
    console.warn("Ignoring invalid FedEx FEDEX_SERVICE_TYPE value");
    return undefined;
  }

  if (BLOCKED_SERVICE_TYPES.has(serviceType)) {
    console.warn("Ignoring blocked FedEx FEDEX_SERVICE_TYPE value");
    return undefined;
  }

  return serviceType;
};

export function normalizeMxPhoneForFedEx(value?: string | null): string | undefined {
  if (!value) return undefined;

  let digits = value.replace(/\D/g, "");

  if (digits.length === 12 && digits.startsWith("52")) {
    digits = digits.slice(2);
  }

  if (digits.length !== 10) {
    return undefined;
  }

  return digits;
}

const cleanStreetLines = (streetLines?: string[]): string[] | undefined => {
  const cleaned = (streetLines || [])
    .map((value) => cleanFedexText(value))
    .filter((value): value is string => Boolean(value));

  return cleaned.length > 0 ? cleaned : undefined;
};

const cleanFedexText = (value?: string | null): string | undefined => {
  const cleaned = value?.trim().replace(/\s+/g, " ");
  return cleaned || undefined;
};

const mapAddress = (address: FedexRateAddressInput): Record<string, unknown> => {
  const streetLines = cleanStreetLines(address.streetLines);
  const city = cleanFedexText(address.city);
  const stateOrProvinceCode = cleanFedexText(address.stateOrProvinceCode);
  const postalCode = cleanFedexText(address.postalCode);
  const countryCode = cleanFedexText(address.countryCode)?.toUpperCase();

  return {
    ...(streetLines ? { streetLines } : {}),
    ...(postalCode ? { postalCode } : {}),
    ...(countryCode ? { countryCode } : {}),
    residential: address.residential,
    ...(city ? { city } : {}),
    ...(stateOrProvinceCode ? { stateOrProvinceCode } : {}),
  };
};

const mapContact = (address: FedexRateAddressInput): Record<string, unknown> | undefined => {
  const phoneNumber = normalizeMxPhoneForFedEx(address.contact?.phoneNumber);
  const personName = cleanFedexText(address.contact?.personName);

  if (!phoneNumber && !personName) {
    return undefined;
  }

  return {
    ...(personName ? { personName } : {}),
    ...(phoneNumber ? { phoneNumber } : {}),
  };
};

const mapPackage = (item: FedexRatePackageInput) => ({
  groupPackageCount: 1,
  weight: {
    units: "KG" as const,
    value: Math.max(0.01, roundWeight(item.weightKg)),
  },
  dimensions: {
    length: roundDimension(item.lengthCm),
    width: roundDimension(item.widthCm),
    height: roundDimension(item.heightCm),
    units: "CM" as const,
  },
});

export const mapFedexRateRequest = (
  input: FedexRateQuoteInput,
): FedexRateRequestPayload => {
  const config = getFedexConfig();
  const requestedPackageLineItems = input.packages.map(mapPackage);
  const serviceType =
    input.useConfiguredServiceType === false
      ? undefined
      : readConfiguredServiceType();
  const recipientContact = mapContact(input.destination);

  return {
    accountNumber: {
      value: config.accountNumber,
    },
    requestedShipment: {
      shipper: {
        address: mapAddress(input.origin),
      },
      recipient: {
        ...(recipientContact ? { contact: recipientContact } : {}),
        address: mapAddress(input.destination),
      },
      pickupType: "USE_SCHEDULED_PICKUP",
      ...(input.serviceType ? { serviceType: input.serviceType } : serviceType ? { serviceType } : {}),
      ...(input.carrierCodes && input.carrierCodes.length > 0 ? { carrierCodes: input.carrierCodes } : {}),
      packagingType: "YOUR_PACKAGING",
      rateRequestType: input.rateRequestTypes,
      preferredCurrency: input.currency,
      shipDateStamp: input.shipDate,
      totalPackageCount: requestedPackageLineItems.length,
      requestedPackageLineItems,
    },
    rateRequestControlParameters: {
      returnTransitTimes: true,
    },
  };
};

const isFinitePositiveNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

const getMoneyAmount = (money: FedexMoney | undefined): number | undefined => {
  if (!money || !isFinitePositiveNumber(money.amount)) {
    return undefined;
  }

  return money.amount;
};

const getMoneyCurrency = (
  money: FedexMoney | undefined,
  fallback: string,
): string => money?.currency || fallback;

const selectCharge = (
  detail: FedexRatedShipmentDetail,
): { amount?: number; currency?: string } => {
  const shipmentRateDetail = detail.shipmentRateDetail;
  const candidates = [
    shipmentRateDetail?.totalNetCharge,
    shipmentRateDetail?.totalNetFedExCharge,
    shipmentRateDetail?.totalNetChargeWithDutiesAndTaxes,
  ];

  for (const money of candidates) {
    const amount = getMoneyAmount(money);
    if (amount) {
      return {
        amount,
        currency: money?.currency,
      };
    }
  }

  return {};
};

const rateTypeOf = (detail: FedexRatedShipmentDetail): string | undefined =>
  detail.shipmentRateDetail?.rateType || detail.rateType;

const chooseRatedDetail = (
  details: FedexRatedShipmentDetail[] | undefined,
): FedexRatedShipmentDetail | undefined => {
  if (!Array.isArray(details)) {
    return undefined;
  }

  const validDetails = details.filter((detail) => selectCharge(detail).amount);
  const accountDetail = validDetails.find(
    (detail) => rateTypeOf(detail)?.toUpperCase() === "ACCOUNT",
  );
  const listDetail = validDetails.find(
    (detail) => rateTypeOf(detail)?.toUpperCase() === "LIST",
  );

  return accountDetail || listDetail || validDetails[0];
};

const getServiceDescription = (detail: FedexRateReplyDetail): string | undefined => {
  const preferredName = detail.serviceDescription?.names?.find(
    (name) => name.type?.toUpperCase() === "long".toUpperCase() && name.value,
  );

  return (
    detail.serviceName ||
    preferredName?.value ||
    detail.serviceDescription?.description
  );
};

const getDeliveryDate = (detail: FedexRateReplyDetail): string | undefined => {
  const date =
    detail.deliveryTimestamp ||
    detail.commit?.dateDetail?.dayFormat ||
    detail.commitDetails?.find((item) => item.dateDetail?.dayFormat)?.dateDetail
      ?.dayFormat;

  return date ? date.slice(0, 10) : undefined;
};

const mapSurcharges = (
  detail: FedexRatedShipmentDetail,
  fallbackCurrency: string,
): FedexRateSurcharge[] =>
  (detail.shipmentRateDetail?.surcharges || [])
    .map((surcharge): FedexRateSurcharge | undefined => {
      const amount = getMoneyAmount(surcharge.amount);
      if (!amount) {
        return undefined;
      }

      return {
        type: surcharge.surchargeType,
        description: surcharge.description,
        amount,
        currency: getMoneyCurrency(surcharge.amount, fallbackCurrency),
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));

export const mapFedexRateResponse = (
  response: FedexRateResponse,
  fallbackCurrency: string,
): FedexRateOption[] => {
  const details = response.output?.rateReplyDetails || [];

  return details
    .map((detail): FedexRateOption | undefined => {
      const ratedDetail = chooseRatedDetail(detail.ratedShipmentDetails);
      if (!ratedDetail) {
        return undefined;
      }

      const charge = selectCharge(ratedDetail);
      if (!charge.amount) {
        return undefined;
      }

      const currency = charge.currency || fallbackCurrency;
      const serviceType =
        detail.serviceType ||
        detail.serviceDescription?.serviceType ||
        detail.serviceDescription?.serviceId;

      if (!serviceType) {
        return undefined;
      }

      const rawServiceDescription = getServiceDescription(detail);

      const option: FedexRateOption = {
        provider: "FEDEX" as const,
        serviceType,
        serviceName: rawServiceDescription || serviceType,
        packagingType: detail.packagingType || "YOUR_PACKAGING",
        amount: charge.amount,
        currency,
        ...(getDeliveryDate(detail)
          ? { estimatedDeliveryDate: getDeliveryDate(detail) }
          : {}),
        ...(detail.transitTime ? { transitTime: detail.transitTime } : {}),
        ...(rateTypeOf(ratedDetail) ? { rateType: rateTypeOf(ratedDetail) } : {}),
        surcharges: mapSurcharges(ratedDetail, currency),
        ...(rawServiceDescription ? { rawServiceDescription } : {}),
      };

      return option;
    })
    .filter((item): item is FedexRateOption => Boolean(item))
    .sort((first, second) => first.amount - second.amount);
};
