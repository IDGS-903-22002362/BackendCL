jest.mock("../src/services/ai/analytics/analytics.repository", () => ({
  __esModule: true,
  default: {
    listOrdersInPeriod: jest.fn(),
    getProductsByIds: jest.fn(),
    listProducts: jest.fn(),
    getCategories: jest.fn(),
    getLines: jest.fn(),
    listOffers: jest.fn(),
    listPromoCodes: jest.fn(),
  },
}));

import analyticsRepository from "../src/services/ai/analytics/analytics.repository";
import type {
  AnalyticsOrder,
  AnalyticsProduct,
} from "../src/services/ai/analytics/analytics.repository";
import {
  ANALYTICS_TOOLS,
  ANALYTICS_TOOL_MAP,
  buildAnalyticsFunctionDeclarations,
  createAnalyticsToolContext,
} from "../src/services/ai/analytics/analytics.tools";
import { RolUsuario } from "../src/models/usuario.model";

const repository = analyticsRepository as jest.Mocked<typeof analyticsRepository>;

const NOW = new Date("2026-03-18T18:00:00.000Z"); // 2026-03-18 12:00 MX

const buildOrder = (
  overrides: Partial<AnalyticsOrder> & { dayKey: string },
): AnalyticsOrder => ({
  id: overrides.id || `order-${Math.random().toString(36).slice(2)}`,
  createdAt: new Date(`${overrides.dayKey}T18:00:00.000Z`),
  dayKey: overrides.dayKey,
  estado: overrides.estado ?? "ENTREGADA",
  paymentStatus:
    "paymentStatus" in overrides ? overrides.paymentStatus! : "PAGADO",
  fulfillmentMethod: overrides.fulfillmentMethod ?? "DELIVERY",
  metodoPago: overrides.metodoPago ?? "TARJETA",
  total: overrides.total ?? 0,
  subtotal: overrides.subtotal ?? overrides.total ?? 0,
  shippingTotal: overrides.shippingTotal ?? 0,
  discountTotal: overrides.discountTotal ?? 0,
  promoCode: overrides.promoCode ?? null,
  promoCodeDiscount: overrides.promoCodeDiscount ?? 0,
  customerKey: overrides.customerKey ?? "cliente-1",
  items: overrides.items ?? [],
});

const buildProduct = (
  overrides: Partial<AnalyticsProduct> & { id: string },
): AnalyticsProduct => ({
  sku: `SKU-${overrides.id}`,
  name: `Producto ${overrides.id}`,
  categoriaId: null,
  lineaId: null,
  price: 0,
  offerPrice: null,
  hasActiveOffer: false,
  active: true,
  availableStock: 0,
  reservedStock: 0,
  minStock: 0,
  tracksSizes: false,
  ...overrides,
});

const context = () =>
  createAnalyticsToolContext({
    userId: "admin-1",
    role: RolUsuario.ADMIN,
    requestId: "req-1",
    now: NOW,
  });

const run = (toolName: string, args: Record<string, unknown>) => {
  const tool = ANALYTICS_TOOL_MAP.get(toolName);
  if (!tool) {
    throw new Error(`Tool ${toolName} no registrada`);
  }
  return tool.execute(args, context());
};

beforeEach(() => {
  repository.listOrdersInPeriod.mockResolvedValue({
    orders: [],
    truncated: false,
  });
  repository.getProductsByIds.mockResolvedValue(new Map());
  repository.listProducts.mockResolvedValue({ products: [], truncated: false });
  repository.getCategories.mockResolvedValue(new Map());
  repository.getLines.mockResolvedValue(new Map());
  repository.listOffers.mockResolvedValue([]);
  repository.listPromoCodes.mockResolvedValue([]);
});

describe("declaraciones de tools", () => {
  it("expone las tools principales de ventas, productos, inventario y pedidos", () => {
    const names = ANALYTICS_TOOLS.map((tool) => tool.name);

    expect(names).toEqual(
      expect.arrayContaining([
        "get_sales_summary",
        "compare_sales_periods",
        "get_sales_by_product",
        "get_sales_by_category",
        "get_inventory_health",
        "get_orders_metrics",
      ]),
    );
  });

  it("genera declaraciones de funcion con schema plano para Gemini", () => {
    const declarations = buildAnalyticsFunctionDeclarations();
    const salesSummary = declarations.find(
      (declaration) => declaration.name === "get_sales_summary",
    );

    expect(salesSummary?.description).toBeTruthy();
    const schema = salesSummary?.parametersJsonSchema as Record<string, unknown>;
    expect(schema.type).toBe("object");
    expect(schema.$schema).toBeUndefined();
    expect(schema.$defs).toBeUndefined();
    expect(schema.definitions).toBeUndefined();
  });
});

describe("get_sales_summary", () => {
  it("solo cuenta pedidos pagados y calcula el ticket promedio", async () => {
    repository.listOrdersInPeriod.mockResolvedValue({
      orders: [
        buildOrder({
          dayKey: "2026-03-17",
          total: 1000,
          shippingTotal: 99,
          items: [
            { productoId: "p1", cantidad: 2, precioUnitario: 450, subtotal: 900 },
          ],
        }),
        buildOrder({
          dayKey: "2026-03-18",
          total: 500,
          customerKey: "cliente-2",
          items: [
            { productoId: "p2", cantidad: 1, precioUnitario: 500, subtotal: 500 },
          ],
        }),
        buildOrder({
          dayKey: "2026-03-18",
          total: 9999,
          paymentStatus: "PENDIENTE",
          items: [
            { productoId: "p3", cantidad: 5, precioUnitario: 2000, subtotal: 9999 },
          ],
        }),
      ],
      truncated: false,
    });

    const result = (await run("get_sales_summary", {
      period: "last_7_days",
    })) as Record<string, unknown>;

    expect(result.revenue).toBe(1500);
    expect(result.paidOrders).toBe(2);
    expect(result.units).toBe(3);
    expect(result.averageOrderValue).toBe(750);
    expect(result.uniqueCustomers).toBe(2);
    expect(result.shipping).toBe(99);
  });

  it("devuelve ceros y una nota cuando el periodo no tiene ventas", async () => {
    const result = (await run("get_sales_summary", {
      period: "today",
    })) as Record<string, unknown>;

    expect(result.revenue).toBe(0);
    expect(result.paidOrders).toBe(0);
    expect(result.averageOrderValue).toBe(0);

    const quality = result.dataQuality as { notes: string[] };
    expect(quality.notes.join(" ")).toContain("No se registraron pedidos");
  });

  it("marca los pedidos sin estado de pago como riesgo de calidad de datos", async () => {
    repository.listOrdersInPeriod.mockResolvedValue({
      orders: [
        buildOrder({ dayKey: "2026-03-18", total: 700, paymentStatus: null }),
      ],
      truncated: false,
    });

    const result = (await run("get_sales_summary", {
      period: "today",
    })) as Record<string, unknown>;
    const quality = result.dataQuality as {
      ordersWithoutPaymentStatus: number;
      notes: string[];
    };

    expect(result.revenue).toBe(0);
    expect(quality.ordersWithoutPaymentStatus).toBe(1);
    expect(quality.notes.join(" ")).toContain("no tienen estado de pago");
  });

  it("incluye la serie diaria completa con dias en cero", async () => {
    repository.listOrdersInPeriod.mockResolvedValue({
      orders: [buildOrder({ dayKey: "2026-03-18", total: 300 })],
      truncated: false,
    });

    const result = (await run("get_sales_summary", {
      period: "last_7_days",
      includeDailySeries: true,
    })) as Record<string, unknown>;

    const series = result.dailySeries as Array<{ date: string; revenue: number }>;
    expect(series).toHaveLength(7);
    expect(series[0]).toEqual({
      date: "2026-03-12",
      revenue: 0,
      orders: 0,
      units: 0,
    });
    expect(series[6]).toEqual({
      date: "2026-03-18",
      revenue: 300,
      orders: 1,
      units: 0,
    });
  });

  it("consulta el rango de fechas resuelto en la zona horaria del negocio", async () => {
    await run("get_sales_summary", { period: "today" });

    const period = repository.listOrdersInPeriod.mock.calls[0][0];
    expect(period.fromDayKey).toBe("2026-03-18");
    expect(period.start.toISOString()).toBe("2026-03-18T06:00:00.000Z");
  });
});

describe("compare_sales_periods", () => {
  it("compara contra el periodo previo inmediato y calcula variaciones", async () => {
    repository.listOrdersInPeriod.mockImplementation(async (period) => {
      if (period.fromDayKey === "2026-03-12") {
        return {
          orders: [buildOrder({ dayKey: "2026-03-15", total: 800 })],
          truncated: false,
        };
      }

      return {
        orders: [
          buildOrder({ dayKey: "2026-03-06", total: 600 }),
          buildOrder({ dayKey: "2026-03-07", total: 400 }),
        ],
        truncated: false,
      };
    });

    const result = (await run("compare_sales_periods", {
      period: "last_7_days",
    })) as Record<string, unknown>;

    const metrics = result.metrics as Record<
      string,
      {
        current: number;
        previous: number;
        absoluteChange: number;
        percentChange: number | null;
      }
    >;

    expect((result.baselinePeriod as { from: string }).from).toBe("2026-03-05");
    expect(metrics.revenue.current).toBe(800);
    expect(metrics.revenue.previous).toBe(1000);
    expect(metrics.revenue.percentChange).toBe(-20);
    expect(metrics.paidOrders.absoluteChange).toBe(-1);
  });

  it("no inventa porcentaje cuando el periodo base fue cero", async () => {
    repository.listOrdersInPeriod.mockImplementation(async (period) =>
      period.fromDayKey === "2026-03-12"
        ? { orders: [buildOrder({ dayKey: "2026-03-15", total: 500 })], truncated: false }
        : { orders: [], truncated: false },
    );

    const result = (await run("compare_sales_periods", {
      period: "last_7_days",
    })) as Record<string, unknown>;
    const metrics = result.metrics as Record<
      string,
      { percentChange: number | null }
    >;

    expect(metrics.revenue.percentChange).toBeNull();
  });
});

describe("get_sales_by_product", () => {
  beforeEach(() => {
    repository.listOrdersInPeriod.mockResolvedValue({
      orders: [
        buildOrder({
          dayKey: "2026-03-18",
          total: 1500,
          items: [
            { productoId: "p1", cantidad: 3, precioUnitario: 300, subtotal: 900 },
            { productoId: "p2", cantidad: 2, precioUnitario: 300, subtotal: 600 },
          ],
        }),
        buildOrder({
          dayKey: "2026-03-17",
          total: 100,
          items: [
            { productoId: "p3", cantidad: 1, precioUnitario: 100, subtotal: 100 },
          ],
        }),
      ],
      truncated: false,
    });

    repository.getProductsByIds.mockResolvedValue(
      new Map([
        ["p1", buildProduct({ id: "p1", name: "Jersey local" })],
        ["p2", buildProduct({ id: "p2", name: "Jersey visita" })],
        ["p3", buildProduct({ id: "p3", name: "Llavero" })],
      ]),
    );
  });

  it("ordena por ingresos y calcula participacion", async () => {
    const result = (await run("get_sales_by_product", {
      period: "last_7_days",
      limit: 2,
    })) as Record<string, unknown>;

    const products = result.products as Array<Record<string, unknown>>;
    expect(products).toHaveLength(2);
    expect(products[0]).toMatchObject({
      productId: "p1",
      name: "Jersey local",
      units: 3,
      revenue: 900,
      revenueShare: 56.25,
    });
    expect(products[1].productId).toBe("p2");
  });

  it("permite pedir el ranking inferior", async () => {
    const result = (await run("get_sales_by_product", {
      period: "last_7_days",
      ranking: "bottom",
      limit: 1,
    })) as Record<string, unknown>;

    const products = result.products as Array<Record<string, unknown>>;
    expect(products[0].productId).toBe("p3");
  });

  it("no inventa nombres cuando el producto ya no existe en catalogo", async () => {
    repository.getProductsByIds.mockResolvedValue(new Map());

    const result = (await run("get_sales_by_product", {
      period: "last_7_days",
      limit: 1,
    })) as Record<string, unknown>;

    const products = result.products as Array<Record<string, unknown>>;
    expect(products[0].name).toContain("Producto sin catalogo");
  });
});

describe("get_sales_by_category", () => {
  it("agrupa con los nombres reales del catalogo", async () => {
    repository.listOrdersInPeriod.mockResolvedValue({
      orders: [
        buildOrder({
          dayKey: "2026-03-18",
          total: 1200,
          items: [
            { productoId: "p1", cantidad: 1, precioUnitario: 800, subtotal: 800 },
            { productoId: "p2", cantidad: 1, precioUnitario: 400, subtotal: 400 },
          ],
        }),
      ],
      truncated: false,
    });
    repository.getProductsByIds.mockResolvedValue(
      new Map([
        ["p1", buildProduct({ id: "p1", categoriaId: "cat-1" })],
        ["p2", buildProduct({ id: "p2", categoriaId: null })],
      ]),
    );
    repository.getCategories.mockResolvedValue(
      new Map([["cat-1", { id: "cat-1", name: "Jerseys" }]]),
    );

    const result = (await run("get_sales_by_category", {
      period: "last_30_days",
    })) as Record<string, unknown>;

    const groups = result.groups as Array<Record<string, unknown>>;
    expect(groups[0]).toMatchObject({
      name: "Jerseys",
      revenue: 800,
      revenueShare: 66.67,
    });
    expect(groups[1]).toMatchObject({ id: "sin_clasificar", revenue: 400 });
  });
});

describe("get_inventory_health", () => {
  beforeEach(() => {
    repository.listProducts.mockResolvedValue({
      products: [
        buildProduct({
          id: "p1",
          name: "Agotado",
          availableStock: 0,
          minStock: 5,
        }),
        buildProduct({
          id: "p2",
          name: "Stock bajo",
          availableStock: 3,
          minStock: 5,
        }),
        buildProduct({
          id: "p3",
          name: "Sobreinventario",
          availableStock: 400,
          minStock: 5,
        }),
        buildProduct({
          id: "p4",
          name: "Inactivo",
          availableStock: 900,
          minStock: 5,
          active: false,
        }),
      ],
      truncated: false,
    });
  });

  it("clasifica sin stock, stock bajo y sobreinventario solo entre productos activos", async () => {
    const result = (await run("get_inventory_health", {})) as Record<
      string,
      unknown
    >;
    const totals = result.totals as Record<string, number>;

    expect(totals.activeProducts).toBe(3);
    expect(totals.outOfStockProducts).toBe(1);
    expect(totals.lowStockProducts).toBe(1);
    expect(totals.overstockCandidates).toBe(1);
    expect(totals.totalAvailableUnits).toBe(403);
  });

  it("estima dias de cobertura con las ventas reales del periodo de rotacion", async () => {
    repository.listOrdersInPeriod.mockResolvedValue({
      orders: [
        buildOrder({
          dayKey: "2026-03-10",
          total: 1000,
          items: [
            { productoId: "p3", cantidad: 30, precioUnitario: 10, subtotal: 300 },
          ],
        }),
      ],
      truncated: false,
    });

    const result = (await run("get_inventory_health", {
      focus: "overstock",
      salesLookbackDays: 30,
    })) as Record<string, unknown>;

    const products = result.products as Array<Record<string, unknown>>;
    expect(products[0]).toMatchObject({
      productId: "p3",
      unitsSoldInLookback: 30,
      daysOfSupply: 400,
    });
  });

  it("advierte cuando no hay stock minimo configurado", async () => {
    repository.listProducts.mockResolvedValue({
      products: [buildProduct({ id: "p1", availableStock: 10, minStock: 0 })],
      truncated: false,
    });

    const result = (await run("get_inventory_health", {})) as Record<
      string,
      unknown
    >;
    const quality = result.dataQuality as { notes: string[] };

    expect(quality.notes.join(" ")).toContain("stock minimo");
  });

  it("filtra solo productos sin stock cuando se pide ese enfoque", async () => {
    const result = (await run("get_inventory_health", {
      focus: "out_of_stock",
    })) as Record<string, unknown>;

    const products = result.products as Array<Record<string, unknown>>;
    expect(products).toHaveLength(1);
    expect(products[0].name).toBe("Agotado");
  });
});

describe("get_orders_metrics", () => {
  it("desglosa estados, pagos y metodo de entrega", async () => {
    repository.listOrdersInPeriod.mockResolvedValue({
      orders: [
        buildOrder({ dayKey: "2026-03-18", total: 500 }),
        buildOrder({
          dayKey: "2026-03-18",
          total: 0,
          estado: "CANCELADA",
          paymentStatus: "FALLIDO",
          fulfillmentMethod: "PICKUP",
        }),
        buildOrder({
          dayKey: "2026-03-18",
          total: 0,
          estado: "PENDIENTE",
          paymentStatus: "PENDIENTE",
          fulfillmentMethod: "PICKUP",
        }),
      ],
      truncated: false,
    });

    const result = (await run("get_orders_metrics", {
      period: "today",
    })) as Record<string, unknown>;

    expect(result.totalOrders).toBe(3);
    expect(result.paidOrders).toBe(1);
    expect(result.canceledOrders).toBe(1);
    expect(result.failedPaymentOrders).toBe(1);
    expect(result.pendingPaymentOrders).toBe(1);
    expect(result.conversionToPaidRate).toBe(33.33);
    expect(result.byFulfillmentMethod).toEqual({ DELIVERY: 1, PICKUP: 2 });
  });
});

describe("get_promotions_performance", () => {
  it("mide el uso real de codigos en pedidos pagados", async () => {
    repository.listOrdersInPeriod.mockResolvedValue({
      orders: [
        buildOrder({
          dayKey: "2026-03-18",
          total: 900,
          promoCode: "LEON10",
          promoCodeDiscount: 100,
        }),
        buildOrder({ dayKey: "2026-03-18", total: 500 }),
        buildOrder({
          dayKey: "2026-03-18",
          total: 700,
          promoCode: "LEON10",
          promoCodeDiscount: 50,
          paymentStatus: "PENDIENTE",
        }),
      ],
      truncated: false,
    });

    const result = (await run("get_promotions_performance", {
      period: "today",
    })) as Record<string, unknown>;

    const usage = result.promoCodeUsageInPeriod as Record<string, unknown>;
    expect(usage.paidOrders).toBe(2);
    expect(usage.ordersWithPromoCode).toBe(1);
    expect(usage.promoCodePenetration).toBe(50);
    expect(usage.totalPromoDiscount).toBe(100);
    expect(usage.byCode).toEqual([
      { code: "LEON10", orders: 1, discount: 100, revenue: 900 },
    ]);
  });
});

describe("get_customer_metrics", () => {
  it("agrega compradores sin exponer datos personales", async () => {
    repository.listOrdersInPeriod.mockResolvedValue({
      orders: [
        buildOrder({ dayKey: "2026-03-18", total: 500, customerKey: "u1" }),
        buildOrder({ dayKey: "2026-03-18", total: 300, customerKey: "u1" }),
        buildOrder({ dayKey: "2026-03-18", total: 200, customerKey: "u2" }),
      ],
      truncated: false,
    });

    const result = (await run("get_customer_metrics", {
      period: "today",
    })) as Record<string, unknown>;

    expect(result.uniqueBuyers).toBe(2);
    expect(result.repeatBuyersInPeriod).toBe(1);
    expect(result.repeatRateInPeriod).toBe(50);
    expect(result.revenuePerBuyer).toBe(500);
    expect(JSON.stringify(result)).not.toContain("u1");
  });
});

describe("validacion de argumentos", () => {
  it("rechaza periodos desconocidos antes de tocar Firestore", async () => {
    await expect(
      run("get_sales_summary", { period: "ultimos_3_siglos" }),
    ).rejects.toThrow();
    expect(repository.listOrdersInPeriod).not.toHaveBeenCalled();
  });

  it("rechaza custom sin fechas", async () => {
    await expect(run("get_sales_summary", { period: "custom" })).rejects.toThrow(
      /from/,
    );
  });

  it("propaga fallos del repositorio para que el agente los reporte", async () => {
    repository.listOrdersInPeriod.mockRejectedValue(
      new Error("Firestore no disponible"),
    );

    await expect(run("get_orders_metrics", { period: "today" })).rejects.toThrow(
      "Firestore no disponible",
    );
  });
});

describe("cache por request", () => {
  it("no repite la lectura del mismo periodo dentro de una misma consulta", async () => {
    const sharedContext = context();
    const summary = ANALYTICS_TOOL_MAP.get("get_sales_summary")!;
    const orders = ANALYTICS_TOOL_MAP.get("get_orders_metrics")!;

    await summary.execute({ period: "today" }, sharedContext);
    await orders.execute({ period: "today" }, sharedContext);

    expect(repository.listOrdersInPeriod).toHaveBeenCalledTimes(1);
  });
});
