import {
  mapFedexTrackRequest,
  mapFedexTrackResponse,
} from "../src/modules/shipping/fedex/fedex-track.mapper";
import { fedexTrackDirectSchema } from "../src/modules/shipping/fedex/fedex-track.types";

describe("FedEx track mapper", () => {
  it("validates and normalizes tracking numbers", () => {
    const parsed = fedexTrackDirectSchema.parse({
      trackingNumbers: [" 123 456-ABC "],
      includeDetailedScans: true,
    });

    expect(parsed.trackingNumbers).toEqual(["123456-ABC"]);
    expect(parsed.includeDetailedScans).toBe(true);
    expect(() =>
      fedexTrackDirectSchema.parse({ trackingNumbers: ["***"] }),
    ).toThrow("trackingNumber contains invalid characters");
    expect(() =>
      fedexTrackDirectSchema.parse({
        trackingNumbers: Array.from({ length: 31 }, (_, index) => String(index)),
      }),
    ).toThrow("trackingNumbers can contain at most 30 tracking numbers");
  });

  it("builds FedEx tracking request payload", () => {
    expect(
      mapFedexTrackRequest({
        trackingNumbers: ["123", "456"],
        includeDetailedScans: false,
      }),
    ).toEqual({
      includeDetailedScans: false,
      trackingInfo: [
        { trackingNumberInfo: { trackingNumber: "123" } },
        { trackingNumberInfo: { trackingNumber: "456" } },
      ],
    });
  });

  it.each([
    ["DL", "Delivered", "DELIVERED", "Entregado"],
    ["IT", "In transit", "IN_TRANSIT", "En tránsito"],
    ["OD", "On vehicle for delivery", "OUT_FOR_DELIVERY", "En reparto"],
    ["SE", "Shipment exception", "EXCEPTION", "Incidencia"],
    ["OC", "Shipment information sent", "LABEL_CREATED", "Guía creada"],
  ])("maps FedEx status %s to %s", (code, description, status, label) => {
    const result = mapFedexTrackResponse("123", {
      output: {
        completeTrackResults: [
          {
            trackingNumber: "123",
            trackResults: [
              {
                trackingNumberInfo: { trackingNumber: "123" },
                latestStatusDetail: {
                  code,
                  description,
                  statusByLocale: description,
                  scanLocation: {
                    city: "Leon",
                    stateOrProvinceCode: "GUA",
                    countryCode: "MX",
                  },
                },
                dateAndTimes: [
                  { type: "SHIP", dateTime: "2026-05-12T10:00:00Z" },
                  {
                    type: "ESTIMATED_DELIVERY",
                    dateTime: "2026-05-15T18:00:00Z",
                  },
                ],
                scanEvents: [
                  {
                    date: "2026-05-12T10:30:00Z",
                    eventType: code,
                    eventDescription: description,
                    scanLocation: { city: "Leon", countryCode: "MX" },
                  },
                ],
                serviceDetail: { type: "FEDEX_EXPRESS_SAVER" },
                packageDetails: { count: 1 },
                recipientInformation: {
                  address: { city: "Ciudad de Mexico", countryCode: "MX" },
                },
              },
            ],
          },
        ],
      },
    });

    expect(result.status).toBe(status);
    expect(result.statusLabel).toBe(label);
    expect(result.events).toHaveLength(1);
    expect(result.estimatedDeliveryDate).toBe("2026-05-15");
    expect(result.serviceType).toBe("FEDEX_EXPRESS_SAVER");
  });

  it("returns label-created when FedEx has no events yet", () => {
    const result = mapFedexTrackResponse("123", { output: {} }, "order_1");

    expect(result).toMatchObject({
      ok: true,
      orderId: "order_1",
      trackingNumber: "123",
      status: "LABEL_CREATED",
      message: "FedEx aún no tiene eventos de rastreo disponibles para esta guía",
    });
  });
});
