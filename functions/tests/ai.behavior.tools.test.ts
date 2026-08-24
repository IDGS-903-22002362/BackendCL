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

jest.mock("../src/services/ai/analytics/behavior.repository", () => {
  const actual = jest.requireActual(
    "../src/services/ai/analytics/behavior.repository",
  );

  return {
    ...actual,
    __esModule: true,
    default: {
      listEventsInPeriod: jest.fn(),
      getEarliestEventDays: jest.fn(),
    },
  };
});

/**
 * Tools de comportamiento del Asistente Administrativo.
 *
 * Se ejercitan contra la telemetria y los pedidos ya mockeados para verificar
 * tres cosas: que las cifras salen de los datos, que el pronostico se calcula
 * en backend y que la salida enviada al modelo no lleva identificadores de
 * visitante ni de sesion.
 */

import analyticsRepository from "../src/services/ai/analytics/analytics.repository";
import type {
  AnalyticsOrder,
  AnalyticsProduct,
} from "../src/services/ai/analytics/analytics.repository";
import behaviorRepository from "../src/services/ai/analytics/behavior.repository";
import type {
  AnalyticsBehaviorEvent,
  BehaviorEventType,
} from "../src/services/ai/analytics/behavior.repository";
import {
  ANALYTICS_TOOLS,
  ANALYTICS_TOOL_MAP,
  createAnalyticsToolContext,
} from "../src/services/ai/analytics/analytics.tools";
import { __behaviorToolsTestables } from "../src/services/ai/analytics/behavior.tools";
import { RolUsuario } from "../src/models/usuario.model";

const repository = analyticsRepository as jest.Mocked<typeof analyticsRepository>;
const behavior = behaviorRepository as jest.Mocked<typeof behaviorRepository>;

const NOW = new Date("2026-03-18T18:00:00.000Z"); // 2026-03-18 12:00 MX

let sequence = 0;

const event = (
  type: BehaviorEventType,
  overrides: Partial<AnalyticsBehaviorEvent> = {},
): AnalyticsBehaviorEvent => {
  sequence += 1;
  const dayKey = overrides.dayKey || "2026-03-17";
  const hour = overrides.hour ?? 10;

  return {
    id: `evt-${sequence}`,
    type,
    createdAt: new Date(`${dayKey}T${String(hour).padStart(2, "0")}:00:00.000Z`),
    dayKey,
    hour,
    productId: null,
    sessionKey: "sesion-secreta-1",
    visitorKey: "visitante-secreto-1",
    authenticated: false,
    surface: null,
    path: null,
    source: null,
    medium: null,
    campaign: null,
    referrerHost: null,
    orderRef: null,
    searchTerm: null,
    ...overrides,
  };
};

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
  price: 1000,
  offerPrice: null,
  hasActiveOffer: false,
  active: true,
  availableStock: 0,
  reservedStock: 0,
  minStock: 0,
  tracksSizes: false,
  ...overrides,
});

const givenEvents = (events: AnalyticsBehaviorEvent[]) => {
  behavior.listEventsInPeriod.mockImplementation(async (period, types) => ({
    events: events.filter(
      (candidate) =>
        candidate.dayKey >= period.fromDayKey &&
        candidate.dayKey <= period.toDayKey &&
        (!types || types.includes(candidate.type)),
    ),
    truncated: false,
    filteredInMemory: false,
    invalidEvents: 0,
  }));
};

const context = () =>
  createAnalyticsToolContext({
    userId: "admin-1",
    role: RolUsuario.ADMIN,
    requestId: "req-1",
    now: NOW,
  });

const run = (toolName: string, args: Record<string, unknown> = {}) => {
  const tool = ANALYTICS_TOOL_MAP.get(toolName);
  if (!tool) {
    throw new Error(`Tool ${toolName} no registrada`);
  }
  return tool.execute(args, context());
};

beforeEach(() => {
  jest.clearAllMocks();
  repository.listOrdersInPeriod.mockResolvedValue({ orders: [], truncated: false });
  repository.getProductsByIds.mockResolvedValue(new Map());
  repository.listProducts.mockResolvedValue({ products: [], truncated: false });
  repository.getCategories.mockResolvedValue(new Map());
  repository.getLines.mockResolvedValue(new Map());
  givenEvents([]);
  behavior.getEarliestEventDays.mockResolvedValue({});
});

describe("registro de tools", () => {
  it("agrega las tools de comportamiento sin quitar las de la primera fase", () => {
    const names = ANALYTICS_TOOLS.map((tool) => tool.name);

    expect(names).toEqual(
      expect.arrayContaining([
        "get_sales_summary",
        "get_inventory_health",
        "get_traffic_summary",
        "get_conversion_funnel",
        "get_product_interest",
        "get_product_performance",
        "get_traffic_sources",
        "analyze_metric_relationships",
        "forecast_metric",
        "detect_business_anomalies",
      ]),
    );
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("get_traffic_summary", () => {
  it("resume visitas, sesiones y dias con mas trafico", async () => {
    givenEvents([
      event("page_view", { dayKey: "2026-03-16", sessionKey: "s1", visitorKey: "v1" }),
      event("page_view", { dayKey: "2026-03-16", sessionKey: "s1", visitorKey: "v1" }),
      event("page_view", { dayKey: "2026-03-17", sessionKey: "s2", visitorKey: "v2" }),
      event("product_view", {
        dayKey: "2026-03-17",
        sessionKey: "s2",
        visitorKey: "v2",
        productId: "p1",
      }),
      event("search", {
        dayKey: "2026-03-17",
        sessionKey: "s2",
        visitorKey: "v2",
        searchTerm: "jersey",
      }),
    ]);

    const result = (await run("get_traffic_summary", {
      period: "last_7_days",
      includeDailySeries: true,
      includeHourlyDistribution: true,
    })) as Record<string, unknown>;

    const traffic = result.traffic as Record<string, number>;
    expect(traffic.visits).toBe(3);
    expect(traffic.sessions).toBe(2);
    expect(traffic.visitors).toBe(2);
    expect(traffic.productViews).toBe(1);
    expect(traffic.searches).toBe(1);

    const busiest = result.busiestDays as Array<{ date: string; visits: number }>;
    expect(busiest[0]).toMatchObject({ date: "2026-03-16", visits: 2 });

    expect(result.dailySeries).toHaveLength(7);
    expect(result.hourlyDistribution).toHaveLength(24);
    expect(result.topSearchTerms).toEqual([{ term: "jersey", searches: 1 }]);
    expect(result.metricDefinitions).toHaveProperty("visits");
  });

  it("compara contra el periodo previo cuando se solicita", async () => {
    givenEvents([
      event("page_view", { dayKey: "2026-03-17", sessionKey: "s1" }),
      event("page_view", { dayKey: "2026-03-17", sessionKey: "s2" }),
      event("page_view", { dayKey: "2026-03-05", sessionKey: "s3" }),
    ]);

    const result = (await run("get_traffic_summary", {
      period: "last_7_days",
      compareWithPreviousPeriod: true,
    })) as Record<string, unknown>;

    const comparison = result.comparison as {
      baselinePeriod: { from: string };
      metrics: Record<string, { current: number; previous: number; percentChange: number | null }>;
    };

    expect(comparison.baselinePeriod.from).toBe("2026-03-05");
    expect(comparison.metrics.visits.current).toBe(2);
    expect(comparison.metrics.visits.previous).toBe(1);
    expect(comparison.metrics.visits.percentChange).toBe(100);
  });

  it("nunca expone identificadores de sesion ni de visitante", async () => {
    givenEvents([
      event("page_view", {
        dayKey: "2026-03-17",
        sessionKey: "sesion-secreta-1",
        visitorKey: "visitante-secreto-1",
      }),
    ]);

    const serialized = JSON.stringify(
      await run("get_traffic_summary", { period: "last_7_days" }),
    );

    expect(serialized).not.toContain("sesion-secreta-1");
    expect(serialized).not.toContain("visitante-secreto-1");
  });

  it("declara cuando la telemetria empieza despues del periodo consultado", async () => {
    behavior.getEarliestEventDays.mockResolvedValue({ page_view: "2026-03-16" });

    const result = (await run("get_traffic_summary", {
      period: "last_30_days",
    })) as Record<string, unknown>;

    const quality = result.dataQuality as { notes: string[] };
    expect(quality.notes.join(" ")).toContain("solo tiene datos desde 2026-03-16");
  });
});

describe("get_conversion_funnel", () => {
  it("devuelve etapas, tasas y la etapa con mayor caida", async () => {
    givenEvents([
      event("page_view", { dayKey: "2026-03-17", sessionKey: "s1" }),
      event("page_view", { dayKey: "2026-03-17", sessionKey: "s2" }),
      event("page_view", { dayKey: "2026-03-17", sessionKey: "s3" }),
      event("page_view", { dayKey: "2026-03-17", sessionKey: "s4" }),
      event("product_view", { dayKey: "2026-03-17", sessionKey: "s1", productId: "p1" }),
      event("product_view", { dayKey: "2026-03-17", sessionKey: "s2", productId: "p1" }),
      event("add_to_cart", { dayKey: "2026-03-17", sessionKey: "s1", productId: "p1" }),
      event("checkout_started", { dayKey: "2026-03-17", sessionKey: "s1" }),
      event("purchase", {
        dayKey: "2026-03-17",
        sessionKey: "s1",
        orderRef: "ord-1",
      }),
    ]);
    repository.listOrdersInPeriod.mockResolvedValue({
      orders: [buildOrder({ dayKey: "2026-03-17", total: 900 })],
      truncated: false,
    });

    const result = (await run("get_conversion_funnel", {
      period: "last_7_days",
    })) as Record<string, unknown>;

    const stages = result.stages as Array<{ stage: string; sessions: number }>;
    const rates = result.rates as Record<string, number | null>;

    expect(stages.map((stage) => stage.sessions)).toEqual([4, 2, 1, 1, 1]);
    expect(rates.visitToProductViewRate).toBe(50);
    expect(rates.productViewToCartRate).toBe(50);
    expect(rates.checkoutToPurchaseRate).toBe(100);
    expect(rates.sessionConversionRate).toBe(25);
    expect(result.biggestDropStage).toBe("product_view");

    const crossCheck = result.crossCheck as Record<string, unknown>;
    expect(crossCheck.paidOrdersInOrdersCollection).toBe(1);
    expect(crossCheck.telemetryPurchaseSessions).toBe(1);
  });
});

describe("get_product_interest", () => {
  beforeEach(() => {
    repository.getProductsByIds.mockResolvedValue(
      new Map([
        ["p1", buildProduct({ id: "p1", name: "Jersey local" })],
        ["p2", buildProduct({ id: "p2", name: "Gorra" })],
      ]),
    );
  });

  it("ordena por vistas y calcula participacion y crecimiento", async () => {
    givenEvents([
      event("product_view", { dayKey: "2026-03-17", productId: "p1", visitorKey: "v1" }),
      event("product_view", { dayKey: "2026-03-17", productId: "p1", visitorKey: "v2" }),
      event("product_view", { dayKey: "2026-03-17", productId: "p1", visitorKey: "v2" }),
      event("add_to_cart", { dayKey: "2026-03-17", productId: "p1", visitorKey: "v1" }),
      event("product_view", { dayKey: "2026-03-17", productId: "p2", visitorKey: "v3" }),
      // periodo previo comparable: 2026-03-05 al 2026-03-11
      event("product_view", { dayKey: "2026-03-10", productId: "p1", visitorKey: "v9" }),
    ]);

    const result = (await run("get_product_interest", {
      period: "last_7_days",
    })) as Record<string, unknown>;

    const products = result.products as Array<Record<string, unknown>>;
    expect(products[0]).toMatchObject({
      productId: "p1",
      name: "Jersey local",
      views: 3,
      uniqueViewers: 2,
      addToCart: 1,
      previousViews: 1,
      viewsChange: 2,
      viewsChangePercent: 200,
      viewsShare: 75,
    });
    expect(products[1].productId).toBe("p2");
  });

  it("permite pedir los productos que menos interes tienen", async () => {
    givenEvents([
      event("product_view", { dayKey: "2026-03-17", productId: "p1" }),
      event("product_view", { dayKey: "2026-03-17", productId: "p1" }),
      event("product_view", { dayKey: "2026-03-17", productId: "p2" }),
    ]);

    const result = (await run("get_product_interest", {
      period: "last_7_days",
      direction: "bottom",
      limit: 1,
    })) as Record<string, unknown>;

    const products = result.products as Array<Record<string, unknown>>;
    expect(products).toHaveLength(1);
    expect(products[0].productId).toBe("p2");
  });

  it("excluye productos que ya no estan en el catalogo y lo declara", async () => {
    repository.getProductsByIds.mockResolvedValue(
      new Map([["p1", buildProduct({ id: "p1" })]]),
    );
    givenEvents([
      event("product_view", { dayKey: "2026-03-17", productId: "p1" }),
      event("product_view", { dayKey: "2026-03-17", productId: "borrado" }),
    ]);

    const result = (await run("get_product_interest", {
      period: "last_7_days",
    })) as Record<string, unknown>;

    const products = result.products as Array<Record<string, unknown>>;
    const quality = result.dataQuality as { notes: string[] };

    expect(products).toHaveLength(1);
    expect(quality.notes.join(" ")).toContain("ya no existen en el catalogo");
  });
});

describe("get_product_performance", () => {
  beforeEach(() => {
    repository.getProductsByIds.mockResolvedValue(
      new Map([
        [
          "p1",
          buildProduct({
            id: "p1",
            name: "Mucho interes sin venta",
            availableStock: 50,
            price: 1200,
          }),
        ],
        [
          "p2",
          buildProduct({
            id: "p2",
            name: "Pocas vistas que convierte",
            availableStock: 4,
            price: 800,
            offerPrice: 600,
            hasActiveOffer: true,
          }),
        ],
      ]),
    );

    givenEvents([
      ...Array.from({ length: 40 }, () =>
        event("product_view", { dayKey: "2026-03-17", productId: "p1" }),
      ),
      event("add_to_cart", { dayKey: "2026-03-17", productId: "p1" }),
      ...Array.from({ length: 4 }, () =>
        event("product_view", { dayKey: "2026-03-17", productId: "p2" }),
      ),
    ]);

    repository.listOrdersInPeriod.mockResolvedValue({
      orders: [
        buildOrder({
          dayKey: "2026-03-17",
          total: 1200,
          items: [
            { productoId: "p2", cantidad: 2, precioUnitario: 600, subtotal: 1200 },
          ],
        }),
      ],
      truncated: false,
    });
  });

  it("cruza vistas con ventas y clasifica por segmento con umbrales de la mediana", async () => {
    const result = (await run("get_product_performance", {
      period: "last_7_days",
    })) as Record<string, unknown>;

    const products = result.products as Array<Record<string, unknown>>;
    const thresholds = result.thresholds as Record<string, unknown>;

    expect(thresholds.viewsThreshold).toBe(22);
    expect(products[0]).toMatchObject({
      productId: "p1",
      views: 40,
      unitsSold: 0,
      ordersPerHundredViews: 0,
      segment: "alto_interes_baja_conversion",
      availableStock: 50,
    });
    expect(products[1]).toMatchObject({
      productId: "p2",
      views: 4,
      unitsSold: 2,
      revenue: 1200,
      ordersPerHundredViews: 25,
      unitsPerHundredViews: 50,
      discountPercent: 25,
      segment: "bajo_interes_alta_conversion",
    });
  });

  it("filtra por segmento cuando se pide alto interes y baja conversion", async () => {
    const result = (await run("get_product_performance", {
      period: "last_7_days",
      segment: "alto_interes_baja_conversion",
    })) as Record<string, unknown>;

    const products = result.products as Array<Record<string, unknown>>;
    expect(products).toHaveLength(1);
    expect(products[0].productId).toBe("p1");
  });

  it("estima dias de cobertura con el ritmo de venta del periodo", async () => {
    const result = (await run("get_product_performance", {
      period: "last_7_days",
      sortBy: "units",
    })) as Record<string, unknown>;

    const products = result.products as Array<Record<string, unknown>>;
    expect(products[0]).toMatchObject({ productId: "p2", daysOfSupply: 14 });
  });
});

describe("get_traffic_sources", () => {
  it("agrupa por canal y declara la cobertura de atribucion", async () => {
    givenEvents([
      event("page_view", {
        dayKey: "2026-03-17",
        sessionKey: "s1",
        source: "facebook",
        medium: "cpc",
        campaign: "clausura",
      }),
      event("purchase", {
        dayKey: "2026-03-17",
        sessionKey: "s1",
        orderRef: "ord-1",
        hour: 11,
      }),
      event("page_view", { dayKey: "2026-03-17", sessionKey: "s2" }),
    ]);

    const result = (await run("get_traffic_sources", {
      period: "last_7_days",
    })) as Record<string, unknown>;

    const totals = result.totals as Record<string, number>;
    const channels = result.channels as Array<Record<string, unknown>>;

    expect(totals.sessions).toBe(2);
    expect(totals.sessionsWithoutAttribution).toBe(1);
    expect(totals.attributionCoverageRate).toBe(50);
    expect(channels).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "facebook",
          medium: "cpc",
          campaign: "clausura",
          purchases: 1,
          sessionConversionRate: 100,
        }),
      ]),
    );
    expect(result.attributionNote).toContain("primer contacto");
  });
});

describe("analyze_metric_relationships", () => {
  it("calcula la correlacion pedida y advierte que no es causalidad", async () => {
    const events: AnalyticsBehaviorEvent[] = [];
    for (let day = 1; day <= 12; day += 1) {
      const dayKey = `2026-03-${String(day).padStart(2, "0")}`;
      for (let visit = 0; visit < day; visit += 1) {
        events.push(
          event("page_view", { dayKey, sessionKey: `s-${day}-${visit}` }),
        );
      }
    }
    givenEvents(events);

    repository.listOrdersInPeriod.mockResolvedValue({
      orders: Array.from({ length: 12 }, (_, index) =>
        buildOrder({
          dayKey: `2026-03-${String(index + 1).padStart(2, "0")}`,
          total: (index + 1) * 100,
        }),
      ),
      truncated: false,
    });

    const result = (await run("analyze_metric_relationships", {
      period: "custom",
      from: "2026-03-01",
      to: "2026-03-12",
      relationship: "visits_vs_revenue",
    })) as Record<string, unknown>;

    const correlation = result.correlation as Record<string, unknown>;

    expect(correlation.pairs).toBe(12);
    expect(correlation.pearson).toBe(1);
    expect(correlation.strength).toBe("fuerte");
    expect(correlation.reliable).toBe(true);
    expect(result.causality).toContain("no_determinada");
    expect((result.points as unknown[]).length).toBe(12);
  });

  it("rechaza relaciones que no estan en el catalogo permitido", async () => {
    await expect(
      run("analyze_metric_relationships", {
        period: "last_7_days",
        relationship: "precio_vs_clima",
      }),
    ).rejects.toThrow();
  });
});

describe("forecast_metric", () => {
  it("no proyecta cuando la telemetria es demasiado corta", async () => {
    givenEvents([event("page_view", { dayKey: "2026-03-17", sessionKey: "s1" })]);
    behavior.getEarliestEventDays.mockResolvedValue({ page_view: "2026-03-17" });

    const result = (await run("forecast_metric", {
      metric: "visits",
      horizon: 7,
    })) as Record<string, unknown>;

    const forecast = result.forecast as Record<string, unknown>;
    expect(forecast.available).toBe(false);
    expect(String(forecast.reason)).toContain("suficientes datos historicos");
    expect(forecast.minimumObservations).toBe(14);
  });

  it("proyecta ingresos con metodo, error y banda calculados en backend", async () => {
    const orders: AnalyticsOrder[] = [];
    for (let index = 0; index < 60; index += 1) {
      const day = new Date(NOW.getTime() - (index + 1) * 24 * 60 * 60 * 1000);
      orders.push(
        buildOrder({
          dayKey: day.toISOString().slice(0, 10),
          total: 1000,
        }),
      );
    }
    repository.listOrdersInPeriod.mockResolvedValue({ orders, truncated: false });

    const result = (await run("forecast_metric", {
      metric: "revenue",
      horizon: 7,
    })) as Record<string, unknown>;

    const forecast = result.forecast as Record<string, unknown>;
    const points = forecast.forecast as Array<Record<string, number>>;

    expect(result.metric).toBe("revenue");
    expect(result.currency).toBe("MXN");
    expect(forecast.available).toBe(true);
    expect(points).toHaveLength(7);
    expect(points[0].value).toBe(1000);
    expect(forecast.method).toBeDefined();
    expect(forecast.error).toBeDefined();
    expect((result.notes as string[]).join(" ")).toContain("el dia en curso se excluye");
  });

  it("excluye el dia en curso de la ventana de entrenamiento", async () => {
    await run("forecast_metric", { metric: "revenue", historyDays: 30 });

    const period = repository.listOrdersInPeriod.mock.calls[0][0];
    expect(period.toDayKey).toBe("2026-03-17");
    expect(period.fromDayKey).toBe("2026-02-16");
  });

  it("rechaza metricas fuera de la lista autorizada", async () => {
    await expect(run("forecast_metric", { metric: "margen_bruto" })).rejects.toThrow();
  });

  it("rechaza horizontes mayores al maximo de la fase", async () => {
    await expect(
      run("forecast_metric", { metric: "revenue", horizon: 120 }),
    ).rejects.toThrow();
  });
});

describe("detect_business_anomalies", () => {
  it("detecta una caida de ingresos fuera del rango habitual", async () => {
    const orders: AnalyticsOrder[] = [];
    for (let index = 2; index <= 45; index += 1) {
      const day = new Date(NOW.getTime() - index * 24 * 60 * 60 * 1000);
      orders.push(
        buildOrder({ dayKey: day.toISOString().slice(0, 10), total: 5000 }),
      );
    }
    // Ayer casi no se vendio.
    orders.push(buildOrder({ dayKey: "2026-03-17", total: 200 }));
    repository.listOrdersInPeriod.mockResolvedValue({ orders, truncated: false });

    const result = (await run("detect_business_anomalies", {
      focus: "sales",
      recentDays: 1,
    })) as Record<string, unknown>;

    const anomalies = result.anomalies as Array<Record<string, unknown>>;
    const revenue = anomalies.find((finding) => finding.metric === "revenue");

    expect(revenue).toMatchObject({
      direction: "caida",
      observedValue: 200,
      reference: "2026-03-17",
    });
    expect(String(revenue?.evidence)).toContain("nivel habitual");
    expect(result.method).toContain("MAD");
  });

  it("no reporta anomalias cuando el negocio se comporta estable", async () => {
    const orders = Array.from({ length: 44 }, (_, index) => {
      const day = new Date(NOW.getTime() - (index + 1) * 24 * 60 * 60 * 1000);
      return buildOrder({
        dayKey: day.toISOString().slice(0, 10),
        total: 5000 + (index % 3) * 100,
      });
    });
    repository.listOrdersInPeriod.mockResolvedValue({ orders, truncated: false });

    const result = (await run("detect_business_anomalies", {
      focus: "sales",
    })) as Record<string, unknown>;

    expect((result.totals as Record<string, number>).anomaliesFound).toBe(0);
  });

  it("no inventa anomalias de trafico cuando no hay telemetria", async () => {
    const result = (await run("detect_business_anomalies", {
      focus: "traffic",
      lookbackDays: 21,
    })) as Record<string, unknown>;

    const quality = result.dataQuality as {
      behavior: { notes: string[] };
    };

    expect((result.totals as Record<string, number>).anomaliesFound).toBe(0);
    expect(quality.behavior.notes.join(" ")).toContain(
      "No hay eventos de comportamiento",
    );
  });

  it("marca productos con muchas vistas y cero ventas", async () => {
    repository.getProductsByIds.mockResolvedValue(
      new Map([
        ["p1", buildProduct({ id: "p1", name: "Vitrina", availableStock: 30 })],
        ["p2", buildProduct({ id: "p2", name: "Discreto", availableStock: 10 })],
      ]),
    );
    givenEvents([
      ...Array.from({ length: 60 }, () =>
        event("product_view", { dayKey: "2026-03-16", productId: "p1" }),
      ),
      ...Array.from({ length: 3 }, () =>
        event("product_view", { dayKey: "2026-03-16", productId: "p2" }),
      ),
    ]);

    const result = (await run("detect_business_anomalies", {
      focus: "products",
    })) as Record<string, unknown>;

    const anomalies = result.anomalies as Array<Record<string, unknown>>;
    const finding = anomalies.find(
      (candidate) => candidate.metric === "producto_vistas_sin_venta",
    );

    expect(finding).toMatchObject({ reference: "Vitrina", observedValue: 60 });
    expect(
      anomalies.some((candidate) => candidate.reference === "Discreto"),
    ).toBe(false);
  });
});

describe("ventana de dias completos", () => {
  it("termina ayer para no medir una jornada parcial", () => {
    const window = __behaviorToolsTestables.resolveCompletedWindow(NOW, 30);

    expect(window.toDayKey).toBe("2026-03-17");
    expect(window.fromDayKey).toBe("2026-02-16");
  });
});

describe("cache por request entre tools de comportamiento", () => {
  it("no vuelve a leer la telemetria del mismo periodo y tipos", async () => {
    givenEvents([event("page_view", { dayKey: "2026-03-17", sessionKey: "s1" })]);
    const shared = context();
    const traffic = ANALYTICS_TOOL_MAP.get("get_traffic_summary")!;
    const funnel = ANALYTICS_TOOL_MAP.get("get_conversion_funnel")!;

    await traffic.execute({ period: "today" }, shared);
    await funnel.execute({ period: "today" }, shared);

    expect(behavior.listEventsInPeriod).toHaveBeenCalledTimes(1);
  });
});
