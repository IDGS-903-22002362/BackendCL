import { getFedexConfig } from "./fedex.config";
import {
  cleanFedexText,
  getFedexShipperConfig,
} from "./fedex-ship.mapper";
import {
  FedexPickupAlert,
  FedexPickupAvailabilityRequestInput,
  FedexPickupAvailabilityResult,
  FedexPickupCancelRequestInput,
  FedexPickupCreateRequestInput,
  FedexPickupProviderResponse,
} from "./fedex-pickup.types";

const toRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const getString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const pickString = (
  record: Record<string, unknown> | undefined,
  keys: readonly string[],
): string | undefined => {
  if (!record) {
    return undefined;
  }

  for (const key of keys) {
    const value = getString(record[key]);
    if (value) {
      return value;
    }
  }

  return undefined;
};

const collectNestedRecords = (value: unknown): Record<string, unknown>[] => {
  const records: Record<string, unknown>[] = [];

  if (Array.isArray(value)) {
    for (const item of value) {
      records.push(...collectNestedRecords(item));
    }
    return records;
  }

  const record = toRecord(value);
  if (!record) {
    return records;
  }

  records.push(record);
  for (const item of Object.values(record)) {
    if (item && typeof item === "object") {
      records.push(...collectNestedRecords(item));
    }
  }

  return records;
};

const firstNestedString = (
  root: Record<string, unknown> | undefined,
  keys: readonly string[],
): string | undefined =>
  collectNestedRecords(root)
    .map((record) => pickString(record, keys))
    .find((value): value is string => Boolean(value));

const alertToMessage = (alert: FedexPickupAlert): string | undefined =>
  alert.message || alert.code;

const collectWarnings = (response: FedexPickupProviderResponse): string[] => {
  const output = toRecord(response.output);
  const alertSources = [
    response.alerts,
    response.errors,
    output?.alerts,
    output?.warnings,
  ];

  return alertSources
    .flatMap((source) => (Array.isArray(source) ? source : []))
    .map((item) => alertToMessage(item as FedexPickupAlert))
    .filter((item): item is string => Boolean(item));
};

const mapContact = (contact: FedexPickupCreateRequestInput["contact"]) => ({
  personName: cleanFedexText(contact.name),
  phoneNumber: cleanFedexText(contact.phone).replace(/\D/g, ""),
  ...(contact.email ? { emailAddress: cleanFedexText(contact.email) } : {}),
});

const mapAddress = (address: FedexPickupCreateRequestInput["address"]) => ({
  streetLines: address.streetLines.map(cleanFedexText),
  city: cleanFedexText(address.city),
  stateOrProvinceCode: cleanFedexText(address.stateOrProvinceCode),
  postalCode: cleanFedexText(address.postalCode),
  countryCode: cleanFedexText(address.countryCode).toUpperCase(),
  ...(typeof address.residential === "boolean"
    ? { residential: address.residential }
    : {}),
});

export const mapFedexPickupAvailabilityRequest = (
  input: FedexPickupAvailabilityRequestInput,
) => {
  const config = getFedexConfig();

  return {
    associatedAccountNumber: {
      value: config.accountNumber,
    },
    accountNumber: {
      value: config.accountNumber,
    },
    pickupAddress: {
      city: cleanFedexText(input.city),
      stateOrProvinceCode: cleanFedexText(input.stateOrProvinceCode),
      postalCode: cleanFedexText(input.postalCode),
      countryCode: cleanFedexText(input.countryCode).toUpperCase(),
    },
    dispatchDate: input.pickupDate,
    pickupDate: input.pickupDate,
    packageReadyTime: input.readyTime,
    readyTime: input.readyTime,
    customerCloseTime: input.latestTime,
    latestTime: input.latestTime,
    carrierCode: input.carrierCode,
    domestic: input.isDomestic,
    isDomestic: input.isDomestic,
    packageCount: input.packageCount,
    totalWeight: {
      units: "KG",
      value: Math.round(input.totalWeightKg * 100) / 100,
    },
  };
};

export const mapFedexPickupCreateRequest = (
  input: FedexPickupCreateRequestInput,
) => {
  const config = getFedexConfig();
  const shipper = getFedexShipperConfig();
  const contact = {
    ...mapContact(input.contact),
    companyName: cleanFedexText(shipper.company || "Club Leon"),
  };

  return {
    associatedAccountNumber: {
      value: config.accountNumber,
    },
    accountNumber: {
      value: config.accountNumber,
    },
    originDetail: {
      pickupLocation: {
        contact,
        address: mapAddress(input.address),
      },
      packageLocation: input.pickupLocation,
      readyDateTimestamp: `${input.pickupDate}T${input.readyTime}`,
      customerCloseTime: input.latestTime,
      pickupDateType: "FUTURE_DAY",
      ...(input.remarks ? { pickupInstructions: cleanFedexText(input.remarks) } : {}),
    },
    carrierCode: input.carrierCode,
    remarks: input.remarks ? cleanFedexText(input.remarks) : undefined,
    packageCount: input.packageCount,
    totalWeight: {
      units: "KG",
      value: Math.round(input.totalWeightKg * 100) / 100,
    },
    trackingNumber: input.trackingNumbers[0],
    trackingNumbers: input.trackingNumbers,
  };
};

export const mapFedexPickupCancelRequest = (
  input: FedexPickupCancelRequestInput,
) => {
  const config = getFedexConfig();

  return {
    associatedAccountNumber: {
      value: config.accountNumber,
    },
    accountNumber: {
      value: config.accountNumber,
    },
    pickupConfirmationCode: input.confirmationNumber,
    confirmationNumber: input.confirmationNumber,
    carrierCode: input.carrierCode,
    scheduledDate: input.scheduledDate,
    dispatchDate: input.scheduledDate,
    ...(input.locationCode ? { location: input.locationCode } : {}),
    ...(input.locationCode ? { locationCode: input.locationCode } : {}),
  };
};

export const mapFedexPickupAvailabilityResponse = (
  input: FedexPickupAvailabilityRequestInput,
  response: FedexPickupProviderResponse,
): FedexPickupAvailabilityResult => {
  const output = toRecord(response.output);
  const reason =
    firstNestedString(output, ["reason", "message", "description"]) ||
    pickString(toRecord(response), ["message"]);
  const availableValue =
    output?.available ??
    output?.isAvailable ??
    output?.availability ??
    output?.pickupAvailable;
  const available =
    typeof availableValue === "boolean" ? availableValue : !reason;

  return {
    ok: true,
    provider: "FEDEX",
    available,
    carrierCode: input.carrierCode,
    pickupDate:
      firstNestedString(output, ["pickupDate", "dispatchDate", "date"]) ||
      input.pickupDate,
    cutOffTime: firstNestedString(output, [
      "cutOffTime",
      "cutoffTime",
      "localCutOffTime",
    ]),
    accessTime: firstNestedString(output, ["accessTime"]),
    readyTime: input.readyTime,
    latestTime: input.latestTime,
    defaultReadyTime: firstNestedString(output, ["defaultReadyTime"]),
    localTime: firstNestedString(output, ["localTime"]),
    ...(available ? {} : { reason: reason || "Pickup no disponible" }),
    warnings: collectWarnings(response),
  };
};

export const mapFedexPickupCreateResponse = (
  response: FedexPickupProviderResponse,
) => {
  const output = toRecord(response.output);
  const confirmationNumber = firstNestedString(output, [
    "confirmationNumber",
    "pickupConfirmationNumber",
    "pickupConfirmationCode",
    "dispatchConfirmationNumber",
  ]);

  if (!confirmationNumber) {
    throw new Error("FedEx Pickup response did not include a confirmation number");
  }

  return {
    confirmationNumber,
    locationCode: firstNestedString(output, ["locationCode", "location"]),
    pickupNotification: firstNestedString(output, ["pickupNotification"]),
    warnings: collectWarnings(response),
  };
};

export const mapFedexPickupCancelResponse = (
  response: FedexPickupProviderResponse,
) => ({
  confirmationNumber:
    firstNestedString(toRecord(response.output), [
      "confirmationNumber",
      "pickupConfirmationNumber",
      "pickupConfirmationCode",
      "dispatchConfirmationNumber",
    ]) || "",
  warnings: collectWarnings(response),
});

