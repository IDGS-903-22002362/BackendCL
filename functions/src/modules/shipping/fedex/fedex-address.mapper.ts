import { getFedexConfig } from "./fedex.config";
import {
  FedexAddressChange,
  FedexAddressClassification,
  FedexAddressInput,
  FedexAddressMessage,
  FedexAddressState,
  FedexAddressValidationInput,
  FedexAddressValidationResponse,
  FedexAddressValidationResult,
  FedexNormalizedAddress,
  FedexResolvedAddress,
} from "./fedex-address.types";

type FedexAddressValidationPayload = {
  addressesToValidate: Array<{
    address: {
      streetLines: string[];
      city?: string;
      stateOrProvinceCode?: string;
      postalCode?: string;
      countryCode: string;
      residential?: boolean;
    };
  }>;
};

const normalizeAddress = (address: FedexAddressInput): FedexNormalizedAddress => ({
  streetLines: address.streetLines,
  city: address.city || "",
  stateOrProvinceCode: address.stateOrProvinceCode || "",
  postalCode: address.postalCode || "",
  countryCode: address.countryCode,
  ...(typeof address.residential === "boolean"
    ? { residential: address.residential }
    : {}),
});

const normalizeResolvedAddress = (
  input: FedexNormalizedAddress,
  resolved?: FedexResolvedAddress,
): FedexNormalizedAddress => {
  const address = resolved?.address;

  return {
    streetLines: address?.streetLines || input.streetLines,
    city: address?.city || input.city,
    stateOrProvinceCode:
      address?.stateOrProvinceCode || input.stateOrProvinceCode,
    postalCode: address?.postalCode || input.postalCode,
    countryCode: address?.countryCode || input.countryCode,
    ...(typeof address?.residential === "boolean"
      ? { residential: address.residential }
      : typeof input.residential === "boolean"
        ? { residential: input.residential }
        : {}),
  };
};

export const mapFedexAddressValidationRequest = (
  input: FedexAddressValidationInput,
): FedexAddressValidationPayload => ({
  addressesToValidate: [
    {
      address: {
        streetLines: input.address.streetLines,
        ...(input.address.city ? { city: input.address.city } : {}),
        ...(input.address.stateOrProvinceCode
          ? { stateOrProvinceCode: input.address.stateOrProvinceCode }
          : {}),
        ...(input.address.postalCode ? { postalCode: input.address.postalCode } : {}),
        countryCode: input.address.countryCode,
        ...(typeof input.address.residential === "boolean"
          ? { residential: input.address.residential }
          : {}),
      },
    },
  ],
});

const normalizeClassification = (
  value: unknown,
): FedexAddressClassification => {
  const normalized = typeof value === "string" ? value.toUpperCase() : "";

  if (
    normalized === "RESIDENTIAL" ||
    normalized === "BUSINESS" ||
    normalized === "MIXED"
  ) {
    return normalized;
  }

  return "UNKNOWN";
};

const normalizeAddressState = (value: unknown): FedexAddressState => {
  const normalized = typeof value === "string" ? value.toUpperCase() : "";

  if (
    normalized === "STANDARDIZED" ||
    normalized === "NORMALIZED" ||
    normalized === "RAW"
  ) {
    return normalized;
  }

  return "UNKNOWN";
};

const messageToString = (message: FedexAddressMessage): string | undefined => {
  if (message.message) {
    return message.message;
  }

  if (message.code) {
    return message.code;
  }

  return undefined;
};

const collectMessages = (
  messages: Array<FedexAddressMessage | undefined>,
): string[] =>
  messages
    .map((message) => (message ? messageToString(message) : undefined))
    .filter((message): message is string => Boolean(message));

const hasStrongErrorMessage = (messages: string[]): boolean =>
  messages.some((message) =>
    /invalid|unable|not found|insufficient|missing|error|failed/i.test(message),
  );

const attributeIndicatesValid = (
  attributes: Record<string, unknown> | undefined,
): boolean => {
  if (!attributes) {
    return false;
  }

  return Object.entries(attributes).some(([key, value]) => {
    const normalizedKey = key.toUpperCase();
    const normalizedValue = String(value).toUpperCase();

    return (
      normalizedKey.includes("VALID") &&
      ["TRUE", "Y", "YES", "VALID"].includes(normalizedValue)
    );
  });
};

const getFirstResolvedAddress = (
  response: FedexAddressValidationResponse,
): FedexResolvedAddress | undefined => {
  const output = response.output;

  if (!output) {
    return undefined;
  }

  if (Array.isArray(output.resolvedAddresses)) {
    return output.resolvedAddresses[0];
  }

  return output.resolvedAddress;
};

const valuesDiffer = (
  input: string | string[] | boolean | undefined,
  resolved: string | string[] | boolean | undefined,
): boolean => JSON.stringify(input ?? "") !== JSON.stringify(resolved ?? "");

const buildChanges = (
  input: FedexNormalizedAddress,
  resolved: FedexNormalizedAddress,
): FedexAddressChange[] => {
  const fields: Array<keyof FedexNormalizedAddress> = [
    "streetLines",
    "city",
    "stateOrProvinceCode",
    "postalCode",
    "countryCode",
    "residential",
  ];

  return fields
    .filter((field) => valuesDiffer(input[field], resolved[field]))
    .map((field) => ({
      field,
      input: input[field],
      resolved: resolved[field],
    }));
};

const extractScore = (resolved?: FedexResolvedAddress): number | null =>
  typeof resolved?.score === "number" && Number.isFinite(resolved.score)
    ? resolved.score
    : null;

const determineIsValid = (args: {
  resolved?: FedexResolvedAddress;
  resolvedAddress: FedexNormalizedAddress;
  addressState: FedexAddressState;
  messages: string[];
}): boolean => {
  if (!args.resolved) {
    return false;
  }

  if (!args.resolvedAddress.postalCode || !args.resolvedAddress.countryCode) {
    return false;
  }

  if (hasStrongErrorMessage(args.messages)) {
    return false;
  }

  return (
    args.addressState === "STANDARDIZED" ||
    attributeIndicatesValid(args.resolved.attributes)
  );
};

export const mapFedexAddressValidationResponse = (
  input: FedexAddressValidationInput,
  response: FedexAddressValidationResponse,
): FedexAddressValidationResult => {
  const config = getFedexConfig();
  const inputAddress = normalizeAddress(input.address);
  const resolved = getFirstResolvedAddress(response);
  const resolvedAddress = normalizeResolvedAddress(inputAddress, resolved);
  const addressState = normalizeAddressState(resolved?.addressState);
  const classification = normalizeClassification(resolved?.classification);
  const warnings = collectMessages([
    ...(resolved?.annotations || []),
    ...(response.output?.alerts || []),
  ]);
  const customerMessages = collectMessages([
    ...(resolved?.customerMessages || []),
    ...(response.output?.customerMessages || []),
  ]);
  const allMessages = [...warnings, ...customerMessages];

  return {
    ok: true,
    provider: "FEDEX",
    environment: config.environment,
    isValid: determineIsValid({
      resolved,
      resolvedAddress,
      addressState,
      messages: allMessages,
    }),
    classification,
    addressState,
    inputAddress,
    resolvedAddress,
    changes: buildChanges(inputAddress, resolvedAddress),
    warnings,
    customerMessages,
    rawScore: extractScore(resolved),
  };
};
