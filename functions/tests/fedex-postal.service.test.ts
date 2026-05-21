import { FedexProviderError } from "../src/modules/shipping/fedex/fedex.errors";
import {
  FedexPostalCodeService,
  FedexPostalValidationError,
} from "../src/modules/shipping/fedex/fedex-postal.service";

describe("FedEx postal code service", () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date("2026-05-19T12:00:00.000Z"));
    jest.spyOn(console, "log").mockImplementation(() => undefined);
    jest.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("builds a clean MX postal validation payload", async () => {
    const client = {
      post: jest.fn().mockResolvedValue({
        transactionId: "tx-123",
        output: {
          countryCode: "MX",
          stateOrProvinceCode: "CS",
          cleanedPostalCode: "30709",
          alerts: [],
          locationDescriptions: [],
        },
      }),
    };
    const service = new FedexPostalCodeService(client);

    const result = await service.validatePostalCode({
      carrierCode: "FDXE",
      countryCode: "mx",
      stateOrProvinceCode: "cs",
      postalCode: " 30709 ",
      checkForMismatch: false,
    });

    expect(client.post).toHaveBeenCalledWith("/country/v1/postal/validate", {
      carrierCode: "FDXE",
      countryCode: "MX",
      stateOrProvinceCode: "CS",
      postalCode: "30709",
      shipDate: "2026-05-20",
      checkForMismatch: false,
    });
    expect(result).toMatchObject({
      isValid: true,
      carrierCode: "FDXE",
      countryCode: "MX",
      stateOrProvinceCode: "CS",
      postalCode: "30709",
      cleanedPostalCode: "30709",
      alerts: [],
      locationDescriptions: [],
      transactionId: "tx-123",
    });
  });

  it("applies carrier, shipDate, and checkForMismatch defaults", async () => {
    const client = {
      post: jest.fn().mockResolvedValue({
        output: {
          countryCode: "US",
          stateOrProvinceCode: "TN",
        },
      }),
    };
    const service = new FedexPostalCodeService(client);

    await service.validatePostalCode({
      countryCode: "US",
      stateOrProvinceCode: "tn",
      postalCode: "38017",
    });

    expect(client.post).toHaveBeenCalledWith(
      "/country/v1/postal/validate",
      expect.objectContaining({
        carrierCode: "FDXE",
        countryCode: "US",
        stateOrProvinceCode: "TN",
        postalCode: "38017",
        shipDate: "2026-05-20",
        checkForMismatch: true,
      }),
    );
  });

  it("preserves alphanumeric postal codes", async () => {
    const client = {
      post: jest.fn().mockResolvedValue({
        output: {
          countryCode: "CA",
          stateOrProvinceCode: "ON",
          cleanedPostalCode: "M4B2J8",
        },
      }),
    };
    const service = new FedexPostalCodeService(client);

    await service.validatePostalCode({
      carrierCode: "FDXG",
      countryCode: "ca",
      stateOrProvinceCode: "on",
      postalCode: " M4B2J8 ",
    });

    expect(client.post).toHaveBeenCalledWith(
      "/country/v1/postal/validate",
      expect.objectContaining({
        carrierCode: "FDXG",
        postalCode: "M4B2J8",
      }),
    );
  });

  it("rejects MX, US, and CA without stateOrProvinceCode before calling FedEx", async () => {
    const client = { post: jest.fn() };
    const service = new FedexPostalCodeService(client);

    await expect(
      service.validatePostalCode({
        countryCode: "MX",
        postalCode: "37500",
      }),
    ).rejects.toMatchObject({
      code: "FEDEX_POSTAL_VALIDATION_INPUT_ERROR",
      statusCode: 400,
    });
    expect(client.post).not.toHaveBeenCalled();
  });

  it("rejects invalid or past shipDate before calling FedEx", async () => {
    const client = { post: jest.fn() };
    const service = new FedexPostalCodeService(client);

    await expect(
      service.validatePostalCode({
        countryCode: "US",
        stateOrProvinceCode: "TN",
        postalCode: "38017",
        shipDate: "2026-05-18",
      }),
    ).rejects.toBeInstanceOf(FedexPostalValidationError);

    await expect(
      service.validatePostalCode({
        countryCode: "US",
        stateOrProvinceCode: "TN",
        postalCode: "38017",
        shipDate: "2026-02-30",
      }),
    ).rejects.toMatchObject({
      code: "FEDEX_POSTAL_VALIDATION_INPUT_ERROR",
    });
    expect(client.post).not.toHaveBeenCalled();
  });

  it("normalizes optional response collections when FedEx omits them", async () => {
    const client = {
      post: jest.fn().mockResolvedValue({
        customerTransactionId: "customer-tx-123",
        output: {
          countryCode: "GB",
          cleanedPostalCode: "SW1A 1AA",
        },
      }),
    };
    const service = new FedexPostalCodeService(client);

    const result = await service.validatePostalCode({
      countryCode: "GB",
      postalCode: " SW1A 1AA ",
      shipDate: "2026-05-20",
    });

    expect(result).toMatchObject({
      isValid: true,
      countryCode: "GB",
      postalCode: "SW1A 1AA",
      cleanedPostalCode: "SW1A 1AA",
      alerts: [],
      locationDescriptions: [],
      customerTransactionId: "customer-tx-123",
    });
  });

  it("throws a controlled error when FedEx returns no output", async () => {
    const client = {
      post: jest.fn().mockResolvedValue({ transactionId: "tx-empty" }),
    };
    const service = new FedexPostalCodeService(client);

    await expect(
      service.validatePostalCode({
        countryCode: "US",
        stateOrProvinceCode: "TN",
        postalCode: "38017",
      }),
    ).rejects.toMatchObject({
      code: "FEDEX_POSTAL_EMPTY_RESPONSE",
      statusCode: 502,
    });
  });

  it("maps provider status errors to safe postal errors", async () => {
    const client = {
      post: jest.fn().mockRejectedValue(
        new FedexProviderError({
          provider: "FEDEX",
          status: 429,
          message: "raw rate limit payload",
        }),
      ),
    };
    const service = new FedexPostalCodeService(client);

    await expect(
      service.validatePostalCode({
        countryCode: "US",
        stateOrProvinceCode: "TN",
        postalCode: "38017",
      }),
    ).rejects.toMatchObject({
      code: "FEDEX_RATE_LIMITED",
      message: "FedEx recibio demasiadas solicitudes. Intenta nuevamente mas tarde.",
      statusCode: 429,
    });
  });
});
