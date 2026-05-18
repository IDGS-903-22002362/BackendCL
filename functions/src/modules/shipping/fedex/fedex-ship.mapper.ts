import { getFedexConfig } from "./fedex.config";
import {
  FedexCancelShipmentNormalizedResult,
  FedexCancelShipmentProviderResponse,
  FedexCancelShipmentRequestInput,
  FedexShipContactAddress,
  FedexShipNormalizedResult,
  FedexShipPackageInput,
  FedexShipPackageResult,
  FedexShipRequestInput,
  FedexShipResponse,
  FedexShipmentDocument,
  FedexTransactionShipment,
} from "./fedex-ship.types";

const LABEL_STOCK_TYPE = "PAPER_85X11_TOP_HALF_LABEL";

const readOptionalShipperEnv = (name: string): string | undefined => {
  const value = process.env[name]?.trim();
  return value || undefined;
};

const readRequiredShipperEnv = (
  name: string,
  legacyName?: string,
): string => {
  const value = readOptionalShipperEnv(name);
  const legacyValue = legacyName ? readOptionalShipperEnv(legacyName) : undefined;

  if (value) {
    return value;
  }

  if (legacyValue) {
    return legacyValue;
  }

  throw new Error(
    `Missing FedEx shipper environment variable: ${name}${
      legacyName ? ` or ${legacyName}` : ""
    }`,
  );
};

export const cleanFedexText = (value: string): string =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, "")
    .trim()
    .replace(/\s+/g, " ");

const cleanOptionalText = (value: string | undefined): string | undefined => {
  if (!value) {
    return undefined;
  }

  const cleaned = cleanFedexText(value);
  return cleaned ? cleaned : undefined;
};

const readOptionalBooleanEnv = (
  name: string,
  defaultValue?: boolean,
): boolean | undefined => {
  const value = readOptionalShipperEnv(name);

  if (!value) {
    return defaultValue;
  }

  return !["false", "0", "no", "off"].includes(value.toLowerCase());
};

const roundWeight = (value: number): number => Math.round(value * 100) / 100;

const roundDimension = (value: number): number => Math.max(1, Math.ceil(value));

const assertValidPackage = (item: FedexShipPackageInput): void => {
  if (
    item.weightKg <= 0 ||
    item.lengthCm <= 0 ||
    item.widthCm <= 0 ||
    item.heightCm <= 0
  ) {
    throw new Error("FedEx shipment packages require positive weight and dimensions");
  }
};

export const getFedexShipperConfig = (): FedexShipContactAddress => {
  const streetLines = [
    readRequiredShipperEnv("FEDEX_SHIPPER_STREET_1"),
    cleanOptionalText(process.env.FEDEX_SHIPPER_STREET_2),
  ].filter((item): item is string => Boolean(item));

  return {
    name: cleanFedexText(
      readRequiredShipperEnv(
        "FEDEX_SHIPPER_CONTACT_NAME",
        "FEDEX_SHIPPER_NAME",
      ),
    ),
    company:
      cleanOptionalText(
        readOptionalShipperEnv("FEDEX_SHIPPER_COMPANY_NAME") ||
          readOptionalShipperEnv("FEDEX_SHIPPER_COMPANY"),
      ) || "Club Leon",
    phone: cleanFedexText(readRequiredShipperEnv("FEDEX_SHIPPER_PHONE")).replace(/\D/g, ""),
    email: cleanOptionalText(process.env.FEDEX_SHIPPER_EMAIL),
    streetLines: streetLines.map(cleanFedexText),
    city: cleanFedexText(readRequiredShipperEnv("FEDEX_SHIPPER_CITY")),
    stateOrProvinceCode: cleanFedexText(
      readRequiredShipperEnv(
        "FEDEX_SHIPPER_STATE_OR_PROVINCE_CODE",
        "FEDEX_SHIPPER_STATE",
      ),
    ),
    postalCode: cleanFedexText(readRequiredShipperEnv("FEDEX_SHIPPER_POSTAL_CODE")),
    countryCode: cleanFedexText(
      readRequiredShipperEnv("FEDEX_SHIPPER_COUNTRY_CODE"),
    ).toUpperCase(),
    residential: readOptionalBooleanEnv("FEDEX_SHIPPER_RESIDENTIAL"),
  };
};

const mapContact = (address: FedexShipContactAddress) => ({
  personName: cleanFedexText(address.name),
  ...(address.company ? { companyName: cleanFedexText(address.company) } : {}),
  phoneNumber: cleanFedexText(address.phone).replace(/\D/g, ""),
  ...(address.email ? { emailAddress: cleanFedexText(address.email) } : {}),
});

const mapAddress = (address: FedexShipContactAddress) => ({
  streetLines: address.streetLines.map(cleanFedexText),
  city: cleanFedexText(address.city),
  stateOrProvinceCode: cleanFedexText(address.stateOrProvinceCode),
  postalCode: cleanFedexText(address.postalCode),
  countryCode: cleanFedexText(address.countryCode).toUpperCase(),
  ...(typeof address.residential === "boolean"
    ? { residential: address.residential }
    : {}),
});

const mapPackage = (item: FedexShipPackageInput, index: number, orderId: string) => {
  assertValidPackage(item);

  return {
    sequenceNumber: String(index + 1),
    weight: {
      units: "KG",
      value: roundWeight(item.weightKg),
    },
    dimensions: {
      length: roundDimension(item.lengthCm),
      width: roundDimension(item.widthCm),
      height: roundDimension(item.heightCm),
      units: "CM",
    },
    customerReferences: [
      {
        customerReferenceType: "CUSTOMER_REFERENCE",
        value: orderId,
      },
    ],
  };
};

export const mapFedexShipRequest = (input: FedexShipRequestInput) => {
  const config = getFedexConfig();
  const shipper = getFedexShipperConfig();

  if (!Array.isArray(input.packages) || input.packages.length === 0) {
    throw new Error("FedEx shipment requires at least one package");
  }

  return {
    labelResponseOptions: "LABEL",
    requestedShipment: {
      shipper: {
        contact: mapContact(shipper),
        address: mapAddress(shipper),
      },
      recipients: [
        {
          contact: mapContact(input.recipient),
          address: mapAddress(input.recipient),
        },
      ],
      shipDatestamp: input.shipDate,
      serviceType: input.serviceType,
      packagingType: "YOUR_PACKAGING",
      pickupType: "DROPOFF_AT_FEDEX_LOCATION",
      blockInsightVisibility: false,
      shippingChargesPayment: {
        paymentType: "SENDER",
      },
      labelSpecification: {
        imageType: input.labelImageType,
        labelStockType: LABEL_STOCK_TYPE,
      },
      requestedPackageLineItems: input.packages.map((item, index) =>
        mapPackage(item, index, input.orderId),
      ),
    },
    accountNumber: {
      value: config.accountNumber,
    },
  };
};

export const mapFedexCancelShipmentRequest = (
  input: FedexCancelShipmentRequestInput,
) => {
  const config = getFedexConfig();

  return {
    accountNumber: {
      value: config.accountNumber,
    },
    trackingNumber: input.trackingNumber,
    deletionControl: input.deletionControl,
  };
};

const alertToMessage = (alert: { code?: string; message?: string }): string | undefined =>
  alert.message || alert.code;

const collectCancelWarnings = (
  response: FedexCancelShipmentProviderResponse,
): string[] =>
  [
    ...(response.output?.alerts || []),
    ...(response.output?.warnings || []),
    ...(response.alerts || []),
    ...(response.warnings || []),
  ]
    .map(alertToMessage)
    .filter((item): item is string => Boolean(item));

const collectDocuments = (
  shipment: FedexTransactionShipment,
): FedexShipmentDocument[] => {
  const documents: FedexShipmentDocument[] = [];

  documents.push(...(shipment.shipmentDocuments || []));
  for (const piece of shipment.pieceResponses || []) {
    documents.push(...(piece.packageDocuments || []));
  }
  for (const detail of shipment.completedShipmentDetail?.completedPackageDetails || []) {
    documents.push(...(detail.packageDocuments || []));
  }

  return documents;
};

const findEncodedLabel = (shipment: FedexTransactionShipment): string | undefined =>
  collectDocuments(shipment).find((document) => document.encodedLabel)?.encodedLabel;

const getPackageTrackingNumbers = (shipment: FedexTransactionShipment): string[] => {
  const fromPieces = (shipment.pieceResponses || [])
    .map((piece) => piece.trackingNumber)
    .filter((item): item is string => Boolean(item));
  const fromDetails = (shipment.completedShipmentDetail?.completedPackageDetails || [])
    .flatMap((detail) => detail.trackingIds || [])
    .map((tracking) => tracking.trackingNumber)
    .filter((item): item is string => Boolean(item));

  return fromPieces.length > 0 ? fromPieces : fromDetails;
};

export const mapFedexShipResponse = (
  input: FedexShipRequestInput,
  response: FedexShipResponse,
): FedexShipNormalizedResult => {
  const config = getFedexConfig();
  const shipment = response.output?.transactionShipments?.[0];

  if (!shipment) {
    throw new Error("FedEx Ship response did not include a shipment");
  }

  const packageTrackingNumbers = getPackageTrackingNumbers(shipment);
  const trackingNumber =
    packageTrackingNumbers[0] || shipment.masterTrackingNumber;
  const encodedLabel = findEncodedLabel(shipment);

  if (!trackingNumber) {
    throw new Error("FedEx Ship response did not include a tracking number");
  }

  if (!encodedLabel) {
    throw new Error("FedEx Ship response did not include an encoded label");
  }

  const packageResults: FedexShipPackageResult[] = input.packages.map((item, index) => ({
    sequenceNumber: index + 1,
    trackingNumber: packageTrackingNumbers[index],
    weightKg: roundWeight(item.weightKg),
    lengthCm: roundDimension(item.lengthCm),
    widthCm: roundDimension(item.widthCm),
    heightCm: roundDimension(item.heightCm),
  }));

  const warnings = [
    ...(response.output?.alerts || []),
    ...(shipment.shipmentAdvisoryDetails?.regulatoryAdvisory || []),
  ]
    .map(alertToMessage)
    .filter((item): item is string => Boolean(item));

  return {
    provider: "FEDEX",
    environment: config.environment,
    trackingNumber,
    ...(shipment.masterTrackingNumber
      ? { masterTrackingNumber: shipment.masterTrackingNumber }
      : {}),
    serviceType: shipment.serviceType || input.serviceType,
    shipmentId: shipment.masterTrackingNumber,
    labelImageType: input.labelImageType,
    labelContentType:
      input.labelImageType === "PDF" ? "application/pdf" : "image/png",
    labelBuffer: Buffer.from(encodedLabel, "base64"),
    warnings,
    packages: packageResults,
  };
};

export const fedexLabelStockType = LABEL_STOCK_TYPE;

export const mapFedexCancelShipmentResponse = (
  response: FedexCancelShipmentProviderResponse,
): FedexCancelShipmentNormalizedResult => {
  const cancelled =
    response.output?.cancelledShipment ??
    response.cancelledShipment ??
    response.output?.success ??
    response.success ??
    true;
  const transactionId =
    response.output?.transactionId ||
    response.transactionId ||
    response.customerTransactionId;
  const message = response.output?.message || response.message;

  return {
    cancelled: Boolean(cancelled),
    ...(transactionId ? { transactionId } : {}),
    ...(message ? { message } : {}),
    warnings: collectCancelWarnings(response),
  };
};
