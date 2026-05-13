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
});
