import { Timestamp } from "firebase-admin/firestore";
import { CheckoutPricingService } from "../src/services/checkout/checkout-pricing.service";

type MockDoc = Record<string, any>;

const createDb = (data: {
  carritos: Record<string, MockDoc>;
  productos: Record<string, MockDoc>;
}) =>
  ({
    collection: (name: string) => ({
      doc: (id: string) => ({
        get: async () => ({
          exists: Boolean((data as any)[name]?.[id]),
          id,
          data: () => (data as any)[name]?.[id],
        }),
      }),
      where: (field: string, _op: string, value: unknown) => ({
        limit: (_count: number) => ({
          get: async () => {
            const docs = Object.entries((data as any)[name] || {})
              .filter(([, doc]) => {
                const record = doc as Record<string, unknown>;
                return record[field] === value;
              })
              .map(([id, doc]) => ({
                id,
                data: () => doc,
              }));
            return {
              empty: docs.length === 0,
              docs,
            };
          },
        }),
      }),
    }),
  }) as any;

describe("CheckoutPricingService", () => {
  const now = Timestamp.now();

  it("recalculates checkout totals from cart and product data", async () => {
    const db = createDb({
      carritos: {
        cart_1: {
          usuarioId: "user-1",
          items: [
            {
              productoId: "prod-1",
              cantidad: 2,
              precioUnitario: 999,
              tallaId: "M",
            },
          ],
          subtotal: 1998,
          total: 1998,
          createdAt: now,
          updatedAt: now,
        },
      },
      productos: {
        "prod-1": {
          clave: "SKU-1",
          descripcion: "Jersey",
          precioPublico: 1200,
          activo: true,
          existencias: 10,
          tallaIds: ["M"],
          inventarioPorTalla: [{ tallaId: "M", cantidad: 10 }],
          shipping: {
            requiresShipping: true,
            weightKg: 0.5,
            lengthCm: 30,
            widthCm: 20,
            heightCm: 10,
          },
        },
      },
    });
    const shippingService = {
      calculateShipping: jest.fn().mockResolvedValue({
        method: "FEDEX",
        provider: "FEDEX",
        amount: 180.5,
        currency: "MXN",
        quotedAt: "2026-05-21T00:00:00.000Z",
      }),
    };
    const service = new CheckoutPricingService(db, shippingService as any);

    const result = await service.calculateCheckoutPricing({
      userId: "user-1",
      cartId: "cart_1",
      shippingSelection: {
        method: "FEDEX",
        provider: "FEDEX",
        serviceType: "FEDEX_GROUND",
      },
      shippingAddress: {
        streetLines: ["Calle 1"],
        city: "Leon",
        stateOrProvinceCode: "GTO",
        postalCode: "37500",
        countryCode: "MX",
      },
    });

    expect(result.subtotalOriginal).toBe(2400);
    expect(result.subtotalFinal).toBe(2400);
    expect(result.discountTotal).toBe(0);
    expect(result.shippingTotal).toBe(180.5);
    expect(result.total).toBe(2580.5);
    expect(result.items[0]).toMatchObject({
      productId: "prod-1",
      quantity: 2,
      unitPriceOriginal: 1200,
      unitPriceFinal: 1200,
      requiereEnvio: true,
    });
  });

  it("fails when the product is inactive", async () => {
    const db = createDb({
      carritos: {
        cart_1: {
          usuarioId: "user-1",
          items: [{ productoId: "prod-1", cantidad: 1, precioUnitario: 100 }],
          subtotal: 100,
          total: 100,
          createdAt: now,
          updatedAt: now,
        },
      },
      productos: {
        "prod-1": {
          descripcion: "Jersey",
          precioPublico: 100,
          activo: false,
          existencias: 10,
          tallaIds: [],
          inventarioPorTalla: [],
        },
      },
    });
    const service = new CheckoutPricingService(db, {
      calculateShipping: jest.fn(),
    } as any);

    await expect(
      service.calculateCheckoutPricing({
        userId: "user-1",
        cartId: "cart_1",
        shippingSelection: { method: "PICKUP" },
      }),
    ).rejects.toMatchObject({
      code: "CHECKOUT_PRODUCT_INACTIVE",
    });
  });

  it("fails when stock is insufficient", async () => {
    const db = createDb({
      carritos: {
        cart_1: {
          usuarioId: "user-1",
          items: [
            {
              productoId: "prod-1",
              cantidad: 3,
              precioUnitario: 100,
              tallaId: "M",
            },
          ],
          subtotal: 300,
          total: 300,
          createdAt: now,
          updatedAt: now,
        },
      },
      productos: {
        "prod-1": {
          descripcion: "Jersey",
          precioPublico: 100,
          activo: true,
          existencias: 3,
          tallaIds: ["M"],
          inventarioPorTalla: [{ tallaId: "M", cantidad: 1 }],
          shipping: {
            requiresShipping: true,
            weightKg: 0.5,
            lengthCm: 30,
            widthCm: 20,
            heightCm: 10,
          },
        },
      },
    });
    const service = new CheckoutPricingService(db, {
      calculateShipping: jest.fn(),
    } as any);

    await expect(
      service.calculateCheckoutPricing({
        userId: "user-1",
        cartId: "cart_1",
        shippingSelection: { method: "PICKUP" },
      }),
    ).rejects.toMatchObject({
      code: "CHECKOUT_STOCK_UNAVAILABLE",
    });
  });

  it("adds personalization fee per unit when item is customized", async () => {
    const db = createDb({
      carritos: {
        cart_1: {
          usuarioId: "user-1",
          items: [
            {
              productoId: "prod-1",
              cantidad: 2,
              precioUnitario: 1300,
              tallaId: "M",
              personalizacion: {
                mode: "custom",
                nombre: "LEON",
                numero: "9",
              },
            },
          ],
          subtotal: 2600,
          total: 2600,
          createdAt: now,
          updatedAt: now,
        },
      },
      productos: {
        "prod-1": {
          clave: "JERSEY-1",
          descripcion: "Jersey Local",
          precioPublico: 1000,
          activo: true,
          personalizable: true,
          existencias: 10,
          tallaIds: ["M"],
          inventarioPorTalla: [{ tallaId: "M", cantidad: 10 }],
          shipping: {
            requiresShipping: true,
            weightKg: 0.5,
            lengthCm: 30,
            widthCm: 20,
            heightCm: 10,
          },
        },
      },
    });
    const service = new CheckoutPricingService(db, {
      calculateShipping: jest.fn().mockResolvedValue({
        method: "PICKUP",
        provider: "STORE",
        amount: 0,
        currency: "MXN",
      }),
    } as any);

    const result = await service.calculateCheckoutPricing({
      userId: "user-1",
      cartId: "cart_1",
      shippingSelection: { method: "PICKUP" },
    });

    expect(result.subtotalFinal).toBe(2600);
    expect(result.items[0]).toMatchObject({
      unitPriceFinal: 1300,
      personalizationFee: 300,
      personalizacion: {
        mode: "custom",
        nombre: "LEON",
        numero: "9",
      },
    });
  });

  it("does not add personalization fee when item has no customization", async () => {
    const db = createDb({
      carritos: {
        cart_1: {
          usuarioId: "user-1",
          items: [
            {
              productoId: "prod-1",
              cantidad: 1,
              precioUnitario: 1000,
              tallaId: "M",
            },
          ],
          subtotal: 1000,
          total: 1000,
          createdAt: now,
          updatedAt: now,
        },
      },
      productos: {
        "prod-1": {
          clave: "JERSEY-1",
          descripcion: "Jersey Local",
          precioPublico: 1000,
          activo: true,
          personalizable: true,
          existencias: 10,
          tallaIds: ["M"],
          inventarioPorTalla: [{ tallaId: "M", cantidad: 10 }],
        },
      },
    });
    const service = new CheckoutPricingService(db, {
      calculateShipping: jest.fn().mockResolvedValue({
        method: "PICKUP",
        provider: "STORE",
        amount: 0,
        currency: "MXN",
      }),
    } as any);

    const result = await service.calculateCheckoutPricing({
      userId: "user-1",
      cartId: "cart_1",
      shippingSelection: { method: "PICKUP" },
    });

    expect(result.subtotalFinal).toBe(1000);
    expect(result.items[0]).toMatchObject({
      unitPriceFinal: 1000,
    });
    expect(result.items[0].personalizationFee).toBeUndefined();
  });
});
