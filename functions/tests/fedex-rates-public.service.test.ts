import { FedexProviderError } from "../src/modules/shipping/fedex/fedex.errors";
import {
  FedexPublicRateError,
  FedexRatesService,
} from "../src/modules/shipping/fedex/fedex-rates.service";
import { FedexRateQuoteDto } from "../src/modules/shipping/fedex/fedex-rates.types";

const originalEnv = { ...process.env };

const setFedexEnv = () => {
  process.env.FEDEX_ENV = "sandbox";
  process.env.FEDEX_BASE_URL = "https://apis-sandbox.fedex.com";
  process.env.FEDEX_CLIENT_ID = "client-id";
  process.env.FEDEX_CLIENT_SECRET = "client-secret";
  process.env.FEDEX_ACCOUNT_NUMBER = "740561073";
  process.env.FEDEX_SHIPPER_CONTACT_NAME = "La Guarida del Leon";
  process.env.FEDEX_SHIPPER_COMPANY_NAME = "La Guarida del Leon";
  process.env.FEDEX_SHIPPER_PHONE = "4777112626";
  process.env.FEDEX_SHIPPER_EMAIL = "shipping@example.com";
  process.env.FEDEX_SHIPPER_STREET_1 = "Blvd Adolfo Lopez Mateos";
  process.env.FEDEX_SHIPPER_STREET_2 = "La Martinica";
  process.env.FEDEX_SHIPPER_CITY = "Leon";
  process.env.FEDEX_SHIPPER_STATE_OR_PROVINCE_CODE = "GTO";
  process.env.FEDEX_SHIPPER_POSTAL_CODE = "37500";
  process.env.FEDEX_SHIPPER_COUNTRY_CODE = "MX";
  process.env.FEDEX_SHIPPER_RESIDENTIAL = "false";
};

const input: FedexRateQuoteDto = {
  recipient: {
    streetLines: ["Blvd Adolfo Lopez Mateos 1810"],
    city: "Leon",
    stateOrProvinceCode: "GTO",
    postalCode: "37500",
    countryCode: "MX",
    residential: true,
  },
  packages: [
    {
      weightKg: 1.236,
      lengthCm: 30.1,
      widthCm: 20.2,
      heightCm: 10.3,
      declaredValue: 1000,
      quantity: 2,
    },
  ],
  carrierCodes: ["FDXE", "FDXG"],
  preferredCurrency: "MXN",
};

describe("FedEx public rates service", () => {
  beforeEach(() => {
    process.env = { ...originalEnv };
    setFedexEnv();
    jest.useFakeTimers().setSystemTime(new Date("2026-05-19T12:00:00.000Z"));
    jest.spyOn(console, "log").mockImplementation(() => undefined);
    jest.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("builds a minimal public rate payload with shipper defaults", async () => {
    const client = {
      post: jest.fn().mockResolvedValue({
        transactionId: "tx-123",
        output: {
          rateReplyDetails: [
            {
              serviceType: "FEDEX_EXPRESS_SAVER",
              serviceName: "FedEx Express Saver",
              packagingType: "YOUR_PACKAGING",
              deliveryTimestamp: "2026-05-23T20:00:00",
              transitTime: "THREE_DAYS",
              commit: {
                dateDetail: { dayOfWeek: "SATURDAY" },
                saturdayDelivery: false,
              },
              ratedShipmentDetails: [
                {
                  rateType: "LIST",
                  shipmentRateDetail: {
                    rateType: "LIST",
                    totalNetCharge: { amount: 220, currency: "MXN" },
                  },
                },
                {
                  rateType: "ACCOUNT",
                  shipmentRateDetail: {
                    rateType: "ACCOUNT",
                    totalNetCharge: { amount: 180.5, currency: "MXN" },
                    totalBaseCharge: { amount: 150, currency: "MXN" },
                    totalSurcharges: { amount: 20, currency: "MXN" },
                    totalTaxes: { amount: 10.5, currency: "MXN" },
                  },
                },
              ],
            },
          ],
          alerts: [],
        },
      }),
    };
    const service = new FedexRatesService(client);

    const result = await service.quotePublicRates(input);

    expect(client.post).toHaveBeenCalledWith(
      "/rate/v1/rates/quotes",
      expect.objectContaining({
        accountNumber: { value: "740561073" },
        carrierCodes: ["FDXE", "FDXG"],
        rateRequestControlParameters: {
          returnTransitTimes: true,
          servicesNeededOnRateFailure: true,
          rateSortOrder: "SERVICENAMETRADITIONAL",
        },
        requestedShipment: expect.objectContaining({
          preferredCurrency: "MXN",
          rateRequestType: ["ACCOUNT", "LIST"],
          shipDateStamp: "2026-05-20",
          pickupType: "DROPOFF_AT_FEDEX_LOCATION",
          packagingType: "YOUR_PACKAGING",
          totalPackageCount: 2,
          totalWeight: 2.47,
          documentShipment: false,
        }),
      }),
    );
    const payload = client.post.mock.calls[0][1] as any;
    expect(payload.requestedShipment.shipper.address).toMatchObject({
      postalCode: "37500",
      countryCode: "MX",
    });
    expect(payload.requestedShipment.requestedPackageLineItems[0]).toMatchObject({
      groupPackageCount: 2,
      weight: { units: "KG", value: 1.24 },
      dimensions: { length: 31, width: 21, height: 11, units: "CM" },
      declaredValue: { amount: 1000, currency: "NMP" },
    });
    expect(JSON.stringify((console.log as jest.Mock).mock.calls)).not.toContain(
      "740561073",
    );
    expect(result).toMatchObject({
      success: true,
      transactionId: "tx-123",
      currency: "MXN",
      quotes: [
        {
          provider: "FEDEX",
          serviceType: "FEDEX_EXPRESS_SAVER",
          amount: 180.5,
          accountAmount: 180.5,
          listAmount: 220,
          baseCharge: 150,
          surcharges: 20,
          taxes: 10.5,
          transitTime: "THREE_DAYS",
          deliveryTimestamp: "2026-05-23T20:00:00",
          deliveryDayOfWeek: "SATURDAY",
          saturdayDelivery: false,
          rateType: "ACCOUNT",
          rawRateTypes: ["LIST", "ACCOUNT"],
        },
      ],
      alerts: [],
    });
  });

  it("sorts quotes by amount and falls back to list rates", async () => {
    const client = {
      post: jest.fn().mockResolvedValue({
        output: {
          rateReplyDetails: [
            {
              serviceType: "EXPENSIVE",
              ratedShipmentDetails: [
                {
                  rateType: "LIST",
                  shipmentRateDetail: {
                    totalNetCharge: { amount: 300, currency: "MXN" },
                  },
                },
              ],
            },
            {
              serviceType: "CHEAP",
              ratedShipmentDetails: [
                {
                  rateType: "LIST",
                  shipmentRateDetail: {
                    totalNetCharge: { amount: 100, currency: "MXN" },
                  },
                },
              ],
            },
          ],
        },
      }),
    };
    const service = new FedexRatesService(client);

    const result = await service.quotePublicRates(input);

    expect(result.quotes.map((quote) => quote.serviceType)).toEqual([
      "CHEAP",
      "EXPENSIVE",
    ]);
  });

  it.each([
    [{ ...input, packages: [] }, "FEDEX_RATE_INPUT_ERROR"],
    [{ ...input, shipDateStamp: "2026-05-18" }, "FEDEX_RATE_INPUT_ERROR"],
    [
      {
        ...input,
        recipient: { ...input.recipient, stateOrProvinceCode: undefined },
      },
      "FEDEX_RATE_INPUT_ERROR",
    ],
    [{ ...input, includePickupRates: true }, "FEDEX_PICKUP_RATES_NOT_SUPPORTED_YET"],
  ])("rejects invalid input before FedEx", async (badInput, code) => {
    const client = { post: jest.fn() };
    const service = new FedexRatesService(client);

    await expect(service.quotePublicRates(badInput as any)).rejects.toMatchObject({
      code,
    });
    expect(client.post).not.toHaveBeenCalled();
  });

  it("throws FEDEX_RATE_UNAVAILABLE when no usable quote exists", async () => {
    const client = {
      post: jest.fn().mockResolvedValue({
        output: {
          rateReplyDetails: [
            {
              serviceType: "NO_PRICE",
              ratedShipmentDetails: [],
            },
          ],
        },
      }),
    };
    const service = new FedexRatesService(client);

    await expect(service.quotePublicRates(input)).rejects.toMatchObject({
      code: "FEDEX_RATE_UNAVAILABLE",
      statusCode: 422,
    });
  });

  it.each([
    [400, "FEDEX_RATE_BAD_REQUEST"],
    [401, "FEDEX_AUTH_FAILED"],
    [403, "FEDEX_FORBIDDEN"],
    [404, "FEDEX_NOT_FOUND"],
    [422, "FEDEX_RATE_UNPROCESSABLE"],
    [429, "FEDEX_RATE_LIMITED"],
    [500, "FEDEX_SERVICE_UNAVAILABLE"],
    [503, "FEDEX_SERVICE_UNAVAILABLE"],
  ])("maps provider status %s to a safe error", async (status, code) => {
    const client = {
      post: jest.fn().mockRejectedValue(
        new FedexProviderError({
          provider: "FEDEX",
          status,
          message: "raw provider payload",
        }),
      ),
    };
    const service = new FedexRatesService(client);

    await expect(service.quotePublicRates(input)).rejects.toMatchObject({
      code,
      statusCode: status,
    });
  });

  it("uses the controlled public error class", async () => {
    const service = new FedexRatesService({ post: jest.fn() });

    await expect(
      service.quotePublicRates({ ...input, includePickupRates: true }),
    ).rejects.toBeInstanceOf(FedexPublicRateError);
  });
});
