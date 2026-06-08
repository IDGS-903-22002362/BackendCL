import { FedexAddressService } from "../src/modules/shipping/fedex/fedex-address.service";
import { FedexAddressValidationInput } from "../src/modules/shipping/fedex/fedex-address.types";

const originalEnv = { ...process.env };

const input: FedexAddressValidationInput = {
  address: {
    streetLines: ["Blvd Adolfo Lopez Mateos 1810"],
    city: "Leon",
    stateOrProvinceCode: "GUA",
    postalCode: "37500",
    countryCode: "MX",
    residential: true,
  },
};

describe("FedEx address service", () => {
  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.FEDEX_ENV = "sandbox";
    process.env.FEDEX_BASE_URL = "https://apis-sandbox.fedex.com";
    process.env.FEDEX_CLIENT_ID = "client-id";
    process.env.FEDEX_CLIENT_SECRET = "client-secret";
    process.env.FEDEX_ACCOUNT_NUMBER = "740561073";
    jest.spyOn(console, "log").mockImplementation(() => undefined);
    jest.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("uses fedexClient-compatible post against the address endpoint", async () => {
    const client = {
      post: jest.fn().mockResolvedValue({
        output: {
          resolvedAddresses: [
            {
              classification: "RESIDENTIAL",
              addressState: "STANDARDIZED",
              address: {
                streetLines: ["BLVD ADOLFO LOPEZ MATEOS 1810"],
                city: "LEON",
                stateOrProvinceCode: "GUA",
                postalCode: "37500",
                countryCode: "MX",
                residential: true,
              },
            },
          ],
        },
      }),
    };
    const service = new FedexAddressService(client);

    const result = await service.validateAddress(input);

    expect(client.post).toHaveBeenCalledWith(
      "/address/v1/addresses/resolve",
      {
        addressesToValidate: [
          {
            address: input.address,
          },
        ],
      },
    );
    expect(result).toMatchObject({
      ok: true,
      provider: "FEDEX",
      environment: "sandbox",
      isValid: true,
      classification: "RESIDENTIAL",
    });
  });

  it("validates MX postal code 37500 first without stateOrProvinceCode", async () => {
    const client = {
      post: jest.fn().mockResolvedValue({ output: {} }),
    };
    const service = new FedexAddressService(client);

    const result = await service.validatePostalCode({
      role: "ORIGIN",
      countryCode: "MX",
      stateOrProvinceCode: "GUA",
      postalCode: "37500",
      carrierCode: "FDXE",
      shipDate: "2026-05-18",
    });

    expect(result).toBe(true);
    expect(client.post).toHaveBeenCalledWith("/country/v1/postal/validate", {
      carrierCode: "FDXE",
      countryCode: "MX",
      postalCode: "37500",
      shipDate: "2026-05-18",
    });
    expect(client.post.mock.calls[0][1]).not.toHaveProperty("stateOrProvinceCode");
  });

  it("validates MX postal code 37208 first without stateOrProvinceCode", async () => {
    const client = {
      post: jest.fn().mockResolvedValue({ output: {} }),
    };
    const service = new FedexAddressService(client);

    await service.validatePostalCode({
      role: "DESTINATION",
      countryCode: "MX",
      stateOrProvinceCode: "Guanajuato",
      postalCode: "37208",
      carrierCode: "FDXE",
    });

    expect(client.post.mock.calls[0][1]).toEqual({
      carrierCode: "FDXE",
      countryCode: "MX",
      postalCode: "37208",
    });
  });

  it("falls back with normalized state when MX postal validation without state fails", async () => {
    const client = {
      post: jest
        .fn()
        .mockRejectedValueOnce({
          response: {
            status: 422,
            data: { errors: [{ message: "Invalid postal/state combination" }] },
            headers: { "x-fedex-transaction-id": "tx-1" },
          },
        })
        .mockResolvedValueOnce({ output: {} }),
    };
    const service = new FedexAddressService(client);

    const result = await service.validatePostalCode({
      role: "DESTINATION",
      countryCode: "MX",
      stateOrProvinceCode: "Guanajuato",
      postalCode: "37208",
      carrierCode: "FDXE",
      shipDate: "2026-05-18",
    });

    expect(result).toBe(true);
    expect(client.post).toHaveBeenNthCalledWith(
      2,
      "/country/v1/postal/validate",
      {
        carrierCode: "FDXE",
        countryCode: "MX",
        stateOrProvinceCode: "GT",
        postalCode: "37208",
        shipDate: "2026-05-18",
      },
    );
  });

  it("logs role and returns false when both MX postal validation attempts fail", async () => {
    const client = {
      post: jest.fn().mockRejectedValue({
        response: {
          status: 422,
          data: {
            transactionId: "tx-2",
            errors: [{ message: "Invalid postal/state combination" }],
          },
          headers: {},
        },
      }),
    };
    const service = new FedexAddressService(client);

    const result = await service.validatePostalCode({
      role: "ORIGIN",
      countryCode: "MX",
      stateOrProvinceCode: "Guanajuato",
      postalCode: "37500",
      carrierCode: "FDXE",
    });

    expect(result).toBe(false);
    expect(console.error).toHaveBeenCalledWith(
      "[FedEx Postal Validation Error]",
      expect.objectContaining({
        role: "ORIGIN",
        status: 422,
        transactionId: "tx-2",
        message: "Invalid postal/state combination",
      }),
    );
  });
});
