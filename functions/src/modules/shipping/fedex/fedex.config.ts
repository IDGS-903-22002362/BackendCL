export type FedexEnvironment = "sandbox" | "production";

export interface FedexConfig {
  environment: FedexEnvironment;
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  accountNumber: string;
  pickupEnabled: boolean;
  pickupDefaultCarrierCode: "FDXE" | "FDXG";
  pickupDefaultLocation: string;
  autoCreateLabelOnPaid: boolean;
}

const requiredEnvVars = [
  "FEDEX_ENV",
  "FEDEX_BASE_URL",
  "FEDEX_CLIENT_ID",
  "FEDEX_CLIENT_SECRET",
  "FEDEX_ACCOUNT_NUMBER",
] as const;

type FedexEnvVar = typeof requiredEnvVars[number];

const readRequiredEnv = (name: FedexEnvVar): string => {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing FedEx environment variable: ${name}`);
  }

  return value;
};

const readOptionalEnv = (name: string): string | undefined => {
  const value = process.env[name]?.trim();
  return value || undefined;
};

const readBooleanEnv = (name: string, defaultValue: boolean): boolean => {
  const value = readOptionalEnv(name);

  if (!value) {
    return defaultValue;
  }

  return !["false", "0", "no", "off"].includes(value.toLowerCase());
};

const readPickupCarrierCode = (): "FDXE" | "FDXG" => {
  const value = readOptionalEnv("FEDEX_PICKUP_DEFAULT_CARRIER_CODE") || "FDXE";

  if (value !== "FDXE" && value !== "FDXG") {
    throw new Error(
      "Invalid FedEx environment variable: FEDEX_PICKUP_DEFAULT_CARRIER_CODE must be FDXE or FDXG",
    );
  }

  return value;
};

export const getFedexConfig = (): FedexConfig => {
  const environment = readRequiredEnv("FEDEX_ENV");

  if (environment !== "sandbox" && environment !== "production") {
    throw new Error(
      "Invalid FedEx environment variable: FEDEX_ENV must be sandbox or production",
    );
  }

  return {
    environment,
    baseUrl: readRequiredEnv("FEDEX_BASE_URL").replace(/\/+$/, ""),
    clientId: readRequiredEnv("FEDEX_CLIENT_ID"),
    clientSecret: readRequiredEnv("FEDEX_CLIENT_SECRET"),
    accountNumber: readRequiredEnv("FEDEX_ACCOUNT_NUMBER"),
    pickupEnabled: readBooleanEnv("FEDEX_PICKUP_ENABLED", true),
    pickupDefaultCarrierCode: readPickupCarrierCode(),
    pickupDefaultLocation: readOptionalEnv("FEDEX_PICKUP_DEFAULT_LOCATION") || "FRONT",
    autoCreateLabelOnPaid: readBooleanEnv(
      "FEDEX_AUTO_CREATE_LABEL_ON_PAID",
      false,
    ),
  };
};

export const getFedexTrackConfig = (): FedexConfig => {
  const baseConfig = getFedexConfig();

  return {
    ...baseConfig,
    baseUrl: (readOptionalEnv("FEDEX_TRACK_BASE_URL") || baseConfig.baseUrl).replace(
      /\/+$/,
      "",
    ),
    clientId: readOptionalEnv("FEDEX_TRACK_CLIENT_ID") || baseConfig.clientId,
    clientSecret:
      readOptionalEnv("FEDEX_TRACK_CLIENT_SECRET") || baseConfig.clientSecret,
  };
};
