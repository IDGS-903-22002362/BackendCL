/**
 * Tools READ-ONLY de comportamiento del storefront para el Asistente
 * Administrativo: trafico, funnel, interes por producto, origen de trafico,
 * correlaciones, pronostico y anomalias.
 *
 * Todas leen la telemetria first-party ya existente (`recomendacionEventos`) y
 * los pedidos reales. Ninguna escribe. Ninguna devuelve identificadores de
 * visitante, sesion o usuario: solo agregados.
 */

import { z } from "zod";
import analyticsRepository, {
  AnalyticsProduct,
} from "./analytics.repository";
import {
  aggregateByProduct,
  buildDailySeries,
  buildVariation,
  isPaidOrder,
  roundCurrency,
  shareOfTotal,
} from "./analytics.metrics";
import {
  AnalyticsTool,
  AnalyticsToolContext,
  buildDataQuality,
  loadBehaviorEvents,
  loadEarliestEventDays,
  loadOrders,
  periodShape,
  productLabel,
  resolveFromInput,
} from "./analytics.tool-kit";
import {
  AnalyticsBehaviorEvent,
  BEHAVIOR_EVENT_TYPES,
  BehaviorEventType,
} from "./behavior.repository";
import {
  BehaviorDailyPoint,
  METRIC_DEFINITIONS,
  ProductBehaviorAggregate,
  aggregateProductBehavior,
  buildBehaviorDailySeries,
  buildBehaviorDataQuality,
  buildConversionFunnel,
  buildHourlyDistribution,
  classifyInterest,
  groupTrafficSources,
  median,
  percentile,
  summarizeTraffic,
} from "./behavior.metrics";
import {
  AnomalyFinding,
  ProductAnomalyInput,
  detectProductAnomalies,
  detectSeriesAnomalies,
  rankAnomalies,
} from "./anomaly.service";
import {
  CorrelationPoint,
  RELATIONSHIP_CATALOG,
  RELATIONSHIP_KEYS,
  RelationshipKey,
  analyzeCorrelation,
  summarizePoints,
} from "./correlation.util";
import {
  MAX_FORECAST_HORIZON,
  MIN_FORECAST_OBSERVATIONS,
  SeriesPoint,
  forecastSeries,
} from "./forecast.service";
import {
  ResolvedPeriod,
  describePeriodForModel,
  resolvePeriod,
  resolvePreviousPeriod,
  toAnalyticsDayKey,
} from "./period.util";

const DAY_MS = 24 * 60 * 60 * 1000;
const round2 = (value: number): number => Math.round(value * 100) / 100;

const dayKeyFromNow = (now: Date, offsetDays: number): string =>
  toAnalyticsDayKey(new Date(now.getTime() + offsetDays * DAY_MS));

/**
 * Ventana de dias completos que termina ayer. Se excluye el dia en curso
 * porque una jornada parcial se veria como una caida y contaminaria tanto el
 * pronostico como la deteccion de anomalias.
 */
const resolveCompletedWindow = (
  now: Date,
  days: number,
): ResolvedPeriod =>
  resolvePeriod(
    {
      period: "custom",
      from: dayKeyFromNow(now, -days),
      to: dayKeyFromNow(now, -1),
    },
    now,
  );

const TRAFFIC_TYPES: BehaviorEventType[] = [...BEHAVIOR_EVENT_TYPES];
const PRODUCT_TYPES: BehaviorEventType[] = [
  "product_view",
  "product_click",
  "add_to_cart",
];

const pickDefinitions = (keys: string[]): Record<string, string> =>
  keys.reduce<Record<string, string>>((acc, key) => {
    if (METRIC_DEFINITIONS[key]) {
      acc[key] = METRIC_DEFINITIONS[key];
    }
    return acc;
  }, {});

/* ------------------------------------------------------------------ */
/* get_traffic_summary                                                 */
/* ------------------------------------------------------------------ */

const trafficSummarySchema = z.object({
  ...periodShape,
  includeDailySeries: z
    .boolean()
    .optional()
    .describe(
      "true para incluir la serie diaria de visitas y sesiones, util para graficas de tendencia.",
    ),
  includeHourlyDistribution: z
    .boolean()
    .optional()
    .describe("true para incluir la distribucion por hora del dia."),
  compareWithPreviousPeriod: z
    .boolean()
    .optional()
    .describe(
      "true para comparar contra el periodo previo comparable del mismo tamano.",
    ),
});

const getTrafficSummary: AnalyticsTool = {
  name: "get_traffic_summary",
  description:
    "Trafico real de la tienda en un periodo: visitas (page views), sesiones, visitantes distintos, vistas de producto, agregados al carrito, checkouts, compras y busquedas. Puede incluir serie diaria, distribucion por hora, dias con mas y menos trafico y comparacion contra el periodo previo.",
  schema: trafficSummarySchema,
  execute: async (rawInput, context) => {
    const input = trafficSummarySchema.parse(rawInput);
    const period = resolveFromInput(input, context);

    const [page, availableFrom] = await Promise.all([
      loadBehaviorEvents(context, period, TRAFFIC_TYPES),
      loadEarliestEventDays(context, TRAFFIC_TYPES),
    ]);

    const summary = summarizeTraffic(page.events);
    const dailySeries = buildBehaviorDailySeries(page.events, period);

    const withVisits = dailySeries.filter((point) => point.visits > 0);
    const sortedByVisits = [...withVisits].sort((a, b) => b.visits - a.visits);

    const byWeekday = new Map<string, { visits: number; days: number }>();
    for (const point of dailySeries) {
      const entry = byWeekday.get(point.weekday) || { visits: 0, days: 0 };
      entry.visits += point.visits;
      entry.days += 1;
      byWeekday.set(point.weekday, entry);
    }

    let comparison: Record<string, unknown> | undefined;
    if (input.compareWithPreviousPeriod) {
      const baseline = resolvePreviousPeriod(period);
      const baselinePage = await loadBehaviorEvents(
        context,
        baseline,
        TRAFFIC_TYPES,
      );
      const baselineSummary = summarizeTraffic(baselinePage.events);

      comparison = {
        baselinePeriod: describePeriodForModel(baseline),
        metrics: {
          visits: buildVariation(summary.visits, baselineSummary.visits),
          sessions: buildVariation(summary.sessions, baselineSummary.sessions),
          visitors: buildVariation(summary.visitors, baselineSummary.visitors),
          productViews: buildVariation(
            summary.productViews,
            baselineSummary.productViews,
          ),
          addToCartEvents: buildVariation(
            summary.addToCartEvents,
            baselineSummary.addToCartEvents,
          ),
          purchases: buildVariation(
            summary.purchases,
            baselineSummary.purchases,
          ),
          sessionConversionRate: buildVariation(
            summary.sessionConversionRate,
            baselineSummary.sessionConversionRate,
          ),
        },
        baselineDataQuality: buildBehaviorDataQuality(baselinePage, baseline),
      };
    }

    const topSearchTerms = (() => {
      const counts = new Map<string, number>();
      for (const event of page.events) {
        if (event.type !== "search" || !event.searchTerm) {
          continue;
        }
        counts.set(event.searchTerm, (counts.get(event.searchTerm) || 0) + 1);
      }

      return Array.from(counts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([term, count]) => ({ term, searches: count }));
    })();

    return {
      period: describePeriodForModel(period),
      traffic: summary,
      busiestDays: sortedByVisits.slice(0, 3).map((point) => ({
        date: point.date,
        weekday: point.weekday,
        visits: point.visits,
        sessions: point.sessions,
      })),
      quietestDays: sortedByVisits
        .slice(-3)
        .reverse()
        .map((point) => ({
          date: point.date,
          weekday: point.weekday,
          visits: point.visits,
          sessions: point.sessions,
        })),
      visitsByWeekday: Array.from(byWeekday.entries()).map(([weekday, entry]) => ({
        weekday,
        visits: entry.visits,
        daysMeasured: entry.days,
        averageVisitsPerDay: entry.days > 0 ? round2(entry.visits / entry.days) : 0,
      })),
      dailySeries: input.includeDailySeries ? dailySeries : undefined,
      hourlyDistribution: input.includeHourlyDistribution
        ? buildHourlyDistribution(page.events)
        : undefined,
      topSearchTerms: topSearchTerms.length > 0 ? topSearchTerms : undefined,
      comparison,
      metricDefinitions: pickDefinitions([
        "visits",
        "sessions",
        "visitors",
        "productViews",
        "addToCartEvents",
        "checkoutStarted",
        "purchases",
        "sessionConversionRate",
      ]),
      dataQuality: buildBehaviorDataQuality(page, period, { availableFrom }),
    };
  },
};

/* ------------------------------------------------------------------ */
/* get_conversion_funnel                                              */
/* ------------------------------------------------------------------ */

const funnelSchema = z.object({
  ...periodShape,
  compareWithPreviousPeriod: z
    .boolean()
    .optional()
    .describe("true para comparar cada tasa contra el periodo previo comparable."),
});

const buildFunnelPayload = (
  events: AnalyticsBehaviorEvent[],
  availableFrom?: Record<string, string | null>,
) => {
  const funnel = buildConversionFunnel(events, { availableFrom });
  const stageByKey = new Map(funnel.stages.map((stage) => [stage.stage, stage]));

  return {
    ...funnel,
    rates: {
      visitToProductViewRate:
        stageByKey.get("product_view")?.conversionFromPreviousRate ?? null,
      productViewToCartRate:
        stageByKey.get("add_to_cart")?.conversionFromPreviousRate ?? null,
      cartToCheckoutRate:
        stageByKey.get("checkout_started")?.conversionFromPreviousRate ?? null,
      checkoutToPurchaseRate:
        stageByKey.get("purchase")?.conversionFromPreviousRate ?? null,
      sessionConversionRate:
        stageByKey.get("purchase")?.conversionFromStartRate ?? null,
    },
  };
};

const getConversionFunnel: AnalyticsTool = {
  name: "get_conversion_funnel",
  description:
    "Embudo de conversion por sesion: sesiones con actividad, sesiones que vieron producto, que agregaron al carrito, que iniciaron checkout y que compraron, con tasas de paso, caida entre etapas y la etapa donde se pierde mas gente.",
  schema: funnelSchema,
  execute: async (rawInput, context) => {
    const input = funnelSchema.parse(rawInput);
    const period = resolveFromInput(input, context);

    const [page, ordersPage, availableFrom] = await Promise.all([
      loadBehaviorEvents(context, period, TRAFFIC_TYPES),
      loadOrders(context, period),
      loadEarliestEventDays(context, TRAFFIC_TYPES),
    ]);

    const funnel = buildFunnelPayload(page.events, availableFrom);
    const paidOrders = ordersPage.orders.filter(isPaidOrder).length;

    let comparison: Record<string, unknown> | undefined;
    if (input.compareWithPreviousPeriod) {
      const baseline = resolvePreviousPeriod(period);
      const baselinePage = await loadBehaviorEvents(
        context,
        baseline,
        TRAFFIC_TYPES,
      );
      const baselineFunnel = buildFunnelPayload(baselinePage.events, availableFrom);

      comparison = {
        baselinePeriod: describePeriodForModel(baseline),
        rates: baselineFunnel.rates,
        stages: baselineFunnel.stages.map((stage) => ({
          stage: stage.stage,
          sessions: stage.sessions,
        })),
      };
    }

    return {
      period: describePeriodForModel(period),
      ...funnel,
      crossCheck: {
        paidOrdersInOrdersCollection: paidOrders,
        telemetryPurchaseSessions:
          funnel.stages.find((stage) => stage.stage === "purchase")?.sessions ?? 0,
        note:
          "Los pedidos pagados vienen de la coleccion de pedidos y las sesiones con compra de la telemetria. Si difieren mucho, la telemetria de compra puede estar incompleta y las tasas del funnel quedan subestimadas.",
      },
      telemetryGaps: {
        stagesWithoutTelemetry: funnel.stagesWithoutTelemetry,
        note:
          funnel.stagesWithoutTelemetry.length > 0
            ? "Estas etapas no tienen eventos registrados, asi que su tasa no se calcula: es un hueco de instrumentacion y no debe presentarse como una caida de clientes."
            : "Todas las etapas del embudo tienen telemetria.",
      },
      comparison,
      metricDefinitions: pickDefinitions([
        "sessions",
        "visitToProductViewRate",
        "productViewToCartRate",
        "cartToCheckoutRate",
        "checkoutToPurchaseRate",
        "sessionConversionRate",
      ]),
      dataQuality: {
        ...buildBehaviorDataQuality(page, period, { availableFrom }),
        orders: buildDataQuality(ordersPage, period),
      },
    };
  },
};

/* ------------------------------------------------------------------ */
/* get_product_interest                                                */
/* ------------------------------------------------------------------ */

const productInterestSchema = z.object({
  ...periodShape,
  sortBy: z
    .enum(["views", "unique_viewers", "add_to_cart", "view_to_cart_rate", "views_growth"])
    .optional()
    .describe(
      "Criterio de ordenamiento. views_growth compara contra el periodo previo comparable. Default: views.",
    ),
  direction: z
    .enum(["top", "bottom"])
    .optional()
    .describe(
      "top = mayor valor primero (default). bottom = menor valor, util para detectar productos que pierden interes.",
    ),
  limit: z.number().int().min(1).max(25).optional(),
});

const getProductInterest: AnalyticsTool = {
  name: "get_product_interest",
  description:
    "Interes real por producto segun telemetria: vistas, visitantes distintos, clics, agregados al carrito, tasa vista->carrito y crecimiento de vistas contra el periodo previo. Sirve para saber que productos llaman la atencion, cuales ganan interes y cuales lo pierden.",
  schema: productInterestSchema,
  execute: async (rawInput, context) => {
    const input = productInterestSchema.parse(rawInput);
    const period = resolveFromInput(input, context);
    const sortBy = input.sortBy ?? "views";
    const direction = input.direction ?? "top";
    const limit = input.limit ?? 10;
    const baseline = resolvePreviousPeriod(period);

    const [page, baselinePage, availableFrom] = await Promise.all([
      loadBehaviorEvents(context, period, PRODUCT_TYPES),
      loadBehaviorEvents(context, baseline, PRODUCT_TYPES),
      loadEarliestEventDays(context, PRODUCT_TYPES),
    ]);

    const current = aggregateProductBehavior(page.events);
    const previous = aggregateProductBehavior(baselinePage.events);
    const productIds = Array.from(current.keys());
    const products = await analyticsRepository.getProductsByIds(productIds);

    const rows = productIds
      .map((productId) => {
        const aggregate = current.get(productId) as ProductBehaviorAggregate;
        const before = previous.get(productId);
        const label = productLabel(productId, products);
        const previousViews = before?.views ?? 0;

        return {
          productId,
          sku: label.sku,
          name: label.name,
          inCatalog: products.has(productId),
          views: aggregate.views,
          uniqueViewers: aggregate.uniqueViewers,
          clicks: aggregate.clicks,
          addToCart: aggregate.addToCart,
          viewToCartRate: aggregate.viewToCartRate,
          previousViews,
          viewsChange: aggregate.views - previousViews,
          viewsChangePercent:
            previousViews > 0
              ? round2(((aggregate.views - previousViews) / previousViews) * 100)
              : null,
        };
      })
      .filter((row) => row.inCatalog);

    const unknownProductIds = productIds.length - rows.length;

    const sortValue = (row: (typeof rows)[number]): number => {
      switch (sortBy) {
        case "unique_viewers":
          return row.uniqueViewers;
        case "add_to_cart":
          return row.addToCart;
        case "view_to_cart_rate":
          return row.viewToCartRate;
        case "views_growth":
          return row.viewsChange;
        default:
          return row.views;
      }
    };

    rows.sort((a, b) => {
      const diff = sortValue(a) - sortValue(b);
      return direction === "top" ? -diff : diff;
    });

    const totalViews = rows.reduce((acc, row) => acc + row.views, 0);

    return {
      period: describePeriodForModel(period),
      baselinePeriod: describePeriodForModel(baseline),
      sortBy,
      direction,
      totals: {
        productsWithViews: rows.length,
        totalProductViews: totalViews,
      },
      products: rows.slice(0, limit).map((row) => ({
        ...row,
        viewsShare: shareOfTotal(row.views, totalViews),
      })),
      metricDefinitions: pickDefinitions([
        "productViews",
        "addToCartEvents",
        "viewToCartRate",
      ]),
      dataQuality: buildBehaviorDataQuality(page, period, {
        availableFrom,
        unknownProductIds,
      }),
    };
  },
};

/* ------------------------------------------------------------------ */
/* get_product_performance                                             */
/* ------------------------------------------------------------------ */

const productPerformanceSchema = z.object({
  ...periodShape,
  segment: z
    .enum([
      "all",
      "alto_interes_alta_conversion",
      "alto_interes_baja_conversion",
      "bajo_interes_alta_conversion",
      "bajo_interes_baja_conversion",
    ])
    .optional()
    .describe(
      "Filtra por segmento de interes/conversion. Los umbrales son la mediana observada, no valores fijos. Default: all.",
    ),
  sortBy: z
    .enum(["views", "units", "revenue", "conversion", "stock", "views_growth"])
    .optional()
    .describe("Criterio de ordenamiento. Default: views."),
  limit: z.number().int().min(1).max(25).optional(),
});

interface PerformanceRow {
  productId: string;
  sku: string;
  name: string;
  categoryId: string | null;
  views: number;
  uniqueViewers: number;
  addToCart: number;
  viewToCartRate: number;
  previousViews: number;
  viewsChange: number;
  viewsChangePercent: number | null;
  unitsSold: number;
  revenue: number;
  ordersWithProduct: number;
  ordersPerHundredViews: number | null;
  unitsPerHundredViews: number | null;
  price: number;
  offerPrice: number | null;
  discountPercent: number | null;
  hasActiveOffer: boolean;
  availableStock: number;
  minStock: number;
  daysOfSupply: number | null;
  segment: string | null;
}

const buildPerformanceRows = async (
  context: AnalyticsToolContext,
  period: ResolvedPeriod,
): Promise<{
  rows: PerformanceRow[];
  thresholds: { viewsThreshold: number; conversionThreshold: number };
  behaviorPage: Awaited<ReturnType<typeof loadBehaviorEvents>>;
  ordersPage: Awaited<ReturnType<typeof loadOrders>>;
  unknownProductIds: number;
  baseline: ResolvedPeriod;
}> => {
  const baseline = resolvePreviousPeriod(period);

  const [behaviorPage, baselinePage, ordersPage] = await Promise.all([
    loadBehaviorEvents(context, period, PRODUCT_TYPES),
    loadBehaviorEvents(context, baseline, PRODUCT_TYPES),
    loadOrders(context, period),
  ]);

  const behavior = aggregateProductBehavior(behaviorPage.events);
  const previousBehavior = aggregateProductBehavior(baselinePage.events);
  const sales = aggregateByProduct(ordersPage.orders);

  const productIds = Array.from(
    new Set([...behavior.keys(), ...sales.keys()]),
  );
  const products = await analyticsRepository.getProductsByIds(productIds);

  const rows: PerformanceRow[] = [];

  for (const productId of productIds) {
    const product = products.get(productId) as AnalyticsProduct | undefined;
    if (!product) {
      continue;
    }

    const interest = behavior.get(productId);
    const sale = sales.get(productId);
    const views = interest?.views ?? 0;
    const previousViews = previousBehavior.get(productId)?.views ?? 0;
    const unitsSold = sale?.units ?? 0;
    const dailyRate = unitsSold / Math.max(1, period.days);

    rows.push({
      productId,
      sku: product.sku,
      name: product.name,
      categoryId: product.categoriaId,
      views,
      uniqueViewers: interest?.uniqueViewers ?? 0,
      addToCart: interest?.addToCart ?? 0,
      viewToCartRate: interest?.viewToCartRate ?? 0,
      previousViews,
      viewsChange: views - previousViews,
      viewsChangePercent:
        previousViews > 0
          ? round2(((views - previousViews) / previousViews) * 100)
          : null,
      unitsSold,
      revenue: roundCurrency(sale?.revenue ?? 0),
      ordersWithProduct: sale?.orders ?? 0,
      ordersPerHundredViews:
        views > 0 ? round2(((sale?.orders ?? 0) / views) * 100) : null,
      unitsPerHundredViews: views > 0 ? round2((unitsSold / views) * 100) : null,
      price: product.price,
      offerPrice: product.offerPrice,
      discountPercent:
        product.hasActiveOffer && product.offerPrice !== null && product.price > 0
          ? round2((1 - product.offerPrice / product.price) * 100)
          : null,
      hasActiveOffer: product.hasActiveOffer,
      availableStock: product.availableStock,
      minStock: product.minStock,
      daysOfSupply:
        dailyRate > 0 ? Math.round(product.availableStock / dailyRate) : null,
      segment: null,
    });
  }

  const withViews = rows.filter((row) => row.views > 0);
  const viewsThreshold = round2(median(withViews.map((row) => row.views)));
  const conversionThreshold = round2(
    median(withViews.map((row) => row.ordersPerHundredViews ?? 0)),
  );

  for (const row of rows) {
    if (row.views <= 0) {
      continue;
    }

    row.segment = classifyInterest({
      views: row.views,
      conversion: row.ordersPerHundredViews ?? 0,
      viewsThreshold,
      conversionThreshold,
    });
  }

  return {
    rows,
    thresholds: { viewsThreshold, conversionThreshold },
    behaviorPage,
    ordersPage,
    unknownProductIds: productIds.length - rows.length,
    baseline,
  };
};

const getProductPerformance: AnalyticsTool = {
  name: "get_product_performance",
  description:
    "Desempeno completo por producto combinando telemetria y ventas reales: vistas, visitantes, agregados al carrito, unidades vendidas, ingresos, pedidos por cada 100 vistas, precio, descuento vigente, stock, dias de cobertura, tendencia de vistas y segmento de interes/conversion. Permite detectar productos con mucho interes y poca venta o con pocas vistas que convierten muy bien.",
  schema: productPerformanceSchema,
  execute: async (rawInput, context) => {
    const input = productPerformanceSchema.parse(rawInput);
    const period = resolveFromInput(input, context);
    const segment = input.segment ?? "all";
    const sortBy = input.sortBy ?? "views";
    const limit = input.limit ?? 10;

    const built = await buildPerformanceRows(context, period);
    const filtered =
      segment === "all"
        ? built.rows
        : built.rows.filter((row) => row.segment === segment);

    const sortValue = (row: PerformanceRow): number => {
      switch (sortBy) {
        case "units":
          return row.unitsSold;
        case "revenue":
          return row.revenue;
        case "conversion":
          return row.ordersPerHundredViews ?? -1;
        case "stock":
          return row.availableStock;
        case "views_growth":
          return row.viewsChange;
        default:
          return row.views;
      }
    };

    const sorted = [...filtered].sort((a, b) => sortValue(b) - sortValue(a));

    const segmentCounts = built.rows.reduce<Record<string, number>>(
      (acc, row) => {
        if (!row.segment) {
          return acc;
        }
        acc[row.segment] = (acc[row.segment] || 0) + 1;
        return acc;
      },
      {},
    );

    return {
      period: describePeriodForModel(period),
      baselinePeriod: describePeriodForModel(built.baseline),
      currency: "MXN",
      segment,
      sortBy,
      thresholds: {
        ...built.thresholds,
        explanation:
          "Alto interes = vistas iguales o superiores a la mediana de productos con vistas. Alta conversion = pedidos por 100 vistas iguales o superiores a la mediana de esos mismos productos.",
      },
      totals: {
        productsAnalyzed: built.rows.length,
        productsWithViews: built.rows.filter((row) => row.views > 0).length,
        productsWithSales: built.rows.filter((row) => row.unitsSold > 0).length,
        segmentCounts,
      },
      products: sorted.slice(0, limit),
      metricDefinitions: pickDefinitions([
        "productViews",
        "addToCartEvents",
        "viewToCartRate",
        "ordersPerHundredViews",
        "unitsPerHundredViews",
      ]),
      dataQuality: {
        ...buildBehaviorDataQuality(built.behaviorPage, period, {
          unknownProductIds: built.unknownProductIds,
        }),
        orders: buildDataQuality(built.ordersPage, period),
      },
    };
  },
};

/* ------------------------------------------------------------------ */
/* get_traffic_sources                                                 */
/* ------------------------------------------------------------------ */

const trafficSourcesSchema = z.object({
  ...periodShape,
  limit: z.number().int().min(1).max(25).optional(),
});

const getTrafficSources: AnalyticsTool = {
  name: "get_traffic_sources",
  description:
    "Origen del trafico por sesion (first touch): fuente, medio, campana, sesiones, vistas de producto, compras y conversion por canal. Solo reporta lo que la telemetria registro; las sesiones sin parametros de origen se agrupan como directo.",
  schema: trafficSourcesSchema,
  execute: async (rawInput, context) => {
    const input = trafficSourcesSchema.parse(rawInput);
    const period = resolveFromInput(input, context);
    const limit = input.limit ?? 10;

    const [page, availableFrom] = await Promise.all([
      loadBehaviorEvents(context, period, TRAFFIC_TYPES),
      loadEarliestEventDays(context, ["page_view"]),
    ]);

    const { groups, sessionsWithoutAttribution } = groupTrafficSources(
      page.events,
    );
    const totalSessions = groups.reduce((acc, group) => acc + group.sessions, 0);

    return {
      period: describePeriodForModel(period),
      totals: {
        sessions: totalSessions,
        channels: groups.length,
        sessionsWithoutAttribution,
        attributionCoverageRate: shareOfTotal(
          totalSessions - sessionsWithoutAttribution,
          totalSessions,
        ),
      },
      channels: groups.slice(0, limit).map((group) => ({
        ...group,
        sessionShare: shareOfTotal(group.sessions, totalSessions),
      })),
      attributionNote:
        "Atribucion de primer contacto dentro del periodo y a nivel sesion. No hay atribucion multitoque ni ventana de conversion posterior, por lo que una compra hecha en una sesion distinta no se asigna al canal que la origino.",
      metricDefinitions: pickDefinitions([
        "sessions",
        "productViews",
        "purchases",
        "sessionConversionRate",
      ]),
      dataQuality: buildBehaviorDataQuality(page, period, { availableFrom }),
    };
  },
};

/* ------------------------------------------------------------------ */
/* analyze_metric_relationships                                        */
/* ------------------------------------------------------------------ */

const relationshipSchema = z.object({
  ...periodShape,
  relationship: z
    .enum(RELATIONSHIP_KEYS)
    .describe("Relacion a analizar. Solo se permiten las relaciones listadas."),
  limit: z
    .number()
    .int()
    .min(5)
    .max(60)
    .optional()
    .describe("Maximo de puntos devueltos para graficar. Default 40."),
});

const buildTimeSeriesPoints = (
  relationship: RelationshipKey,
  behavior: BehaviorDailyPoint[],
  sales: ReturnType<typeof buildDailySeries>,
): CorrelationPoint[] => {
  const salesByDay = new Map(sales.map((point) => [point.date, point]));

  return behavior.map((point) => {
    const sale = salesByDay.get(point.date);
    const orders = sale?.orders ?? 0;
    const units = sale?.units ?? 0;
    const revenue = sale?.revenue ?? 0;

    switch (relationship) {
      case "visits_vs_revenue":
        return { label: point.date, x: point.visits, y: revenue };
      case "visits_vs_orders":
        return { label: point.date, x: point.visits, y: orders };
      case "product_views_vs_units":
        return { label: point.date, x: point.productViews, y: units };
      case "add_to_cart_vs_orders":
        return { label: point.date, x: point.addToCart, y: orders };
      case "sessions_vs_conversion":
        return {
          label: point.date,
          x: point.sessions,
          y: point.sessions > 0 ? round2((point.purchases / point.sessions) * 100) : 0,
        };
      default:
        return { label: point.date, x: point.visits, y: revenue };
    }
  });
};

const analyzeMetricRelationships: AnalyticsTool = {
  name: "analyze_metric_relationships",
  description:
    "Analiza la relacion entre dos metricas permitidas (por ejemplo visitas vs ingresos, vistas de producto vs unidades vendidas, stock vs ventas o descuento vs conversion) y devuelve los puntos, la correlacion de Pearson y Spearman, la fuerza y la advertencia de que correlacion no es causalidad. No ejecuta calculos arbitrarios: solo las relaciones declaradas.",
  schema: relationshipSchema,
  execute: async (rawInput, context) => {
    const input = relationshipSchema.parse(rawInput);
    const period = resolveFromInput(input, context);
    const definition = RELATIONSHIP_CATALOG[input.relationship];
    const limit = input.limit ?? 40;

    let points: CorrelationPoint[] = [];
    let dataQuality: Record<string, unknown> = {};

    if (definition.unit === "tiempo") {
      const [page, ordersPage] = await Promise.all([
        loadBehaviorEvents(context, period, TRAFFIC_TYPES),
        loadOrders(context, period),
      ]);

      points = buildTimeSeriesPoints(
        input.relationship,
        buildBehaviorDailySeries(page.events, period),
        buildDailySeries(ordersPage.orders, period),
      );

      dataQuality = {
        ...buildBehaviorDataQuality(page, period),
        orders: buildDataQuality(ordersPage, period),
      };
    } else {
      const built = await buildPerformanceRows(context, period);

      const candidates =
        input.relationship === "discount_vs_conversion_by_product"
          ? built.rows.filter(
              (row) => row.views > 0 && row.discountPercent !== null,
            )
          : built.rows.filter((row) => row.views > 0 || row.unitsSold > 0);

      points = candidates.map((row) => {
        switch (input.relationship) {
          case "stock_vs_units_by_product":
            return { label: row.name, x: row.availableStock, y: row.unitsSold };
          case "discount_vs_conversion_by_product":
            return {
              label: row.name,
              x: row.discountPercent ?? 0,
              y: row.ordersPerHundredViews ?? 0,
            };
          default:
            return { label: row.name, x: row.views, y: row.unitsSold };
        }
      });

      dataQuality = {
        ...buildBehaviorDataQuality(built.behaviorPage, period, {
          unknownProductIds: built.unknownProductIds,
        }),
        orders: buildDataQuality(built.ordersPage, period),
      };
    }

    const correlation = analyzeCorrelation(points);

    return {
      period: describePeriodForModel(period),
      relationship: definition,
      correlation,
      causality:
        "no_determinada: este analisis mide asociacion estadistica, no causa. No presentar como prueba de que una metrica provoca la otra.",
      points: summarizePoints(points, limit),
      pointsOmitted: Math.max(0, points.length - limit),
      dataQuality,
    };
  },
};

/* ------------------------------------------------------------------ */
/* forecast_metric                                                     */
/* ------------------------------------------------------------------ */

const FORECAST_METRICS = [
  "revenue",
  "orders",
  "units",
  "visits",
  "sessions",
  "product_views",
] as const;

type ForecastMetricKey = (typeof FORECAST_METRICS)[number];

const FORECAST_METRIC_LABELS: Record<ForecastMetricKey, string> = {
  revenue: "Ingresos de pedidos pagados",
  orders: "Pedidos pagados",
  units: "Unidades vendidas",
  visits: "Visitas (page views)",
  sessions: "Sesiones",
  product_views: "Vistas de producto",
};

const forecastSchema = z.object({
  metric: z
    .enum(FORECAST_METRICS)
    .describe("Metrica a proyectar. Solo se permiten estas metricas."),
  horizon: z
    .number()
    .int()
    .min(1)
    .max(MAX_FORECAST_HORIZON)
    .optional()
    .describe(
      `Dias a proyectar. Recomendado 7, 14 o 30. Maximo ${MAX_FORECAST_HORIZON}. Default 7.`,
    ),
  historyDays: z
    .number()
    .int()
    .min(21)
    .max(180)
    .optional()
    .describe("Dias de historial usados para entrenar y validar. Default 90."),
  productId: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe(
      'Solo para metric="units": proyecta las unidades de un producto especifico.',
    ),
});

const forecastMetric: AnalyticsTool = {
  name: "forecast_metric",
  description:
    "Proyeccion calculada en el backend para ingresos, pedidos, unidades, visitas, sesiones o vistas de producto. Compara varios metodos estadisticos simples por backtesting, elige el de menor error historico y devuelve historico, valores esperados, rango de incertidumbre, metodo, calidad y error (MAE, RMSE, MAPE). Si no hay historial suficiente devuelve available=false y explica que falta. Nunca inventes un pronostico sin llamar esta herramienta.",
  schema: forecastSchema,
  execute: async (rawInput, context) => {
    const input = forecastSchema.parse(rawInput);
    const horizon = input.horizon ?? 7;
    const historyDays = input.historyDays ?? 90;
    const usesOrders =
      input.metric === "revenue" ||
      input.metric === "orders" ||
      input.metric === "units";

    const period = resolveCompletedWindow(context.now, historyDays);
    const notes: string[] = [
      "El historial termina ayer: el dia en curso se excluye porque estaria incompleto y sesgaria la proyeccion.",
    ];

    let series: SeriesPoint[] = [];
    let dataQuality: Record<string, unknown> = {};

    if (usesOrders) {
      const ordersPage = await loadOrders(context, period);
      const daily = buildDailySeries(ordersPage.orders, period);

      series = daily.map((point) => ({
        date: point.date,
        value:
          input.metric === "revenue"
            ? point.revenue
            : input.metric === "orders"
              ? point.orders
              : point.units,
      }));

      if (input.productId && input.metric === "units") {
        const productSeries = new Map(
          daily.map((point) => [point.date, 0] as [string, number]),
        );

        for (const order of ordersPage.orders) {
          if (!isPaidOrder(order) || !productSeries.has(order.dayKey)) {
            continue;
          }

          const units = order.items
            .filter((item) => item.productoId === input.productId)
            .reduce((acc, item) => acc + item.cantidad, 0);

          if (units > 0) {
            productSeries.set(
              order.dayKey,
              (productSeries.get(order.dayKey) || 0) + units,
            );
          }
        }

        series = Array.from(productSeries.entries()).map(([date, value]) => ({
          date,
          value,
        }));
        notes.push(`Serie filtrada al producto ${input.productId}.`);
      }

      dataQuality = buildDataQuality(ordersPage, period);
    } else {
      const types: BehaviorEventType[] =
        input.metric === "product_views"
          ? ["product_view"]
          : input.metric === "visits"
            ? ["page_view"]
            : [...BEHAVIOR_EVENT_TYPES];

      const [page, availableFrom] = await Promise.all([
        loadBehaviorEvents(context, period, types),
        loadEarliestEventDays(context, types),
      ]);

      const daily = buildBehaviorDailySeries(page.events, period);
      series = daily.map((point) => ({
        date: point.date,
        value:
          input.metric === "visits"
            ? point.visits
            : input.metric === "sessions"
              ? point.sessions
              : point.productViews,
      }));

      // Recortar el historial al primer dia con telemetria real evita entrenar
      // el modelo con ceros de un periodo en el que aun no se registraba nada.
      const firstAvailable = Object.values(availableFrom)
        .filter((day): day is string => Boolean(day))
        .sort()[0];

      if (firstAvailable) {
        const before = series.length;
        series = series.filter((point) => point.date >= firstAvailable);
        if (series.length < before) {
          notes.push(
            `El historial se recorta al ${firstAvailable}, primer dia con telemetria de esta metrica.`,
          );
        }
      }

      dataQuality = buildBehaviorDataQuality(page, period, { availableFrom });
    }

    const outcome = forecastSeries({ series, horizon, nonNegative: true });

    return {
      metric: input.metric,
      metricLabel: FORECAST_METRIC_LABELS[input.metric],
      currency: usesOrders && input.metric === "revenue" ? "MXN" : undefined,
      historyPeriod: describePeriodForModel(period),
      minimumObservations: MIN_FORECAST_OBSERVATIONS,
      forecast: outcome,
      notes: outcome.available ? [...notes, ...outcome.notes] : notes,
      dataQuality,
    };
  },
};

/* ------------------------------------------------------------------ */
/* detect_business_anomalies                                           */
/* ------------------------------------------------------------------ */

const anomaliesSchema = z.object({
  focus: z
    .enum(["all", "sales", "traffic", "conversion", "products"])
    .optional()
    .describe("Que area revisar. Default: all."),
  lookbackDays: z
    .number()
    .int()
    .min(21)
    .max(120)
    .optional()
    .describe("Dias completos usados como historial. Default 45."),
  recentDays: z
    .number()
    .int()
    .min(1)
    .max(14)
    .optional()
    .describe("Dias recientes evaluados contra la linea base. Default 7."),
  limit: z.number().int().min(1).max(20).optional(),
});

const detectBusinessAnomalies: AnalyticsTool = {
  name: "detect_business_anomalies",
  description:
    "Detecta comportamientos fuera de lo habitual comparando los ultimos dias contra la mediana y la dispersion robusta del propio historial: caidas o picos de ventas, pedidos, visitas, vistas de producto y conversion, productos con muchas vistas y cero ventas e inventario que se agota muy rapido. Devuelve valor observado, rango esperado, severidad y evidencia. Un cambio pequeno no se reporta como anomalia.",
  schema: anomaliesSchema,
  execute: async (rawInput, context) => {
    const input = anomaliesSchema.parse(rawInput);
    const focus = input.focus ?? "all";
    const lookbackDays = input.lookbackDays ?? 45;
    const recentDays = input.recentDays ?? 7;
    const limit = input.limit ?? 8;

    const period = resolveCompletedWindow(context.now, lookbackDays);
    const wantsSales = focus === "all" || focus === "sales";
    const wantsTraffic = focus === "all" || focus === "traffic";
    const wantsConversion = focus === "all" || focus === "conversion";
    const wantsProducts = focus === "all" || focus === "products";
    const needsBehavior = wantsTraffic || wantsConversion || wantsProducts;

    const findings: AnomalyFinding[] = [];
    const skipped: string[] = [];
    const dataQuality: Record<string, unknown> = {};

    if (wantsSales || wantsConversion || wantsProducts) {
      const ordersPage = await loadOrders(context, period);
      const daily = buildDailySeries(ordersPage.orders, period);
      dataQuality.orders = buildDataQuality(ordersPage, period);

      if (wantsSales) {
        for (const [metric, label, pick] of [
          ["revenue", "Ingresos diarios", (point: (typeof daily)[number]) => point.revenue],
          ["orders", "Pedidos pagados diarios", (point: (typeof daily)[number]) => point.orders],
          ["units", "Unidades vendidas diarias", (point: (typeof daily)[number]) => point.units],
        ] as const) {
          const result = detectSeriesAnomalies({
            metric,
            metricLabel: label,
            series: daily.map((point) => ({ date: point.date, value: pick(point) })),
            recentDays,
          });

          findings.push(...result.findings);
          if (result.skippedReason) {
            skipped.push(result.skippedReason);
          }
        }
      }
    }

    if (needsBehavior) {
      const [page, availableFrom] = await Promise.all([
        loadBehaviorEvents(context, period, TRAFFIC_TYPES),
        loadEarliestEventDays(context, TRAFFIC_TYPES),
      ]);
      const daily = buildBehaviorDailySeries(page.events, period);
      dataQuality.behavior = buildBehaviorDataQuality(page, period, {
        availableFrom,
      });

      if (wantsTraffic) {
        for (const [metric, label, pick] of [
          ["visits", "Visitas diarias", (point: BehaviorDailyPoint) => point.visits],
          ["sessions", "Sesiones diarias", (point: BehaviorDailyPoint) => point.sessions],
          [
            "product_views",
            "Vistas de producto diarias",
            (point: BehaviorDailyPoint) => point.productViews,
          ],
        ] as const) {
          const result = detectSeriesAnomalies({
            metric,
            metricLabel: label,
            series: daily.map((point) => ({ date: point.date, value: pick(point) })),
            recentDays,
          });

          findings.push(...result.findings);
          if (result.skippedReason) {
            skipped.push(result.skippedReason);
          }
        }
      }

      if (wantsConversion) {
        const result = detectSeriesAnomalies({
          metric: "session_conversion_rate",
          metricLabel: "Conversion de sesion (%)",
          series: daily.map((point) => ({
            date: point.date,
            value:
              point.sessions > 0
                ? round2((point.purchases / point.sessions) * 100)
                : 0,
          })),
          recentDays,
        });

        findings.push(...result.findings);
        if (result.skippedReason) {
          skipped.push(result.skippedReason);
        }
      }

      if (wantsProducts) {
        const built = await buildPerformanceRows(context, period);
        const viewCounts = built.rows
          .map((row) => row.views)
          .filter((views) => views > 0)
          .sort((a, b) => a - b);

        if (viewCounts.length === 0) {
          skipped.push(
            "No hay productos con vistas registradas en la ventana analizada.",
          );
        } else {
          const threshold = Math.max(1, Math.round(percentile(viewCounts, 75)));
          const products: ProductAnomalyInput[] = built.rows.map((row) => ({
            productId: row.productId,
            name: row.name,
            views: row.views,
            addToCart: row.addToCart,
            unitsSold: row.unitsSold,
            availableStock: row.availableStock,
            daysOfSupply: row.daysOfSupply,
          }));

          findings.push(
            ...detectProductAnomalies({
              products,
              highInterestViewsThreshold: threshold,
              limit: Math.max(3, Math.floor(limit / 2)),
            }),
          );
        }
      }
    }

    const ranked = rankAnomalies(findings);

    return {
      analysisWindow: describePeriodForModel(period),
      recentDaysEvaluated: recentDays,
      focus,
      method:
        "Mediana + desviacion absoluta mediana (MAD) de la linea base. Se marca anomalia cuando el desvio robusto supera 3 (media) o 4.5 (alta) y ademas el cambio es material frente al nivel habitual.",
      totals: {
        anomaliesFound: ranked.length,
        high: ranked.filter((finding) => finding.severity === "alta").length,
        medium: ranked.filter((finding) => finding.severity === "media").length,
        low: ranked.filter((finding) => finding.severity === "baja").length,
      },
      anomalies: ranked.slice(0, limit),
      notEvaluated: skipped,
      dataQuality,
    };
  },
};

export const BEHAVIOR_TOOLS: AnalyticsTool[] = [
  getTrafficSummary,
  getConversionFunnel,
  getProductInterest,
  getProductPerformance,
  getTrafficSources,
  analyzeMetricRelationships,
  forecastMetric,
  detectBusinessAnomalies,
];

export const __behaviorToolsTestables = {
  resolveCompletedWindow,
  buildPerformanceRows,
  buildFunnelPayload,
  FORECAST_METRIC_LABELS,
};
