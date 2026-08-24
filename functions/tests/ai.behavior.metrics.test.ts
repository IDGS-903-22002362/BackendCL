/**
 * Metricas de comportamiento del Asistente Administrativo.
 *
 * Aqui se fija la definicion de cada metrica: visita (evento), sesion
 * (identificador first-party) y compra (deduplicada por orden). Si estas
 * pruebas cambian, cambia el significado de los KPIs que ve el administrador.
 */

import {
  aggregateProductBehavior,
  buildBehaviorDailySeries,
  buildBehaviorDataQuality,
  buildConversionFunnel,
  buildHourlyDistribution,
  classifyInterest,
  countDistinctPurchases,
  groupTrafficSources,
  median,
  percentile,
  summarizeTraffic,
} from "../src/services/ai/analytics/behavior.metrics";
import {
  AnalyticsBehaviorEvent,
  BehaviorEventType,
} from "../src/services/ai/analytics/behavior.repository";
import { resolvePeriod } from "../src/services/ai/analytics/period.util";

let sequence = 0;

const event = (
  type: BehaviorEventType,
  overrides: Partial<AnalyticsBehaviorEvent> = {},
): AnalyticsBehaviorEvent => {
  sequence += 1;
  const dayKey = overrides.dayKey || "2026-06-10";
  const hour = overrides.hour ?? 12;

  return {
    id: `evt-${sequence}`,
    type,
    createdAt: new Date(`${dayKey}T${String(hour).padStart(2, "0")}:00:00.000Z`),
    dayKey,
    hour,
    productId: null,
    sessionKey: "s1",
    visitorKey: "v1",
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

describe("summarizeTraffic", () => {
  it("separa visitas (eventos) de sesiones y visitantes distintos", () => {
    const events = [
      event("page_view", { sessionKey: "s1", visitorKey: "v1" }),
      event("page_view", { sessionKey: "s1", visitorKey: "v1" }),
      event("page_view", { sessionKey: "s2", visitorKey: "v1" }),
      event("product_view", { sessionKey: "s2", visitorKey: "v1", productId: "p1" }),
      event("page_view", { sessionKey: "s3", visitorKey: "v2", authenticated: true }),
    ];

    const summary = summarizeTraffic(events);

    expect(summary.visits).toBe(4);
    expect(summary.sessions).toBe(3);
    expect(summary.visitors).toBe(2);
    expect(summary.authenticatedSessions).toBe(1);
    expect(summary.productViews).toBe(1);
    expect(summary.visitsPerSession).toBe(1.33);
  });

  it("calcula la conversion de sesion sobre sesiones, no sobre eventos", () => {
    const events = [
      event("page_view", { sessionKey: "s1" }),
      event("page_view", { sessionKey: "s2" }),
      event("page_view", { sessionKey: "s3" }),
      event("page_view", { sessionKey: "s4" }),
      event("purchase", { sessionKey: "s1", orderRef: "ord-1" }),
    ];

    expect(summarizeTraffic(events).sessionConversionRate).toBe(25);
  });

  it("no cuenta dos veces la misma compra recargada", () => {
    const events = [
      event("purchase", { sessionKey: "s1", orderRef: "ord-1" }),
      event("purchase", { sessionKey: "s1", orderRef: "ord-1" }),
      event("purchase", { sessionKey: "s2", orderRef: "ord-2" }),
      event("purchase", { sessionKey: "s3" }),
    ];

    const counted = countDistinctPurchases(events);

    expect(counted.purchases).toBe(3);
    expect(counted.duplicatedPurchaseEvents).toBe(1);
    expect(summarizeTraffic(events).purchases).toBe(3);
  });
});

describe("buildBehaviorDailySeries", () => {
  it("devuelve los dias sin actividad en cero, no ausentes", () => {
    const period = resolvePeriod(
      { period: "custom", from: "2026-06-09", to: "2026-06-11" },
      new Date("2026-06-11T18:00:00.000Z"),
    );

    const series = buildBehaviorDailySeries(
      [
        event("page_view", { dayKey: "2026-06-09", sessionKey: "s1" }),
        event("page_view", { dayKey: "2026-06-11", sessionKey: "s2" }),
        event("product_view", {
          dayKey: "2026-06-11",
          sessionKey: "s2",
          productId: "p1",
        }),
        event("purchase", {
          dayKey: "2026-06-11",
          sessionKey: "s2",
          orderRef: "ord-1",
        }),
        event("purchase", {
          dayKey: "2026-06-11",
          sessionKey: "s2",
          orderRef: "ord-1",
        }),
      ],
      period,
    );

    expect(series.map((point) => point.date)).toEqual([
      "2026-06-09",
      "2026-06-10",
      "2026-06-11",
    ]);
    expect(series[1].visits).toBe(0);
    expect(series[1].sessions).toBe(0);
    expect(series[2].purchases).toBe(1);
    expect(series[2].productViews).toBe(1);
    expect(series[0].weekday).toBe("martes");
  });

  it("descarta eventos fuera del periodo consultado", () => {
    const period = resolvePeriod(
      { period: "custom", from: "2026-06-10", to: "2026-06-10" },
      new Date("2026-06-10T18:00:00.000Z"),
    );

    const series = buildBehaviorDailySeries(
      [
        event("page_view", { dayKey: "2026-06-10" }),
        event("page_view", { dayKey: "2026-05-01" }),
      ],
      period,
    );

    expect(series).toHaveLength(1);
    expect(series[0].visits).toBe(1);
  });
});

describe("buildHourlyDistribution", () => {
  it("agrupa visitas por hora local del negocio", () => {
    const hourly = buildHourlyDistribution([
      event("page_view", { hour: 9 }),
      event("page_view", { hour: 9 }),
      event("product_view", { hour: 21, productId: "p1" }),
    ]);

    expect(hourly).toHaveLength(24);
    expect(hourly[9].visits).toBe(2);
    expect(hourly[21].productViews).toBe(1);
    expect(hourly[0].visits).toBe(0);
  });
});

describe("buildConversionFunnel", () => {
  it("mide cada etapa en sesiones y encuentra la mayor caida", () => {
    const events = [
      // 4 sesiones con actividad
      event("page_view", { sessionKey: "s1" }),
      event("page_view", { sessionKey: "s2" }),
      event("page_view", { sessionKey: "s3" }),
      event("page_view", { sessionKey: "s4" }),
      // 3 vieron producto
      event("product_view", { sessionKey: "s1", productId: "p1" }),
      event("product_view", { sessionKey: "s1", productId: "p2" }),
      event("product_view", { sessionKey: "s2", productId: "p1" }),
      event("product_view", { sessionKey: "s3", productId: "p1" }),
      // 1 agrego al carrito
      event("add_to_cart", { sessionKey: "s1", productId: "p1" }),
      // 1 inicio checkout y compro
      event("checkout_started", { sessionKey: "s1" }),
      event("purchase", { sessionKey: "s1", orderRef: "ord-1" }),
    ];

    const { stages, biggestDropStage } = buildConversionFunnel(events);

    expect(stages.map((stage) => stage.sessions)).toEqual([4, 3, 1, 1, 1]);
    expect(stages[1].conversionFromPreviousRate).toBe(75);
    expect(stages[2].conversionFromPreviousRate).toBe(33.33);
    expect(stages[2].droppedFromPrevious).toBe(2);
    expect(stages[4].conversionFromStartRate).toBe(25);
    expect(biggestDropStage).toBe("add_to_cart");
  });

  it("no inventa tasas cuando la etapa anterior esta vacia", () => {
    const { stages } = buildConversionFunnel([
      event("page_view", { sessionKey: "s1" }),
    ]);

    expect(stages[0].conversionFromPreviousRate).toBeNull();
    expect(stages[2].conversionFromPreviousRate).toBeNull();
  });

  it("marca las etapas sin telemetria y no las señala como la mayor caida", () => {
    const events = [
      event("page_view", { sessionKey: "s1" }),
      event("page_view", { sessionKey: "s2" }),
      event("product_view", { sessionKey: "s1", productId: "p1" }),
    ];

    const { stages, biggestDropStage, stagesWithoutTelemetry } =
      buildConversionFunnel(events, {
        availableFrom: {
          product_view: "2026-07-01",
          add_to_cart: null,
          checkout_started: null,
          purchase: null,
        },
      });

    expect(stagesWithoutTelemetry).toEqual([
      "add_to_cart",
      "checkout_started",
      "purchase",
    ]);
    expect(stages[2].hasTelemetry).toBe(false);
    expect(stages[2].conversionFromPreviousRate).toBeNull();
    expect(stages[2].dropRateFromPrevious).toBeNull();
    expect(biggestDropStage).toBe("product_view");
  });
});

describe("aggregateProductBehavior", () => {
  it("suma vistas, clics y carrito por producto con visitantes unicos", () => {
    const aggregates = aggregateProductBehavior([
      event("product_view", { productId: "p1", visitorKey: "v1" }),
      event("product_view", { productId: "p1", visitorKey: "v1" }),
      event("product_view", { productId: "p1", visitorKey: "v2" }),
      event("product_click", { productId: "p1", visitorKey: "v2" }),
      event("add_to_cart", { productId: "p1", visitorKey: "v2" }),
      event("product_view", { productId: "p2", visitorKey: "v3" }),
      event("page_view", { productId: null }),
    ]);

    const first = aggregates.get("p1");

    expect(first?.views).toBe(3);
    expect(first?.uniqueViewers).toBe(2);
    expect(first?.clicks).toBe(1);
    expect(first?.addToCart).toBe(1);
    expect(first?.viewToCartRate).toBe(33.33);
    expect(aggregates.get("p2")?.views).toBe(1);
    expect(aggregates.size).toBe(2);
  });
});

describe("groupTrafficSources", () => {
  it("atribuye la sesion al primer origen declarado y agrupa por canal", () => {
    const events = [
      event("page_view", {
        sessionKey: "s1",
        source: "facebook",
        medium: "cpc",
        campaign: "verano",
        createdAt: new Date("2026-06-10T10:00:00.000Z"),
      }),
      event("page_view", {
        sessionKey: "s1",
        source: "google",
        medium: "organic",
        createdAt: new Date("2026-06-10T11:00:00.000Z"),
      }),
      event("purchase", {
        sessionKey: "s1",
        orderRef: "ord-1",
        createdAt: new Date("2026-06-10T12:00:00.000Z"),
      }),
      event("page_view", {
        sessionKey: "s2",
        createdAt: new Date("2026-06-10T10:30:00.000Z"),
      }),
    ];

    const { groups, sessionsWithoutAttribution } = groupTrafficSources(events);

    expect(sessionsWithoutAttribution).toBe(1);
    const paid = groups.find((group) => group.source === "facebook");
    expect(paid?.medium).toBe("cpc");
    expect(paid?.campaign).toBe("verano");
    expect(paid?.sessions).toBe(1);
    expect(paid?.purchases).toBe(1);
    expect(paid?.sessionConversionRate).toBe(100);
    expect(groups.find((group) => group.source === "directo")?.sessions).toBe(1);
  });

  it("usa el host del referente cuando no hay utm", () => {
    const { groups } = groupTrafficSources([
      event("page_view", { sessionKey: "s1", referrerHost: "t.co" }),
    ]);

    expect(groups[0].source).toBe("t.co");
    expect(groups[0].medium).toBe("referral");
  });
});

describe("umbrales relativos de interes", () => {
  it("calcula percentiles y mediana por interpolacion", () => {
    const values = [10, 20, 30, 40];

    expect(percentile(values, 50)).toBe(25);
    expect(percentile(values, 0)).toBe(10);
    expect(percentile(values, 100)).toBe(40);
    expect(median([5, 1, 3])).toBe(3);
    expect(percentile([], 50)).toBe(0);
  });

  it("clasifica los cuatro segmentos contra los umbrales de la distribucion", () => {
    const thresholds = { viewsThreshold: 100, conversionThreshold: 5 };

    expect(classifyInterest({ views: 300, conversion: 9, ...thresholds })).toBe(
      "alto_interes_alta_conversion",
    );
    expect(classifyInterest({ views: 300, conversion: 1, ...thresholds })).toBe(
      "alto_interes_baja_conversion",
    );
    expect(classifyInterest({ views: 20, conversion: 12, ...thresholds })).toBe(
      "bajo_interes_alta_conversion",
    );
    expect(classifyInterest({ views: 20, conversion: 0, ...thresholds })).toBe(
      "bajo_interes_baja_conversion",
    );
  });
});

describe("buildBehaviorDataQuality", () => {
  it("declara truncamiento, eventos invalidos y compras duplicadas", () => {
    const period = resolvePeriod(
      { period: "custom", from: "2026-06-01", to: "2026-06-10" },
      new Date("2026-06-10T18:00:00.000Z"),
    );

    const quality = buildBehaviorDataQuality(
      {
        events: [
          event("purchase", { orderRef: "ord-1" }),
          event("purchase", { orderRef: "ord-1" }),
        ],
        truncated: true,
        filteredInMemory: true,
        invalidEvents: 2,
      },
      period,
      { availableFrom: { page_view: "2026-06-05", search: null }, unknownProductIds: 1 },
    );

    const notes = (quality.notes as string[]).join(" | ");

    expect(quality.duplicatedPurchaseEvents).toBe(1);
    expect(quality.eventsScanned).toBe(2);
    expect(notes).toContain("supera el limite");
    expect(notes).toContain("2 eventos se descartaron");
    expect(notes).toContain("compra repetidos");
    expect(notes).toContain("solo tiene datos desde 2026-06-05");
    expect(notes).toContain("No existe historial del evento search");
    expect(notes).toContain("ya no existen en el catalogo");
  });
});
