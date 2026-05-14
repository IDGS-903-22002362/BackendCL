import {
  getFedexShipperConfig,
  mapFedexShipRequest,
  mapFedexShipResponse,
} from "../src/modules/shipping/fedex/fedex-ship.mapper";
import { FedexShipRequestInput } from "../src/modules/shipping/fedex/fedex-ship.types";

const originalEnv = { ...process.env };

const setFedexEnv = () => {
  process.env.FEDEX_ENV = "sandbox";
  process.env.FEDEX_BASE_URL = "https://apis-sandbox.fedex.com";
  process.env.FEDEX_CLIENT_ID = "client-id";
  process.env.FEDEX_CLIENT_SECRET = "client-secret";
  process.env.FEDEX_ACCOUNT_NUMBER = "740561073";
  process.env.FEDEX_SHIPPER_NAME = "Club León Fulfillment";
  process.env.FEDEX_SHIPPER_COMPANY = "Club León";
  process.env.FEDEX_SHIPPER_PHONE = "4771234567";
  process.env.FEDEX_SHIPPER_EMAIL = "shipping@example.com";
  process.env.FEDEX_SHIPPER_STREET_1 = "Blvd Adolfo López Mateos 1810";
  process.env.FEDEX_SHIPPER_STREET_2 = "Colonia La Martinica";
  process.env.FEDEX_SHIPPER_CITY = "León";
  process.env.FEDEX_SHIPPER_STATE = "GUA";
  process.env.FEDEX_SHIPPER_POSTAL_CODE = "37500";
  process.env.FEDEX_SHIPPER_COUNTRY_CODE = "MX";
};

const shipInput: FedexShipRequestInput = {
  orderId: "orden_123",
  serviceType: "FEDEX_EXPRESS_SAVER",
  labelImageType: "PDF",
  shipDate: "2026-05-12",
  recipient: {
    name: "José Pérez",
    phone: "4777654321",
    email: "jose@example.com",
    streetLines: ["Calle  Uno  123", "Colonia Centro"],
    city: "León",
    stateOrProvinceCode: "GUA",
    postalCode: "37000",
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
};

describe("FedEx ship mapper", () => {
  beforeEach(() => {
    process.env = { ...originalEnv };
    setFedexEnv();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("validates shipper env with a clear message", () => {
    delete process.env.FEDEX_SHIPPER_PHONE;

    expect(() => getFedexShipperConfig()).toThrow(
      "Missing FedEx shipper environment variable: FEDEX_SHIPPER_PHONE",
    );
  });

  it("builds a safe FedEx ship request from backend-controlled data", () => {
    const request = mapFedexShipRequest(shipInput);
    const serialized = JSON.stringify(request);

    expect(request.accountNumber.value).toBe("740561073");
    expect(request.labelResponseOptions).toBe("LABEL");
    expect(request.requestedShipment.shippingChargesPayment.paymentType).toBe(
      "SENDER",
    );
    expect(request.requestedShipment.shipper.contact.personName).toBe(
      "Club Leon Fulfillment",
    );
    expect(request.requestedShipment.recipients[0].contact.personName).toBe(
      "Jose Perez",
    );
    expect(serialized).not.toContain("client-secret");
    expect(serialized).not.toContain("access_token");
  });

  it("rounds package values and rejects invalid packages", () => {
    const request = mapFedexShipRequest(shipInput);
    const firstPackage = request.requestedShipment.requestedPackageLineItems[0];

    expect(firstPackage.weight).toEqual({ units: "KG", value: 1.24 });
    expect(firstPackage.dimensions).toEqual({
      length: 31,
      width: 26,
      height: 11,
      units: "CM",
    });

    expect(() =>
      mapFedexShipRequest({
        ...shipInput,
        packages: [{ weightKg: 0, lengthCm: 30, widthCm: 25, heightCm: 10 }],
      }),
    ).toThrow("FedEx shipment packages require positive weight and dimensions");
  });

  it("extracts tracking and encoded label without exposing raw response", () => {
    const label = Buffer.from("%PDF-test").toString("base64");
    const result = mapFedexShipResponse(shipInput, {
      output: {
        alerts: [{ message: "Sandbox warning" }],
        transactionShipments: [
          {
            masterTrackingNumber: "1234567890",
            serviceType: "FEDEX_EXPRESS_SAVER",
            pieceResponses: [
              {
                trackingNumber: "1234567890",
                packageDocuments: [{ encodedLabel: label }],
              },
            ],
          },
        ],
      },
    });

    expect(result).toMatchObject({
      provider: "FEDEX",
      environment: "sandbox",
      trackingNumber: "1234567890",
      masterTrackingNumber: "1234567890",
      serviceType: "FEDEX_EXPRESS_SAVER",
      warnings: ["Sandbox warning"],
    });
    expect(result.labelBuffer.toString()).toBe("%PDF-test");
    expect(JSON.stringify(result)).not.toContain(label);
  });
});
