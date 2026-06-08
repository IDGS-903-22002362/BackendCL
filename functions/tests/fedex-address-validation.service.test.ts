import { FedexProviderError } from "../src/modules/shipping/fedex/fedex.errors";
import {
  FedexAddressValidationError,
  FedexAddressValidationService,
} from "../src/modules/shipping/fedex/fedex-address-validation.service";

describe("FedEx public address validation service", () => {
  beforeEach(() => {
    jest.spyOn(console, "log").mockImplementation(() => undefined);
    jest.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("builds FedEx address validation payload with defaults", async () => {
    const client = {
      post: jest.fn().mockResolvedValue({
        transactionId: "tx-123",
        output: {
          resolvedAddresses: [
            {
              streetLinesToken: ["7372 PARKRIDGE BLVD", "APT 286"],
              city: "IRVING",
              stateOrProvinceCode: "TX",
              postalCode: "75063-8659",
              countryCode: "US",
              classification: "BUSINESS",
              parsedPostalCode: { base: "75063", addOn: "8659" },
              attributes: {
                Resolved: true,
                AddressType: "STANDARDIZED",
                DPV: true,
              },
            },
          ],
          alerts: [],
        },
      }),
    };
    const service = new FedexAddressValidationService(client);

    const result = await service.validateAddress({
      streetLines: [" 7372  PARKRIDGE BLVD ", " APT 286 "],
      city: " irving ",
      stateOrProvinceCode: " tx ",
      postalCode: " 75063-8659 ",
      countryCode: " us ",
      clientReferenceId: "checkout-address-1",
    });

    expect(client.post).toHaveBeenCalledWith("/address/v1/addresses/resolve", {
      validateAddressControlParameters: {
        includeResolutionTokens: true,
      },
      addressesToValidate: [
        {
          address: {
            streetLines: ["7372 PARKRIDGE BLVD", "APT 286"],
            city: "irving",
            stateOrProvinceCode: "TX",
            postalCode: "75063-8659",
            countryCode: "US",
          },
          clientReferenceId: "checkout-address-1",
        },
      ],
    });
    expect(result).toMatchObject({
      success: true,
      transactionId: "tx-123",
      addresses: [
        {
          inputIndex: 0,
          clientReferenceId: "checkout-address-1",
          isResolved: true,
          isStandardized: true,
          isDeliveryPointValid: true,
          isInterpolatedStreetAddress: false,
          isLikelyValid: true,
          classification: "BUSINESS",
          streetLines: ["7372 PARKRIDGE BLVD", "APT 286"],
          city: "IRVING",
          stateOrProvinceCode: "TX",
          postalCode: "75063-8659",
          countryCode: "US",
        },
      ],
      alerts: [],
    });
  });

  it("allows includeResolutionTokens false and preserves alphanumeric postal codes", async () => {
    const client = {
      post: jest.fn().mockResolvedValue({
        output: {
          resolvedAddresses: [
            {
              address: {
                streetLines: ["Toronto City Hall 100 Queen St W"],
                city: "Toronto",
                stateOrProvinceCode: "ON",
                postalCode: "M5H2N1",
                countryCode: "CA",
              },
              attributes: {
                Resolved: "true",
                AddressType: "STANDARDIZED",
              },
            },
          ],
        },
      }),
    };
    const service = new FedexAddressValidationService(client);

    await service.validateAddress({
      streetLines: ["Toronto City Hall 100 Queen St W"],
      city: "Toronto",
      stateOrProvinceCode: "ON",
      postalCode: " M5H2N1 ",
      countryCode: "CA",
      includeResolutionTokens: false,
    });

    expect(client.post).toHaveBeenCalledWith(
      "/address/v1/addresses/resolve",
      expect.objectContaining({
        validateAddressControlParameters: {
          includeResolutionTokens: false,
        },
        addressesToValidate: [
          expect.objectContaining({
            address: expect.objectContaining({
              postalCode: "M5H2N1",
            }),
          }),
        ],
      }),
    );
  });

  it.each([
    [
      {
        streetLines: [],
        countryCode: "MX",
        postalCode: "37500",
      },
      "FEDEX_ADDRESS_STREET_REQUIRED",
    ],
    [
      {
        streetLines: ["Blvd Adolfo Lopez Mateos 1810"],
        countryCode: "MEX",
        postalCode: "37500",
      },
      "FEDEX_ADDRESS_COUNTRY_REQUIRED",
    ],
    [
      {
        streetLines: ["Blvd Adolfo Lopez Mateos 1810"],
        countryCode: "MX",
      },
      "FEDEX_ADDRESS_LOCATION_REQUIRED",
    ],
  ])("rejects invalid input before FedEx", async (input, code) => {
    const client = { post: jest.fn() };
    const service = new FedexAddressValidationService(client);

    await expect(service.validateAddress(input as any)).rejects.toMatchObject({
      code,
      statusCode: 400,
    });
    expect(client.post).not.toHaveBeenCalled();
  });

  it("rejects invalid date and too many batch addresses", async () => {
    const client = { post: jest.fn() };
    const service = new FedexAddressValidationService(client);
    const address = {
      streetLines: ["Street"],
      countryCode: "US",
      postalCode: "10001",
    };

    await expect(
      service.validateAddresses({
        addresses: [address],
        inEffectAsOfTimestamp: "2026-02-30",
      }),
    ).rejects.toMatchObject({
      code: "FEDEX_ADDRESS_INVALID_DATE",
    });

    await expect(
      service.validateAddresses({
        addresses: Array.from({ length: 101 }, () => address),
      }),
    ).rejects.toMatchObject({
      code: "FEDEX_ADDRESS_TOO_MANY_ADDRESSES",
    });
    expect(client.post).not.toHaveBeenCalled();
  });

  it("marks interpolated addresses as not likely valid", async () => {
    const client = {
      post: jest.fn().mockResolvedValue({
        output: {
          resolvedAddresses: [
            {
              streetLinesToken: ["24 GROSVENOR SQ"],
              city: "LONDON",
              postalCode: "W1A 2LQ",
              countryCode: "GB",
              classification: "UNKNOWN",
              customerMessage: [
                {
                  code: "INTERPOLATED.STREET.ADDRESS",
                  message: "Interpolated street address",
                },
              ],
              attributes: {
                Resolved: true,
                AddressType: "STANDARDIZED",
              },
            },
          ],
        },
      }),
    };
    const service = new FedexAddressValidationService(client);

    const result = await service.validateAddress({
      streetLines: ["24 Grosvenor Square"],
      city: "London",
      postalCode: "W1A 2LQ",
      countryCode: "GB",
    });

    expect(result.addresses[0]).toMatchObject({
      isResolved: true,
      isStandardized: true,
      isInterpolatedStreetAddress: true,
      isLikelyValid: false,
    });
  });

  it("throws controlled error when FedEx omits resolvedAddresses", async () => {
    const client = {
      post: jest.fn().mockResolvedValue({ output: {} }),
    };
    const service = new FedexAddressValidationService(client);

    await expect(
      service.validateAddress({
        streetLines: ["Street"],
        countryCode: "US",
        postalCode: "10001",
      }),
    ).rejects.toMatchObject({
      code: "FEDEX_ADDRESS_EMPTY_RESPONSE",
      statusCode: 502,
    });
  });

  it.each([
    [400, "FEDEX_ADDRESS_BAD_REQUEST"],
    [401, "FEDEX_AUTH_FAILED"],
    [403, "FEDEX_FORBIDDEN"],
    [404, "FEDEX_NOT_FOUND"],
    [422, "FEDEX_ADDRESS_UNPROCESSABLE"],
    [429, "FEDEX_RATE_LIMITED"],
    [500, "FEDEX_SERVICE_UNAVAILABLE"],
    [503, "FEDEX_SERVICE_UNAVAILABLE"],
  ])("maps provider status %s to safe error", async (status, code) => {
    const client = {
      post: jest.fn().mockRejectedValue(
        new FedexProviderError({
          provider: "FEDEX",
          status,
          message: "raw provider payload",
        }),
      ),
    };
    const service = new FedexAddressValidationService(client);

    await expect(
      service.validateAddress({
        streetLines: ["Street"],
        countryCode: "US",
        postalCode: "10001",
      }),
    ).rejects.toMatchObject({
      code,
      statusCode: status,
    });
  });

  it("uses the controlled error class for input errors", async () => {
    const service = new FedexAddressValidationService({ post: jest.fn() });

    await expect(
      service.validateAddresses({ addresses: [] }),
    ).rejects.toBeInstanceOf(FedexAddressValidationError);
  });
});
