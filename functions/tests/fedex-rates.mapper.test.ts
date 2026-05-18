import { getFedexConfig } from "../src/modules/shipping/fedex/fedex.config";
import {
  mapFedexRateRequest,
  mapFedexRateResponse,
} from "../src/modules/shipping/fedex/fedex-rates.mapper";
import {
  fedexRateQuoteSchema,
  FedexRateQuoteInput,
} from "../src/modules/shipping/fedex/fedex-rates.types";

const originalEnv = { ...process.env };

const baseInput: FedexRateQuoteInput = {
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
      weightKg: 1.236,
      lengthCm: 30.1,
      widthCm: 25.2,
      heightCm: 10.3,
    },
  ],
  shipDate: "2026-05-12",
  currency: "MXN",
  rateRequestTypes: ["ACCOUNT", "LIST"],
};

describe("FedEx rates mapper", () => {
  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.FEDEX_ENV = "sandbox";
    process.env.FEDEX_BASE_URL = "https://apis-sandbox.fedex.com";
    process.env.FEDEX_CLIENT_ID = "client-id";
    process.env.FEDEX_CLIENT_SECRET = "client-secret";
    process.env.FEDEX_ACCOUNT_NUMBER = "740561073";
    delete process.env.FEDEX_SERVICE_TYPE;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("validates required fields with clear messages", () => {
    expect(() =>
      fedexRateQuoteSchema.parse({
        origin: { countryCode: "MX" },
        destination: { postalCode: "06100", countryCode: "MX" },
        packages: [],
      }),
    ).toThrow("origin.postalCode is required");

    expect(() =>
      fedexRateQuoteSchema.parse({
        origin: { postalCode: "37150", countryCode: "MX" },
        destination: { countryCode: "MX" },
        packages: [],
      }),
    ).toThrow("destination.postalCode is required");

    expect(() =>
      fedexRateQuoteSchema.parse({
        origin: { postalCode: "37150", countryCode: "MX" },
        destination: { postalCode: "06100", countryCode: "MX" },
        packages: [],
      }),
    ).toThrow("packages must contain at least one package");

    expect(() =>
      fedexRateQuoteSchema.parse({
        origin: { postalCode: "37150", countryCode: "MX" },
        destination: { postalCode: "06100", countryCode: "MX" },
        packages: [
          { weightKg: 0, lengthCm: 30, widthCm: 25, heightCm: 10 },
        ],
      }),
    ).toThrow("weightKg must be greater than 0");
  });

  it("maps request using backend account number and transit times", () => {
    const request = mapFedexRateRequest(baseInput);

    expect(request.accountNumber.value).toBe(getFedexConfig().accountNumber);
    expect(request.rateRequestControlParameters.returnTransitTimes).toBe(true);
    expect(request.requestedShipment.pickupType).toBe(
      "USE_SCHEDULED_PICKUP",
    );
    expect(request.requestedShipment.packagingType).toBe("YOUR_PACKAGING");
    expect(request.requestedShipment.rateRequestType).toEqual(["ACCOUNT", "LIST"]);
    expect(request.requestedShipment.preferredCurrency).toBe("MXN");
    expect(request.requestedShipment.totalPackageCount).toBe(1);
  });

  it("rounds package dimensions and weight for FedEx", () => {
    const request = mapFedexRateRequest(baseInput);
    const firstPackage = request.requestedShipment.requestedPackageLineItems[0];

    expect(firstPackage.weight).toEqual({ units: "KG", value: 1.24 });
    expect(firstPackage.dimensions).toEqual({
      length: 31,
      width: 26,
      height: 11,
      units: "CM",
    });
  });

  it("omits serviceType unless FEDEX_SERVICE_TYPE is configured", () => {
    expect(mapFedexRateRequest(baseInput).requestedShipment.serviceType).toBeUndefined();

    expect(
      mapFedexRateRequest({
        ...baseInput,
        serviceType: "FEDEX_EXPRESS_SAVER",
      }).requestedShipment.serviceType,
    ).toBeUndefined();

    for (const emptyValue of ["", " ", "null", "undefined"]) {
      process.env.FEDEX_SERVICE_TYPE = emptyValue;
      expect(mapFedexRateRequest(baseInput).requestedShipment.serviceType).toBeUndefined();
    }

    process.env.FEDEX_SERVICE_TYPE = " fedex_express_saver ";
    expect(mapFedexRateRequest(baseInput).requestedShipment.serviceType).toBe(
      "FEDEX_EXPRESS_SAVER",
    );
  });

  it("omits invalid and blocked FEDEX_SERVICE_TYPE values", () => {
    jest.spyOn(console, "warn").mockImplementation(() => undefined);

    process.env.FEDEX_SERVICE_TYPE = "FEDEX EXPRESS SAVER";
    expect(mapFedexRateRequest(baseInput).requestedShipment.serviceType).toBeUndefined();

    for (const blockedValue of [
      "FEDEX_ONE_RATE",
      "SMART_POST",
      "FEDEX_GROUND_ECONOMY",
      "GROUND_HOME_DELIVERY",
      "FEDEX_GROUND",
    ]) {
      process.env.FEDEX_SERVICE_TYPE = blockedValue;
      expect(mapFedexRateRequest(baseInput).requestedShipment.serviceType).toBeUndefined();
    }
  });

  it("normalizes response, prefers ACCOUNT, filters invalid amounts, and sorts", () => {
    const options = mapFedexRateResponse(
      {
        output: {
          rateReplyDetails: [
            {
              serviceType: "EXPENSIVE",
              serviceName: "Expensive",
              packagingType: "YOUR_PACKAGING",
              deliveryTimestamp: "2026-05-16T12:00:00",
              transitTime: "THREE_DAYS",
              ratedShipmentDetails: [
                {
                  rateType: "LIST",
                  shipmentRateDetail: {
                    totalNetCharge: { amount: 500, currency: "MXN" },
                    rateType: "LIST",
                  },
                },
                {
                  rateType: "ACCOUNT",
                  shipmentRateDetail: {
                    totalNetCharge: { amount: 250, currency: "MXN" },
                    rateType: "ACCOUNT",
                    surcharges: [
                      {
                        surchargeType: "FUEL",
                        description: "Fuel",
                        amount: { amount: 20, currency: "MXN" },
                      },
                    ],
                  },
                },
              ],
            },
            {
              serviceType: "INVALID",
              ratedShipmentDetails: [
                {
                  shipmentRateDetail: {
                    totalNetCharge: { amount: 0, currency: "MXN" },
                  },
                },
              ],
            },
            {
              serviceType: "CHEAP",
              serviceDescription: { description: "Cheap service" },
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
      },
      "MXN",
    );

    expect(options.map((option) => option.serviceType)).toEqual([
      "CHEAP",
      "EXPENSIVE",
    ]);
    expect(options[1]).toMatchObject({
      amount: 250,
      rateType: "ACCOUNT",
      estimatedDeliveryDate: "2026-05-16",
      surcharges: [{ type: "FUEL", amount: 20, currency: "MXN" }],
    });
  });
});
