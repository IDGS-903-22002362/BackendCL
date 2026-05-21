import { FedexProviderError } from "../src/modules/shipping/fedex/fedex.errors";
import {
  FedexServiceAvailabilityError,
  FedexServiceAvailabilityService,
} from "../src/modules/shipping/fedex/fedex-service-availability.service";
import { FedexServiceAvailabilityDto } from "../src/modules/shipping/fedex/fedex-service-availability.types";

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
  process.env.FEDEX_SHIPPER_STREET_1 = "Blvd Adolfo Lopez Mateos";
  process.env.FEDEX_SHIPPER_STREET_2 = "La Martinica";
  process.env.FEDEX_SHIPPER_CITY = "Leon";
  process.env.FEDEX_SHIPPER_STATE_OR_PROVINCE_CODE = "GTO";
  process.env.FEDEX_SHIPPER_POSTAL_CODE = "37500";
  process.env.FEDEX_SHIPPER_COUNTRY_CODE = "MX";
  process.env.FEDEX_SHIPPER_RESIDENTIAL = "false";
};

const input: FedexServiceAvailabilityDto = {
  recipient: {
    streetLines: ["Blvd Adolfo Lopez Mateos 1810"],
    city: "Leon",
    stateOrProvinceCode: "GTO",
    postalCode: "37000",
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

describe("FedEx service availability service", () => {
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

  it("builds a clean availability payload with defaults", async () => {
    const client = {
      post: jest.fn().mockResolvedValue({
        transactionId: "tx-123",
        output: {
          services: [
            {
              serviceType: "FEDEX_EXPRESS_SAVER",
              serviceName: "FedEx Express Saver",
              carrierCode: "FDXE",
              packagingType: "YOUR_PACKAGING",
              transitTime: "THREE_DAYS",
              deliveryDate: "2026-05-23",
              specialServices: ["SATURDAY_DELIVERY"],
              signatureOptions: ["SERVICE_DEFAULT"],
              returnShipmentTypes: [],
            },
          ],
          alerts: [],
        },
      }),
    };
    const service = new FedexServiceAvailabilityService(client);

    const result = await service.retrieveServicesAndTransitTimes(input);

    expect(client.post).toHaveBeenCalledWith(
      "/availability/v1/transittimes",
      expect.objectContaining({
        carrierCodes: ["FDXE", "FDXG"],
        requestedShipment: expect.objectContaining({
          shipDatestamp: "2026-05-20",
          packagingType: "YOUR_PACKAGING",
          pickupType: "DROPOFF_AT_FEDEX_LOCATION",
          shippingChargesPayment: {
            paymentType: "SENDER",
            payor: {
              responsibleParty: {
                accountNumber: { value: "740561073" },
              },
            },
          },
        }),
      }),
    );
    const payload = client.post.mock.calls[0][1] as any;
    expect(payload.requestedShipment.requestedPackageLineItems[0]).toMatchObject({
      groupPackageCount: 2,
      physicalPackaging: "YOUR_PACKAGING",
      weight: { units: "KG", value: 1.24 },
      dimensions: { length: 31, width: 21, height: 11, units: "CM" },
      declaredValue: { amount: 1000, currency: "MXN" },
    });
    expect(JSON.stringify((console.log as jest.Mock).mock.calls)).not.toContain(
      "740561073",
    );
    expect(result).toMatchObject({
      success: true,
      transactionId: "tx-123",
      services: [
        {
          provider: "FEDEX",
          serviceType: "FEDEX_EXPRESS_SAVER",
          serviceName: "FedEx Express Saver",
          carrierCode: "FDXE",
          packagingType: "YOUR_PACKAGING",
          transitTime: "THREE_DAYS",
          deliveryDate: "2026-05-23",
          specialServices: ["SATURDAY_DELIVERY"],
          signatureOptions: ["SERVICE_DEFAULT"],
          returnShipmentTypes: [],
        },
      ],
      alerts: [],
    });
  });

  it("allows packages with only weight and omits carrierCodes by default", async () => {
    const client = {
      post: jest.fn().mockResolvedValue({
        output: {
          serviceOptions: [{ serviceType: "FEDEX_GROUND" }],
        },
      }),
    };
    const service = new FedexServiceAvailabilityService(client);

    await service.retrieveServicesAndTransitTimes({
      recipient: input.recipient,
      packages: [{ weightKg: 1 }],
    });

    const payload = client.post.mock.calls[0][1] as any;
    expect(payload).not.toHaveProperty("carrierCodes");
    expect(payload.requestedShipment.requestedPackageLineItems[0]).not.toHaveProperty(
      "dimensions",
    );
  });

  it("normalizes services from all supported output keys and ignores entries without serviceType", async () => {
    const client = {
      post: jest.fn().mockResolvedValue({
        output: {
          services: [{ serviceType: "A", serviceName: "A" }],
          serviceOptions: [{ serviceType: "B" }],
          availableServices: [{ serviceName: "missing type" }],
          transitTimes: [
            {
              serviceType: "C",
              commit: {
                dateDetail: { dayOfWeek: "SATURDAY", dayFormat: "2026-05-23" },
                saturdayDelivery: false,
              },
            },
          ],
        },
      }),
    };
    const service = new FedexServiceAvailabilityService(client);

    const result = await service.retrieveServicesAndTransitTimes(input);

    expect(result.services.map((item) => item.serviceType)).toEqual([
      "A",
      "B",
      "C",
    ]);
    expect(result.services[2]).toMatchObject({
      deliveryDate: "2026-05-23",
      deliveryDayOfWeek: "SATURDAY",
      saturdayDelivery: false,
    });
  });

  it("requires commodities for international availability", async () => {
    const client = { post: jest.fn() };
    const service = new FedexServiceAvailabilityService(client);

    await expect(
      service.retrieveServicesAndTransitTimes({
        ...input,
        recipient: {
          city: "Toronto",
          stateOrProvinceCode: "ON",
          postalCode: "M1M1M1",
          countryCode: "CA",
          residential: true,
        },
      }),
    ).rejects.toMatchObject({
      code: "FEDEX_AVAILABILITY_COMMODITIES_REQUIRED",
      statusCode: 400,
    });
    expect(client.post).not.toHaveBeenCalled();
  });

  it.each([
    [{ ...input, packages: [] }, "FEDEX_AVAILABILITY_INPUT_ERROR"],
    [{ ...input, packages: Array.from({ length: 21 }, () => ({ weightKg: 1 })) }, "FEDEX_AVAILABILITY_INPUT_ERROR"],
    [{ ...input, shipDatestamp: "2026-05-18" }, "FEDEX_AVAILABILITY_INPUT_ERROR"],
    [
      {
        ...input,
        recipient: { ...input.recipient, stateOrProvinceCode: undefined },
      },
      "FEDEX_AVAILABILITY_INPUT_ERROR",
    ],
  ])("rejects invalid input before FedEx", async (badInput, code) => {
    const client = { post: jest.fn() };
    const service = new FedexServiceAvailabilityService(client);

    await expect(
      service.retrieveServicesAndTransitTimes(badInput as any),
    ).rejects.toMatchObject({ code });
    expect(client.post).not.toHaveBeenCalled();
  });

  it("throws controlled no services error when FedEx returns no usable services", async () => {
    const client = {
      post: jest.fn().mockResolvedValue({
        output: {
          services: [{ serviceName: "Missing type" }],
        },
      }),
    };
    const service = new FedexServiceAvailabilityService(client);

    await expect(
      service.retrieveServicesAndTransitTimes(input),
    ).rejects.toMatchObject({
      code: "FEDEX_AVAILABILITY_NO_SERVICES",
      statusCode: 422,
    });
  });

  it.each([
    [400, "FEDEX_AVAILABILITY_BAD_REQUEST"],
    [401, "FEDEX_AUTH_FAILED"],
    [403, "FEDEX_FORBIDDEN"],
    [404, "FEDEX_NOT_FOUND"],
    [422, "FEDEX_AVAILABILITY_UNPROCESSABLE"],
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
    const service = new FedexServiceAvailabilityService(client);

    await expect(
      service.retrieveServicesAndTransitTimes(input),
    ).rejects.toMatchObject({
      code,
      statusCode: status,
    });
  });

  it("uses controlled error class", async () => {
    const service = new FedexServiceAvailabilityService({ post: jest.fn() });

    await expect(
      service.retrieveServicesAndTransitTimes({ ...input, packages: [] }),
    ).rejects.toBeInstanceOf(FedexServiceAvailabilityError);
  });
});
