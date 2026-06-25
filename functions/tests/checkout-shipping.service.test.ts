import { CheckoutItemPricingSnapshot } from "../src/models/checkout-pricing.model";
import { CheckoutShippingService } from "../src/services/checkout/checkout-shipping.service";
import { FedexServiceAvailabilityError } from "../src/modules/shipping/fedex/fedex-service-availability.service";

describe("CheckoutShippingService", () => {
  const buildItem = (
    overrides: Partial<CheckoutItemPricingSnapshot> = {},
  ): CheckoutItemPricingSnapshot => ({
    productId: "prod-1",
    quantity: 1,
    unitPriceOriginal: 100,
    unitPriceFinal: 100,
    subtotalOriginal: 100,
    subtotalFinal: 100,
    discountTotal: 0,
    weightKg: 1,
    lengthCm: 30,
    widthCm: 20,
    heightCm: 10,
    requiereEnvio: true,
    ...overrides,
  });

  it("returns zero-cost shipping for pickup", async () => {
    const service = new CheckoutShippingService(
      {} as any,
      {} as any,
      {} as any,
    );

    await expect(
      service.calculateShipping({
        items: [buildItem()],
        shippingSelection: { method: "PICKUP" },
        currency: "MXN",
      }),
    ).resolves.toMatchObject({
      method: "PICKUP",
      amount: 0,
      currency: "MXN",
    });
  });

  it("returns manual FedEx shipping for Leon postal codes", async () => {
    const ratesService = { quotePublicRates: jest.fn() };
    const availabilityService = { retrieveServicesAndTransitTimes: jest.fn() };
    const service = new CheckoutShippingService(
      {} as any,
      ratesService as any,
      availabilityService as any,
    );

    await expect(
      service.calculateShipping({
        items: [buildItem()],
        shippingSelection: { method: "MANUAL", provider: "MANUAL" },
        shippingAddress: {
          streetLines: ["Calle 1"],
          city: "Leon",
          stateOrProvinceCode: "GTO",
          postalCode: "37500",
          countryCode: "MX",
          residential: true,
        },
        currency: "MXN",
      }),
    ).resolves.toMatchObject({
      method: "MANUAL",
      provider: "MANUAL",
      carrier: "FEDEX",
      shippingMethod: "manual_fedex",
      amount: 99,
      currency: "MXN",
      shippingZone: "LEON",
      status: "pending_manual_shipment",
      createdManually: true,
    });

    expect(ratesService.quotePublicRates).not.toHaveBeenCalled();
    expect(availabilityService.retrieveServicesAndTransitTimes).not.toHaveBeenCalled();
  });

  it("returns manual FedEx shipping for outside Leon postal codes", async () => {
    const service = new CheckoutShippingService(
      {} as any,
      {} as any,
      {} as any,
    );

    await expect(
      service.calculateShipping({
        items: [buildItem()],
        shippingSelection: { method: "MANUAL", provider: "MANUAL" },
        shippingAddress: {
          streetLines: ["Calle 1"],
          city: "Guadalajara",
          stateOrProvinceCode: "JAL",
          postalCode: "44100",
          countryCode: "MX",
          residential: true,
        },
        currency: "MXN",
      }),
    ).resolves.toMatchObject({
      method: "MANUAL",
      amount: 299,
      shippingZone: "OUTSIDE_LEON",
    });
  });

  it("throws when a shippable product lacks dimensions", async () => {
    const service = new CheckoutShippingService(
      {} as any,
      {} as any,
      {} as any,
    );

    await expect(
      service.calculateShipping({
        items: [buildItem({ weightKg: undefined })],
        shippingSelection: { method: "FEDEX", serviceType: "FEDEX_GROUND" },
        shippingAddress: {
          streetLines: ["Calle 1"],
          city: "Leon",
          stateOrProvinceCode: "GTO",
          postalCode: "37500",
          countryCode: "MX",
          residential: true,
        },
        currency: "MXN",
      }),
    ).rejects.toMatchObject({
      code: "PRODUCT_SHIPPING_DATA_MISSING",
    });
  });

  it("rejects stale quotes when recalculated rate changed materially", async () => {
    const ratesService = {
      quotePublicRates: jest.fn().mockResolvedValue({
        success: true,
        transactionId: "tx-1",
        currency: "MXN",
        alerts: [],
        quotes: [
          {
            provider: "FEDEX",
            serviceType: "FEDEX_GROUND",
            serviceName: "FedEx Ground",
            currency: "MXN",
            amount: 120,
            rateType: "ACCOUNT",
            rawRateTypes: ["ACCOUNT"],
          },
        ],
      }),
    };
    const availabilityService = {
      retrieveServicesAndTransitTimes: jest.fn().mockResolvedValue({
        success: true,
        transactionId: "av-1",
        services: [{ serviceType: "FEDEX_GROUND", carrierCode: "FDXG" }],
      }),
    };
    const service = new CheckoutShippingService(
      {} as any,
      ratesService as any,
      availabilityService as any,
    );

    await expect(
      service.calculateShipping({
        items: [buildItem()],
        shippingSelection: {
          method: "FEDEX",
          serviceType: "FEDEX_GROUND",
          quotedAmount: 100,
        },
        shippingAddress: {
          streetLines: ["Calle 1"],
          city: "Leon",
          stateOrProvinceCode: "GTO",
          postalCode: "37500",
          countryCode: "MX",
          residential: true,
        },
        currency: "MXN",
      }),
    ).rejects.toMatchObject({
      code: "SHIPPING_RATE_CHANGED",
    });
  });

  it("keeps going with warnings when service availability is temporarily unavailable", async () => {
    const ratesService = {
      quotePublicRates: jest.fn().mockResolvedValue({
        success: true,
        transactionId: "tx-1",
        currency: "MXN",
        alerts: [],
        quotes: [
          {
            provider: "FEDEX",
            serviceType: "FEDEX_GROUND",
            serviceName: "FedEx Ground",
            currency: "MXN",
            amount: 100,
            rateType: "ACCOUNT",
            rawRateTypes: ["ACCOUNT"],
          },
        ],
      }),
    };
    const availabilityService = {
      retrieveServicesAndTransitTimes: jest
        .fn()
        .mockRejectedValue(
          new FedexServiceAvailabilityError(
            "FEDEX_SERVICE_UNAVAILABLE",
            "FedEx no esta disponible temporalmente.",
            503,
          ),
        ),
    };
    const service = new CheckoutShippingService(
      {} as any,
      ratesService as any,
      availabilityService as any,
    );

    await expect(
      service.calculateShipping({
        items: [buildItem()],
        shippingSelection: {
          method: "FEDEX",
          serviceType: "FEDEX_GROUND",
          quotedAmount: 100,
        },
        shippingAddress: {
          streetLines: ["Calle 1"],
          city: "Leon",
          stateOrProvinceCode: "GTO",
          postalCode: "37500",
          countryCode: "MX",
          residential: true,
        },
        currency: "MXN",
      }),
    ).resolves.toMatchObject({
      method: "FEDEX",
      amount: 100,
      warnings: ["FedEx no esta disponible temporalmente."],
    });
  });
});
