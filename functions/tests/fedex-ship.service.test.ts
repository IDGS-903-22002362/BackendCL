import { EstadoOrden, FulfillmentMethod } from "../src/models/orden.model";
import { PaymentStatus } from "../src/models/pago.model";
import {
  FedexShipError,
  FedexShipService,
} from "../src/modules/shipping/fedex/fedex-ship.service";

const originalEnv = { ...process.env };

const setFedexEnv = (environment = "sandbox") => {
  process.env.FEDEX_ENV = environment;
  process.env.FEDEX_BASE_URL = "https://apis-sandbox.fedex.com";
  process.env.FEDEX_CLIENT_ID = "client-id";
  process.env.FEDEX_CLIENT_SECRET = "client-secret";
  process.env.FEDEX_ACCOUNT_NUMBER = "740561073";
  process.env.FEDEX_SHIPPER_NAME = "Club Leon Fulfillment";
  process.env.FEDEX_SHIPPER_COMPANY = "Club Leon";
  process.env.FEDEX_SHIPPER_PHONE = "4771234567";
  process.env.FEDEX_SHIPPER_STREET_1 = "Blvd Adolfo Lopez Mateos 1810";
  process.env.FEDEX_SHIPPER_CITY = "Leon";
  process.env.FEDEX_SHIPPER_STATE = "GUA";
  process.env.FEDEX_SHIPPER_POSTAL_CODE = "37500";
  process.env.FEDEX_SHIPPER_COUNTRY_CODE = "MX";
};

const buildOrder = (overrides: Record<string, unknown> = {}) => ({
  usuarioId: "user_1",
  estado: EstadoOrden.CONFIRMADA,
  fulfillmentMethod: FulfillmentMethod.DELIVERY,
  metodoPago: "TARJETA",
  items: [{ productoId: "prod_1", cantidad: 1, precioUnitario: 100, subtotal: 100 }],
  subtotal: 100,
  impuestos: 0,
  total: 100,
  direccionEnvio: {
    nombre: "Juan Perez",
    telefono: "4777654321",
    calle: "Calle Uno",
    numero: "123",
    colonia: "Centro",
    ciudad: "Leon",
    estado: "GUA",
    codigoPostal: "37000",
  },
  shipping: {
    provider: "FEDEX",
    quoteId: "quote_1",
    status: "QUOTE_SELECTED",
    selectedServiceType: "FEDEX_EXPRESS_SAVER",
    packages: [{ weightKg: 1, lengthCm: 30, widthCm: 25, heightCm: 10 }],
  },
  ...overrides,
});

const buildDeps = (orderData: Record<string, unknown>) => {
  const update = jest.fn().mockResolvedValue(undefined);
  const get = jest.fn().mockResolvedValue({
    exists: true,
    id: "orden_123",
    data: () => orderData,
  });
  const addEvent = jest.fn().mockResolvedValue({ id: "event_1" });
  const getPayments = jest.fn().mockResolvedValue({
    docs: [{ data: () => ({ status: PaymentStatus.PAID }) }],
  });
  const wherePayments = jest.fn().mockReturnValue({ get: getPayments });
  const save = jest.fn().mockResolvedValue(undefined);
  const post = jest.fn().mockResolvedValue({
    output: {
      transactionShipments: [
        {
          masterTrackingNumber: "TRACK123",
          serviceType: "FEDEX_EXPRESS_SAVER",
          pieceResponses: [
            {
              trackingNumber: "TRACK123",
              packageDocuments: [
                { encodedLabel: Buffer.from("%PDF").toString("base64") },
              ],
            },
          ],
        },
      ],
    },
  });
  const put = jest.fn().mockResolvedValue({});
  const db = {
    collection: jest.fn((name: string) => {
      if (name === "ordenes") {
        return { doc: jest.fn(() => ({ get, update })) };
      }
      if (name === "pagos") {
        return { where: wherePayments };
      }
      return { add: addEvent };
    }),
  };
  const bucket = {
    file: jest.fn(() => ({ save })),
  };

  return {
    db,
    bucket,
    client: { post, put },
    update,
    get,
    addEvent,
    save,
    post,
    put,
    getPayments,
    wherePayments,
  };
};

describe("FedEx ship service", () => {
  beforeEach(() => {
    process.env = { ...originalEnv };
    setFedexEnv();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("rejects non-confirmed orders", async () => {
    const deps = buildDeps(buildOrder({ estado: EstadoOrden.PENDIENTE }));
    const service = new FedexShipService(deps.db as any, deps.bucket as any, deps.client);

    await expect(service.createShipmentForOrder("orden_123")).rejects.toMatchObject({
      message: "Solo se pueden generar guías de órdenes pagadas",
      statusCode: 400,
    });
    expect(deps.post).not.toHaveBeenCalled();
  });

  it("returns idempotent response when a label already exists", async () => {
    const deps = buildDeps(
      buildOrder({
        shipping: {
          status: "LABEL_CREATED",
          trackingNumber: "EXISTING123",
          labelStoragePath: "shipping-labels/orden_123/fedex-label.pdf",
          serviceType: "FEDEX_EXPRESS_SAVER",
          environment: "sandbox",
        },
      }),
    );
    const service = new FedexShipService(deps.db as any, deps.bucket as any, deps.client);

    const result = await service.createShipmentForOrder("orden_123");

    expect(result).toMatchObject({
      ok: true,
      alreadyCreated: true,
      trackingNumber: "EXISTING123",
    });
    expect(deps.post).not.toHaveBeenCalled();
    expect(deps.save).not.toHaveBeenCalled();
  });

  it("saves label buffer and updates order shipping fields", async () => {
    const deps = buildDeps(buildOrder());
    const service = new FedexShipService(deps.db as any, deps.bucket as any, deps.client);

    const result = await service.createShipmentForOrder("orden_123");

    expect(deps.post).toHaveBeenCalledWith(
      "/ship/v1/shipments",
      expect.objectContaining({
        accountNumber: { value: "740561073" },
      }),
    );
    expect(deps.bucket.file).toHaveBeenCalledWith(
      "shipping-labels/orden_123/fedex-label.pdf",
    );
    expect(deps.save).toHaveBeenCalledWith(
      expect.any(Buffer),
      { metadata: { contentType: "application/pdf" } },
    );
    expect(deps.update).toHaveBeenCalledWith(
      expect.objectContaining({
        numeroGuia: "TRACK123",
        transportista: "FEDEX",
        shipping: expect.objectContaining({
          trackingNumber: "TRACK123",
          labelStoragePath: "shipping-labels/orden_123/fedex-label.pdf",
          accountNumberLast4: "1073",
        }),
      }),
    );
    expect(deps.addEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: "orden_123",
        type: "FEDEX_LABEL_CREATED",
        trackingNumber: "TRACK123",
      }),
    );
    expect(JSON.stringify(deps.update.mock.calls[0][0])).not.toContain(
      Buffer.from("%PDF").toString("base64"),
    );
    expect(result).toMatchObject({
      trackingNumber: "TRACK123",
      labelUrl: null,
      labelStoragePath: "shipping-labels/orden_123/fedex-label.pdf",
    });
  });

  it("blocks test-label in production", async () => {
    setFedexEnv("production");
    const deps = buildDeps(buildOrder());
    const service = new FedexShipService(deps.db as any, deps.bucket as any, deps.client);

    await expect(service.createSandboxTestLabel()).rejects.toBeInstanceOf(
      FedexShipError,
    );
    await expect(service.createSandboxTestLabel()).rejects.toMatchObject({
      statusCode: 403,
    });
  });
});
