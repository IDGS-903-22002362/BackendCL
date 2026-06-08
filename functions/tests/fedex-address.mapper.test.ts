import {
  mapFedexAddressValidationRequest,
  mapFedexAddressValidationResponse,
} from "../src/modules/shipping/fedex/fedex-address.mapper";
import {
  fedexAddressValidationSchema,
  FedexAddressValidationInput,
} from "../src/modules/shipping/fedex/fedex-address.types";

const originalEnv = { ...process.env };

const input: FedexAddressValidationInput = {
  address: {
    streetLines: [
      "Blvd Adolfo Lopez Mateos 1810",
      "Colonia La Martinica",
    ],
    city: "Leon",
    stateOrProvinceCode: "GUA",
    postalCode: "37500",
    countryCode: "MX",
    residential: true,
  },
};

describe("FedEx address mapper", () => {
  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.FEDEX_ENV = "sandbox";
    process.env.FEDEX_BASE_URL = "https://apis-sandbox.fedex.com";
    process.env.FEDEX_CLIENT_ID = "client-id";
    process.env.FEDEX_CLIENT_SECRET = "client-secret";
    process.env.FEDEX_ACCOUNT_NUMBER = "740561073";
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("validates address payload and normalizes whitespace", () => {
    const parsed = fedexAddressValidationSchema.parse({
      address: {
        streetLines: ["  Blvd   Adolfo   Lopez   Mateos 1810  "],
        city: "  Leon   Centro ",
        stateOrProvinceCode: " gua ",
        postalCode: " 37500 ",
        countryCode: " mx ",
      },
    });

    expect(parsed.address.streetLines).toEqual([
      "Blvd Adolfo Lopez Mateos 1810",
    ]);
    expect(parsed.address.city).toBe("Leon Centro");
    expect(parsed.address.countryCode).toBe("MX");
  });

  it("rejects invalid street line count, country code, and MX postal code", () => {
    expect(() =>
      fedexAddressValidationSchema.parse({
        address: {
          streetLines: [],
          countryCode: "MX",
          postalCode: "37500",
        },
      }),
    ).toThrow("streetLines must contain at least one line");

    expect(() =>
      fedexAddressValidationSchema.parse({
        address: {
          streetLines: ["Street"],
          countryCode: "MEX",
          postalCode: "37500",
        },
      }),
    ).toThrow("countryCode must be exactly 2 letters");

    expect(() =>
      fedexAddressValidationSchema.parse({
        address: {
          streetLines: ["Street"],
          countryCode: "MX",
        },
      }),
    ).toThrow("postalCode is required for MX addresses");
  });

  it("rejects field values above maximum lengths", () => {
    expect(() =>
      fedexAddressValidationSchema.parse({
        address: {
          streetLines: ["x".repeat(71)],
          countryCode: "MX",
          postalCode: "37500",
        },
      }),
    ).toThrow("streetLine must be a non-empty string up to 70 characters");

    expect(() =>
      fedexAddressValidationSchema.parse({
        address: {
          streetLines: ["Street"],
          city: "x".repeat(51),
          countryCode: "MX",
          postalCode: "37500",
        },
      }),
    ).toThrow("city must be up to 50 characters");
  });

  it("maps one address request without account number or credentials", () => {
    const payload = mapFedexAddressValidationRequest(input);
    const serialized = JSON.stringify(payload);

    expect(payload.addressesToValidate).toHaveLength(1);
    expect(payload.addressesToValidate[0].address).toEqual(input.address);
    expect(serialized).not.toContain("accountNumber");
    expect(serialized).not.toContain("client-secret");
    expect(serialized).not.toContain("baseURL");
  });

  it("maps resolved address, messages, changes, and score", () => {
    const result = mapFedexAddressValidationResponse(input, {
      output: {
        resolvedAddresses: [
          {
            classification: "BUSINESS",
            addressState: "STANDARDIZED",
            score: 93,
            address: {
              streetLines: ["BLVD ADOLFO LOPEZ MATEOS 1810"],
              city: "LEON",
              stateOrProvinceCode: "GUA",
              postalCode: "37500",
              countryCode: "MX",
              residential: false,
            },
            annotations: [{ code: "CHANGED", message: "Address standardized" }],
            customerMessages: [{ code: "INFO", message: "Suggested address" }],
          },
        ],
      },
    });

    expect(result).toMatchObject({
      ok: true,
      provider: "FEDEX",
      environment: "sandbox",
      isValid: true,
      classification: "BUSINESS",
      addressState: "STANDARDIZED",
      rawScore: 93,
      resolvedAddress: {
        streetLines: ["BLVD ADOLFO LOPEZ MATEOS 1810"],
        city: "LEON",
        residential: false,
      },
      warnings: ["Address standardized"],
      customerMessages: ["Suggested address"],
    });
    expect(result.changes.map((change) => change.field)).toEqual([
      "streetLines",
      "city",
      "residential",
    ]);
  });

  it("marks response invalid when FedEx does not return a usable address", () => {
    const result = mapFedexAddressValidationResponse(input, {
      output: {
        resolvedAddresses: [],
      },
    });

    expect(result.isValid).toBe(false);
    expect(result.addressState).toBe("UNKNOWN");
    expect(result.classification).toBe("UNKNOWN");
  });
});
