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
    jest.spyOn(console, "error").mockImplementation(() => undefined);
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
    const ratePayloadDebug = JSON.parse((console.log as jest.Mock).mock.calls[0][1]);
    const addressDebug = JSON.parse((console.log as jest.Mock).mock.calls[1][1]);
    const logOutput = JSON.stringify((console.log as jest.Mock).mock.calls);
    expect(logOutput).toContain("[FedEx Rate Payload Debug]");
    expect(logOutput).toContain("[FedEx Address Debug]");
    expect(ratePayloadDebug.accountNumberPresent).toBe(true);
    expect(ratePayloadDebug).not.toHaveProperty("accountNumber");
    expect(addressDebug.destination).toMatchObject({
      postalCode: "06100",
      countryCode: "MX",
    });
    expect(addressDebug.requestedPackageLineItems).toHaveLength(1);
    expect(logOutput).not.toContain("740561073");
    expect(logOutput).not.toContain("client-secret");
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

  it("logs complete FedEx error payload without account number", async () => {
    const client = {
      post: jest.fn().mockRejectedValue({
        response: {
          status: 400,
          statusText: "Bad Request",
          data: {
            transactionId: "tx-123",
            errors: [
              {
                code: "INVALID.INPUT.EXCEPTION",
                message: "Invalid recipient postal code",
              },
            ],
          },
          headers: {},
        },
        message: "Request failed",
      }),
    };
    const service = new FedexRatesService(client);

    await expect(service.quoteRates(input)).rejects.toMatchObject({
      message: "Request failed",
    });

    const errorDebug = JSON.parse((console.error as jest.Mock).mock.calls[0][1]);
    const errorOutput = JSON.stringify((console.error as jest.Mock).mock.calls);
    expect(errorOutput).toContain("[FedEx Error Raw]");
    expect(errorDebug.errors).toEqual([
      {
        code: "INVALID.INPUT.EXCEPTION",
        message: "Invalid recipient postal code",
      },
    ]);
    expect(errorOutput).toContain("Invalid recipient postal code");
    expect(errorDebug.transactionId).toBe("tx-123");
    expect(errorOutput).not.toContain("740561073");
  });
});
