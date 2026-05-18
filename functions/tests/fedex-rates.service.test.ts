import { FedexProviderError } from "../src/modules/shipping/fedex/fedex.errors";
import { FedexRatesService } from "../src/modules/shipping/fedex/fedex-rates.service";
import { FedexRateQuoteInput } from "../src/modules/shipping/fedex/fedex-rates.types";

const originalEnv = { ...process.env };

const input: FedexRateQuoteInput = {
  origin: {
    postalCode: "37150",
    city: "Leon",
    stateOrProvinceCode: "GUA",
    countryCode: "MX",
    residential: false,
  },
  destination: {
    postalCode: "06100",
    city: "Ciudad de Mexico",
    stateOrProvinceCode: "CMX",
    countryCode: "MX",
    residential: true,
  },
  packages: [
    {
      weightKg: 1,
      lengthCm: 30,
      widthCm: 25,
      heightCm: 10,
    },
  ],
  shipDate: "2026-05-12",
  currency: "MXN",
  rateRequestTypes: ["ACCOUNT", "LIST"],
};

describe("FedEx rates service", () => {
  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.FEDEX_ENV = "sandbox";
    process.env.FEDEX_BASE_URL = "https://apis-sandbox.fedex.com";
    process.env.FEDEX_CLIENT_ID = "client-id";
    process.env.FEDEX_CLIENT_SECRET = "client-secret";
    process.env.FEDEX_ACCOUNT_NUMBER = "740561073";
    delete process.env.FEDEX_SERVICE_TYPE;
    jest.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("uses fedexClient-compatible post against the rates endpoint", async () => {
    const client = {
      post: jest.fn().mockResolvedValue({
        output: {
          rateReplyDetails: [
            {
              serviceType: "FEDEX_EXPRESS_SAVER",
              serviceName: "FedEx Express Saver",
              ratedShipmentDetails: [
                {
                  rateType: "ACCOUNT",
                  shipmentRateDetail: {
                    totalNetCharge: { amount: 189.5, currency: "MXN" },
                  },
                },
              ],
            },
          ],
        },
      }),
    };
    const service = new FedexRatesService(client);

    const result = await service.quoteRates(input);

    expect(client.post).toHaveBeenCalledWith(
      "/rate/v1/rates/quotes",
      expect.objectContaining({
        accountNumber: { value: "740561073" },
        requestedShipment: expect.objectContaining({
          packagingType: "YOUR_PACKAGING",
          pickupType: "USE_SCHEDULED_PICKUP",
          totalPackageCount: 1,
        }),
      }),
    );
    const payload = client.post.mock.calls[0][1] as any;
    expect(payload.requestedShipment.serviceType).toBeUndefined();
    expect(console.log).toHaveBeenCalledWith(
      "[FedEx Rate Debug]",
      expect.objectContaining({
        hasServiceType: false,
        serviceType: null,
        packagingType: "YOUR_PACKAGING",
        hasOneRateSpecialService: false,
        pickupType: "USE_SCHEDULED_PICKUP",
        originCountry: "MX",
        originPostalCode: "37150",
        recipientCountry: "MX",
        recipientPostalCode: "06100",
        packageCount: 1,
      }),
    );
    expect(JSON.stringify((console.log as jest.Mock).mock.calls)).not.toContain(
      "client-secret",
    );
    expect(result).toMatchObject({
      ok: true,
      provider: "FEDEX",
      environment: "sandbox",
      currency: "MXN",
      options: [
        {
          amount: 189.5,
          serviceType: "FEDEX_EXPRESS_SAVER",
        },
      ],
    });
    expect(result.quoteId).toMatch(/^fedex_quote_/);
  });

  it("propagates controlled FedEx provider errors", async () => {
    const client = {
      post: jest.fn().mockRejectedValue(
        new FedexProviderError({
          provider: "FEDEX",
          status: 400,
          message: "Bad FedEx request",
        }),
      ),
    };
    const service = new FedexRatesService(client);

    await expect(service.quoteRates(input)).rejects.toMatchObject({
      provider: "FEDEX",
      message: "Bad FedEx request",
    });
  });
});
