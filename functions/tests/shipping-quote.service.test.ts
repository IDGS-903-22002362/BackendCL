jest.mock("../src/modules/shipping/fedex/fedex-address.service", () => ({
  fedexAddressService: {
    validatePostalCode: jest.fn(),
  },
}));

jest.mock("../src/modules/shipping/fedex/fedex-availability.service", () => ({
  fedexAvailabilityService: {
    checkAvailability: jest.fn(),
  },
}));

import { ShippingQuoteService } from "../src/modules/shipping/shipping-quote.service";
import { FedexProviderError } from "../src/modules/shipping/fedex/fedex.errors";
import { fedexAddressService } from "../src/modules/shipping/fedex/fedex-address.service";
import { fedexAvailabilityService } from "../src/modules/shipping/fedex/fedex-availability.service";

const originalEnv = { ...process.env };

const setFedexEnv = () => {
  process.env.FEDEX_ENV = "sandbox";
  process.env.FEDEX_BASE_URL = "https://apis-sandbox.fedex.com";
  process.env.FEDEX_CLIENT_ID = "client-id";
  process.env.FEDEX_CLIENT_SECRET = "client-secret";
  process.env.FEDEX_ACCOUNT_NUMBER = "740561073";
  process.env.FEDEX_SHIPPER_NAME = "Club Leon Fulfillment";
  process.env.FEDEX_SHIPPER_PHONE = "4771234567";
  process.env.FEDEX_SHIPPER_STREET_1 = "Blvd Adolfo Lopez Mateos 1810";
  process.env.FEDEX_SHIPPER_CITY = "Leon";
  process.env.FEDEX_SHIPPER_STATE = "GUA";
  process.env.FEDEX_SHIPPER_POSTAL_CODE = "37500";
  process.env.FEDEX_SHIPPER_COUNTRY_CODE = "MX";
};

const cart = {
  id: "cart_1",
  usuarioId: "user_1",
  items: [{ productoId: "prod_1", cantidad: 1, precioUnitario: 100 }],
  subtotal: 100,
  total: 100,
} as any;

const address = {
  nombre: "Juan Perez",
  telefono: "4771234567",
  calle: "Uno",
  numero: "1",
  colonia: "Centro",
  ciudad: "León de los Aldama",
  estado: "GUA",
  codigoPostal: "37208",
};

const buildDb = (product: Record<string, unknown>) => {
  const setQuote = jest.fn().mockResolvedValue(undefined);
  const db = {
    collection: jest.fn((name: string) => {
      if (name === "productos") {
        return {
          doc: jest.fn(() => ({
            get: jest.fn().mockResolvedValue({
              exists: true,
              data: () => product,
            }),
          })),
        };
      }

      return {
        doc: jest.fn(() => ({
          set: setQuote,
        })),
      };
    }),
  };

  return { db, setQuote };
};

describe("ShippingQuoteService FedEx packages", () => {
  beforeEach(() => {
    process.env = { ...originalEnv };
    setFedexEnv();
    jest.mocked(fedexAddressService.validatePostalCode).mockResolvedValue(true);
    jest.mocked(fedexAvailabilityService.checkAvailability).mockResolvedValue([]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("resolves product dimensions from Firestore and stores normalized packages", async () => {
    const { db, setQuote } = buildDb({
      descripcion: "Tarro grande",
      categoriaId: "tarros",
      activo: true,
      fedexShipping: {
        enabled: true,
        weightKg: 0.9,
        lengthCm: 20,
        widthCm: 20,
        heightCm: 20,
      },
    });
    const ratesService = {
      quoteRates: jest.fn().mockResolvedValue({
        ok: true,
        provider: "FEDEX",
        environment: "sandbox",
        quoteId: "quote_1",
        currency: "MXN",
        options: [
          {
            provider: "FEDEX",
            serviceType: "FEDEX_EXPRESS_SAVER",
            serviceName: "FedEx Express Saver",
            packagingType: "YOUR_PACKAGING",
            amount: 120,
            currency: "MXN",
            surcharges: [],
          },
        ],
      }),
    };
    const service = new ShippingQuoteService(db as any, ratesService as any);

    const result = await service.createFedexCartQuote({
      userId: "user_1",
      cart,
      direccionEnvio: address,
    });

    expect(ratesService.quoteRates).toHaveBeenCalledWith(
      expect.objectContaining({
        origin: expect.objectContaining({
          city: "Leon",
          postalCode: "37500",
          countryCode: "MX",
          residential: false,
        }),
        destination: expect.objectContaining({
          city: "Leon",
          postalCode: "37208",
          countryCode: "MX",
          residential: true,
        }),
        rateRequestTypes: ["ACCOUNT", "LIST"],
        packages: [
          { weightKg: 0.9, lengthCm: 20, widthCm: 20, heightCm: 20 },
        ],
      }),
    );
    expect(setQuote).toHaveBeenCalledWith(
      expect.objectContaining({
        packages: [
          { weightKg: 0.9, lengthCm: 20, widthCm: 20, heightCm: 20 },
        ],
      }),
    );
    expect(result).toMatchObject({
      requiresShipping: true,
      quoteId: "quote_1",
    });
  });

  it("passes postal validation roles and continues to Rate API when MX postal validation fails", async () => {
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
    jest.mocked(fedexAddressService.validatePostalCode)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false);

    const { db } = buildDb({
      descripcion: "Tarro grande",
      categoriaId: "tarros",
      activo: true,
      fedexShipping: {
        enabled: true,
        weightKg: 0.9,
        lengthCm: 20,
        widthCm: 20,
        heightCm: 20,
      },
    });
    const ratesService = {
      quoteRates: jest.fn().mockResolvedValue({
        ok: true,
        provider: "FEDEX",
        environment: "sandbox",
        quoteId: "quote_2",
        currency: "MXN",
        options: [
          {
            provider: "FEDEX",
            serviceType: "FEDEX_EXPRESS_SAVER",
            serviceName: "FedEx Express Saver",
            packagingType: "YOUR_PACKAGING",
            amount: 120,
            currency: "MXN",
            surcharges: [],
          },
        ],
      }),
    };
    const service = new ShippingQuoteService(db as any, ratesService as any);

    await service.createFedexCartQuote({
      userId: "user_1",
      cart,
      direccionEnvio: address,
    });

    expect(fedexAddressService.validatePostalCode).toHaveBeenCalledWith(
      expect.objectContaining({
        role: "ORIGIN",
        countryCode: "MX",
        postalCode: "37500",
        carrierCode: "FDXE",
      }),
    );
    expect(fedexAddressService.validatePostalCode).toHaveBeenCalledWith(
      expect.objectContaining({
        role: "DESTINATION",
        countryCode: "MX",
        postalCode: "37208",
        carrierCode: "FDXE",
      }),
    );
    expect(ratesService.quoteRates).toHaveBeenCalledWith(
      expect.not.objectContaining({
        serviceType: expect.anything(),
        carrierCodes: expect.anything(),
      }),
    );
    expect(ratesService.quoteRates).toHaveBeenCalledTimes(1);
  });

  it("does not call FedEx when all cart products are non-shippable", async () => {
    const { db } = buildDb({
      descripcion: "Membresia digital",
      activo: true,
      fedexShipping: { enabled: false },
    });
    const ratesService = { quoteRates: jest.fn() };
    const service = new ShippingQuoteService(db as any, ratesService as any);

    const result = await service.createFedexCartQuote({
      userId: "user_1",
      cart,
      direccionEnvio: address,
    });

    expect(ratesService.quoteRates).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      requiresShipping: false,
      options: [],
    });
  });

  it("returns a controlled code when dimensions are missing", async () => {
    const { db } = buildDb({
      descripcion: "Tarro grande",
      activo: true,
    });
    const service = new ShippingQuoteService(db as any, { quoteRates: jest.fn() } as any);

    await expect(
      service.createFedexCartQuote({
        userId: "user_1",
        cart,
        direccionEnvio: address,
      }),
    ).rejects.toMatchObject({
      name: "ShippingQuoteError",
      code: "FEDEX_PRODUCT_DIMENSIONS_MISSING",
      statusCode: 422,
    });
  });

  it("wraps FedEx provider rate errors as controlled quote errors", async () => {
    const { db } = buildDb({
      descripcion: "Tarro grande",
      categoriaId: "tarros",
      activo: true,
      fedexShipping: {
        enabled: true,
        weightKg: 0.9,
        lengthCm: 20,
        widthCm: 20,
        heightCm: 20,
      },
    });
    const fedexError = new FedexProviderError({
      provider: "FEDEX",
      status: 400,
      message: "Invalid service and packaging combination",
    });
    const ratesService = {
      quoteRates: jest.fn().mockRejectedValue(fedexError),
    };
    jest.mocked(fedexAvailabilityService.checkAvailability).mockRejectedValue(fedexError);
    const service = new ShippingQuoteService(db as any, ratesService as any);

    await expect(
      service.createFedexCartQuote({
        userId: "user_1",
        cart,
        direccionEnvio: address,
      }),
    ).rejects.toMatchObject({
      name: "ShippingQuoteError",
      message: "Invalid service and packaging combination",
      statusCode: 422,
    });
  });
});
