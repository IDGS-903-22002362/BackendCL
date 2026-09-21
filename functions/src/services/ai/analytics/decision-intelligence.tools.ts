/**
 * Tools READ-ONLY de decision intelligence (fase 3).
 *
 * Reutilizan los loaders/cache del Asistente Administrativo. Ninguna tool
 * escribe datos ni acepta codigo, expresiones o nombres de colecciones.
 */

import { z } from "zod";
import { isPaidOrder, summarizeSales } from "./analytics.metrics";
import analyticsRepository from "./analytics.repository";
import {
  AnalyticsTool,
  AnalyticsToolContext,
  buildDataQuality,
  loadBehaviorEvents,
  loadCatalogProducts,
  loadOrders,
  periodShape,
  resolveFromInput,
} from "./analytics.tool-kit";
import { buildPerformanceRows } from "./behavior.tools";
import { summarizeTraffic } from "./behavior.metrics";
import {
  BusinessPriority,
  EvidenceLevel,
  analyzeAffinity,
  buildCustomerCohorts,
  buildCustomerSegments,
  decomposeMultiplicativeChange,
  gradeEvidence,
  scoreBusinessPriority,
  segmentProducts as calculateProductSegments,
  simulateScenario,
} from "./decision-intelligence.metrics";
import {
  ResolvedPeriod,
  describePeriodForModel,
  resolvePreviousPeriod,
} from "./period.util";

const round2 = (value: number): number => Math.round(value * 100) / 100;
const percentChange = (current: number, previous: number): number | null =>
  previous === 0 ? null : round2(((current - previous) / Math.abs(previous)) * 100);

const source = (
  label: string,
  period: ResolvedPeriod,
  context: AnalyticsToolContext,
  coverage: "complete" | "partial" = "complete",
) => ({
  label,
  period: describePeriodForModel(period),
  observedAt: context.now.toISOString(),
  coverage,
});

interface Finding {
  id: string;
  area: string;
  title: string;
  classification: "observed" | "inference";
  metric: string;
  current: number;
  previous?: number;
  changePercent: number | null;
  direction: "positive" | "negative" | "neutral";
  evidence: EvidenceLevel;
  priority: BusinessPriority;
  priorityScore: number;
  explanation: string;
  limitations: string[];
}

const freshnessDays = (period: ResolvedPeriod, now: Date): number =>
  Math.max(0, Math.ceil((now.getTime() - period.endExclusive.getTime()) / 86_400_000));

const findingFromVariation = (input: {
  id: string;
  area: string;
  title: string;
  metric: string;
  current: number;
  previous: number;
  sampleSize: number;
  coverageComplete: boolean;
  period: ResolvedPeriod;
  context: AnalyticsToolContext;
  actionability?: number;
}): Finding | null => {
  const change = percentChange(input.current, input.previous);
  if (change === null) return null;
  const evidence = gradeEvidence({
    sampleSize: input.sampleSize,
    coverageComplete: input.coverageComplete,
    freshnessDays: freshnessDays(input.period, input.context.now),
    consistentSignals: 1,
    trackingQuality: input.coverageComplete ? "complete" : "partial",
  });
  const magnitude = Math.min(1, Math.abs(change) / 30);
  const direction = change > 2 ? "positive" : change < -2 ? "negative" : "neutral";
  const scored = scoreBusinessPriority({
    impact: input.metric === "revenue" ? 1 : 0.7,
    magnitude,
    urgency: direction === "negative" ? magnitude : 0.35,
    evidence,
    trend: magnitude,
    actionability: input.actionability ?? 0.7,
    opportunity: direction === "positive",
  });
  return {
    id: input.id,
    area: input.area,
    title: input.title,
    classification: "observed",
    metric: input.metric,
    current: round2(input.current),
    previous: round2(input.previous),
    changePercent: change,
    direction,
    evidence,
    priority: scored.priority,
    priorityScore: scored.score,
    explanation: `${input.title}: ${change > 0 ? "+" : ""}${change}% frente al periodo anterior. Es una variacion observada, no una causa.`,
    limitations: input.coverageComplete
      ? []
      : ["La fuente alcanzo su limite de lectura; la cobertura del periodo es parcial."],
  };
};

const buildBusinessFindings = async (input: {
  period: ResolvedPeriod;
  context: AnalyticsToolContext;
  areas: string[];
}): Promise<{ findings: Finding[]; dataQuality: Record<string, unknown> }> => {
  const previous = resolvePreviousPeriod(input.period);
  const [currentOrders, previousOrders, currentBehavior, previousBehavior] =
    await Promise.all([
      loadOrders(input.context, input.period),
      loadOrders(input.context, previous),
      loadBehaviorEvents(input.context, input.period),
      loadBehaviorEvents(input.context, previous),
    ]);
  const currentSales = summarizeSales(currentOrders.orders);
  const previousSales = summarizeSales(previousOrders.orders);
  const currentTraffic = summarizeTraffic(currentBehavior.events);
  const previousTraffic = summarizeTraffic(previousBehavior.events);
  const findings = [
    findingFromVariation({
      id: "sales-revenue",
      area: "sales",
      title: "Ingresos confirmados",
      metric: "revenue",
      current: currentSales.revenue,
      previous: previousSales.revenue,
      sampleSize: currentSales.paidOrders,
      coverageComplete: !currentOrders.truncated && !previousOrders.truncated,
      period: input.period,
      context: input.context,
    }),
    findingFromVariation({
      id: "sales-orders",
      area: "orders",
      title: "Pedidos pagados",
      metric: "paidOrders",
      current: currentSales.paidOrders,
      previous: previousSales.paidOrders,
      sampleSize: currentOrders.orders.length,
      coverageComplete: !currentOrders.truncated && !previousOrders.truncated,
      period: input.period,
      context: input.context,
    }),
    findingFromVariation({
      id: "sales-aov",
      area: "sales",
      title: "Ticket promedio",
      metric: "averageOrderValue",
      current: currentSales.averageOrderValue,
      previous: previousSales.averageOrderValue,
      sampleSize: currentSales.paidOrders,
      coverageComplete: !currentOrders.truncated && !previousOrders.truncated,
      period: input.period,
      context: input.context,
    }),
    findingFromVariation({
      id: "traffic-sessions",
      area: "traffic",
      title: "Sesiones registradas",
      metric: "sessions",
      current: currentTraffic.sessions,
      previous: previousTraffic.sessions,
      sampleSize: currentTraffic.sessions,
      coverageComplete: !currentBehavior.truncated && !previousBehavior.truncated,
      period: input.period,
      context: input.context,
    }),
    findingFromVariation({
      id: "funnel-conversion",
      area: "conversion",
      title: "Conversion de sesion",
      metric: "sessionConversionRate",
      current: currentTraffic.sessionConversionRate,
      previous: previousTraffic.sessionConversionRate,
      sampleSize: currentTraffic.sessions,
      coverageComplete: !currentBehavior.truncated && !previousBehavior.truncated,
      period: input.period,
      context: input.context,
    }),
  ].filter((finding): finding is Finding => finding !== null);

  if (input.areas.includes("inventory") || input.areas.includes("products")) {
    const built = await buildPerformanceRows(input.context, input.period);
    const segmented = calculateProductSegments(
      built.rows.map((row) => ({
        productId: row.productId,
        name: row.name,
        views: row.views,
        conversion: row.ordersPerHundredViews ?? 0,
        revenue: row.revenue,
        growthPercent: row.viewsChangePercent,
        availableStock: row.availableStock,
        minStock: row.minStock,
        daysOfSupply: row.daysOfSupply,
      })),
    );
    const evidence = gradeEvidence({
      sampleSize: built.rows.filter((row) => row.views > 0).length,
      coverageComplete:
        !built.behaviorPage.truncated && !built.ordersPage.truncated,
      freshnessDays: freshnessDays(input.period, input.context.now),
      consistentSignals: 2,
      trackingQuality: built.behaviorPage.truncated ? "partial" : "complete",
    });
    const stockRisk = segmented.products.filter((product) =>
      product.segments.includes("STOCK_RISK"),
    );
    if (input.areas.includes("inventory") && stockRisk.length > 0) {
      const scored = scoreBusinessPriority({
        impact: Math.min(1, stockRisk.length / 5),
        magnitude: Math.min(1, stockRisk.length / Math.max(1, built.rows.length)),
        urgency: 0.95,
        evidence,
        trend: 0.7,
        actionability: 0.9,
      });
      findings.push({
        id: "inventory-stock-risk",
        area: "inventory",
        title: "Productos con riesgo de agotarse",
        classification: "observed",
        metric: "stockRiskProducts",
        current: stockRisk.length,
        changePercent: null,
        direction: "negative",
        evidence,
        priority: scored.priority,
        priorityScore: scored.score,
        explanation: `${stockRisk.length} productos tienen stock en/bajo minimo o hasta 14 dias de cobertura.`,
        limitations: [],
      });
    }
    const opportunity = segmented.products
      .filter((product) => product.segments.includes("OPPORTUNITIES"))
      .sort((a, b) => b.opportunityScore - a.opportunityScore)[0];
    if (input.areas.includes("products") && opportunity) {
      const scored = scoreBusinessPriority({
        impact: 0.65,
        magnitude: opportunity.opportunityScore / 100,
        urgency: 0.4,
        evidence,
        trend: Math.max(0, opportunity.growthPercent ?? 0) / 100,
        actionability: 0.8,
        opportunity: true,
      });
      findings.push({
        id: `product-opportunity-${opportunity.productId}`,
        area: "products",
        title: `Oportunidad en ${opportunity.name}`,
        classification: "observed",
        metric: "opportunityScore",
        current: opportunity.opportunityScore,
        changePercent: opportunity.growthPercent,
        direction: "positive",
        evidence,
        priority: scored.priority,
        priorityScore: scored.score,
        explanation:
          "Alto interes y conversion inferior a la mediana; el score es orientativo y no garantiza impacto.",
        limitations: [],
      });
    }
  }

  const filtered = findings.filter((finding) => input.areas.includes(finding.area));
  return {
    findings: filtered.sort(
      (a, b) => b.priorityScore - a.priorityScore || a.id.localeCompare(b.id),
    ),
    dataQuality: {
      orders: buildDataQuality(currentOrders, input.period),
      behavior: {
        eventsScanned: currentBehavior.events.length,
        truncated: currentBehavior.truncated,
        notes: currentBehavior.truncated
          ? ["La telemetria alcanzo el limite de lectura y puede estar incompleta."]
          : [],
      },
    },
  };
};

const prioritySchema = z
  .object({
    ...periodShape,
    areas: z
      .array(z.enum(["sales", "orders", "traffic", "conversion", "inventory", "products"]))
      .min(1)
      .max(6)
      .optional(),
    limit: z.number().int().min(1).max(7).optional(),
  })
  .strict();

const prioritizeBusinessFindings: AnalyticsTool = {
  name: "prioritize_business_findings",
  description:
    "Prioriza hallazgos observados de ventas, pedidos, trafico y conversion con score determinista de impacto, magnitud, urgencia, evidencia, tendencia y capacidad de actuar. No acepta hallazgos inventados por el modelo.",
  schema: prioritySchema,
  execute: async (rawInput, context) => {
    const input = prioritySchema.parse(rawInput);
    const period = resolveFromInput(input, context);
    const areas = input.areas ?? ["sales", "orders", "traffic", "conversion", "inventory", "products"];
    const result = await buildBusinessFindings({ period, context, areas });
    return {
      period: describePeriodForModel(period),
      methodology:
        "Score 0-100: impacto 30%, magnitud 20%, urgencia 20%, evidencia 15%, tendencia 5% y capacidad de actuar 10%.",
      findings: result.findings.slice(0, input.limit ?? 7),
      dataQuality: result.dataQuality,
      source: source("Ventas confirmadas y telemetria agregada", period, context),
    };
  },
};

const decomposeSchema = z
  .object({
    ...periodShape,
    metric: z.enum(["revenue"]),
  })
  .strict();

const decomposeMetricChange: AnalyticsTool = {
  name: "decompose_metric_change",
  description:
    "Descompone matematicamente el cambio de ingresos entre el periodo y su periodo previo. Usa pedidos pagados x ticket promedio; cuantifica contribuciones Shapley y nunca afirma causalidad.",
  schema: decomposeSchema,
  execute: async (rawInput, context) => {
    const input = decomposeSchema.parse(rawInput);
    const period = resolveFromInput(input, context);
    const previous = resolvePreviousPeriod(period);
    const [currentPage, previousPage] = await Promise.all([
      loadOrders(context, period),
      loadOrders(context, previous),
    ]);
    const current = summarizeSales(currentPage.orders);
    const baseline = summarizeSales(previousPage.orders);
    const available =
      !currentPage.truncated &&
      !previousPage.truncated &&
      current.paidOrders > 0 &&
      baseline.paidOrders > 0;
    return {
      available,
      metric: input.metric,
      currentPeriod: describePeriodForModel(period),
      baselinePeriod: describePeriodForModel(previous),
      formula: "revenue = paidOrders * averageOrderValue",
      method:
        "Descomposicion Shapley de una identidad multiplicativa; los aportes suman exactamente la variacion salvo redondeo.",
      interpretation:
        "Los componentes explican matematicamente la variacion observada; no demuestran que uno haya causado al otro.",
      decomposition: available
        ? decomposeMultiplicativeChange([
            {
              key: "paidOrders",
              previous: baseline.paidOrders,
              current: current.paidOrders,
            },
            {
              key: "averageOrderValue",
              previous: baseline.averageOrderValue,
              current: current.averageOrderValue,
            },
          ])
        : null,
      limitations: available
        ? []
        : ["Se requiere cobertura completa y pedidos pagados en ambos periodos."],
      dataQuality: {
        current: buildDataQuality(currentPage, period),
        baseline: buildDataQuality(previousPage, previous),
      },
      diagram: available
        ? {
            diagramType: "cause-tree",
            title: "Descomposicion matematica de ingresos",
            nodes: [
              { id: "revenue", label: "Ingresos", value: current.revenue },
              { id: "orders", label: "Pedidos pagados", value: current.paidOrders },
              { id: "aov", label: "Ticket promedio", value: current.averageOrderValue },
            ],
            edges: [
              { from: "revenue", to: "orders", label: "componente" },
              { from: "revenue", to: "aov", label: "componente" },
            ],
          }
        : null,
      source: source("Pedidos pagados", period, context),
    };
  },
};

const adjustmentsSchema = z
  .object({
    trafficPercent: z.number().min(-90).max(500).optional(),
    conversionRatePercent: z.number().min(-90).max(500).optional(),
    averageOrderValuePercent: z.number().min(-90).max(500).optional(),
    unitsPercent: z.number().min(-90).max(500).optional(),
    pricePercent: z.number().min(-90).max(500).optional(),
    discountPoints: z.number().min(-100).max(100).optional(),
  })
  .strict()
  .refine((value) => Object.values(value).some((entry) => entry !== undefined), {
    message: "Incluye al menos un cambio permitido",
  });

const simulationSchema = z
  .object({
    ...periodShape,
    adjustments: adjustmentsSchema,
    scenarioName: z.string().trim().min(1).max(80).optional(),
  })
  .strict();

const simulateBusinessScenario: AnalyticsTool = {
  name: "simulate_business_scenario",
  description:
    "Simula un what-if matematico con cambios porcentuales allowlisted en trafico, conversion, ticket promedio, unidades, precio o descuento. No ejecuta acciones, no acepta expresiones y no supone elasticidad ni probabilidades.",
  schema: simulationSchema,
  execute: async (rawInput, context) => {
    const input = simulationSchema.parse(rawInput);
    const period = resolveFromInput(input, context);
    const [ordersPage, behaviorPage] = await Promise.all([
      loadOrders(context, period),
      loadBehaviorEvents(context, period),
    ]);
    const sales = summarizeSales(ordersPage.orders);
    const traffic = summarizeTraffic(behaviorPage.events);
    const sessions = traffic.sessions;
    const purchaseCoverageRatio =
      Math.max(sales.paidOrders, traffic.purchases) > 0
        ? Math.min(sales.paidOrders, traffic.purchases) /
          Math.max(sales.paidOrders, traffic.purchases)
        : 0;
    const available =
      sessions > 0 &&
      sales.paidOrders > 0 &&
      traffic.purchases > 0 &&
      purchaseCoverageRatio >= 0.5 &&
      !ordersPage.truncated &&
      !behaviorPage.truncated;
    const baselineConversion =
      sessions > 0 ? round2((sales.paidOrders / sessions) * 100) : 0;
    const calculation = available
      ? simulateScenario(
          {
            traffic: sessions,
            conversionRate: baselineConversion,
            averageOrderValue: sales.averageOrderValue,
            units: sales.units,
            price:
              sales.units > 0 ? round2(sales.revenue / sales.units) : undefined,
            discount:
              sales.revenue + sales.discounts > 0
                ? round2((sales.discounts / (sales.revenue + sales.discounts)) * 100)
                : 0,
          },
          input.adjustments,
        )
      : null;

    return {
      available,
      scenarioType: "simulation",
      title: input.scenarioName || "Escenario simulado",
      period: describePeriodForModel(period),
      adjustments: input.adjustments,
      calculation,
      formula:
        "revenue = traffic * (conversionRate / 100) * averageOrderValue; cambios porcentuales se combinan multiplicativamente.",
      assumptions: [
        "Las demas variables permanecen constantes.",
        "La conversion operativa usa pedidos pagados / sesiones del mismo periodo.",
        "Pedidos y sesiones son fuentes distintas; se exige concordancia minima de 50% entre compras medidas.",
        "Un cambio de precio no implica un cambio de demanda.",
      ],
      limitations: [
        "Es una simulacion matematica, no un forecast ni una garantia.",
        "No modela elasticidad, estacionalidad, competencia ni efectos causales.",
        ...(!available
          ? ["Se requieren sesiones, pedidos pagados y cobertura completa en el periodo."]
          : []),
        ...(purchaseCoverageRatio < 0.5
          ? ["La telemetria de compra no concuerda suficientemente con los pedidos pagados."]
          : []),
      ],
      source: source(
        "Pedidos pagados y sesiones agregadas",
        period,
        context,
        ordersPage.truncated || behaviorPage.truncated ? "partial" : "complete",
      ),
    };
  },
};

const segmentProductsSchema = z
  .object({
    ...periodShape,
    category: z.string().trim().min(1).max(120).optional(),
    segment: z
      .enum([
        "ALL",
        "STARS",
        "OPPORTUNITIES",
        "EFFICIENT",
        "STAGNANT",
        "STOCK_RISK",
        "OVERSTOCK",
        "GROWING",
        "DECLINING",
      ])
      .optional(),
    limit: z.number().int().min(1).max(50).optional(),
  })
  .strict();

const segmentProductsTool: AnalyticsTool = {
  name: "segment_products",
  description:
    "Clasifica productos con umbrales dinamicos por interes/conversion, inventario y tendencia. Devuelve cuadrantes, riesgo de stock, sobreinventario y un opportunity score determinista.",
  schema: segmentProductsSchema,
  execute: async (rawInput, context) => {
    const input = segmentProductsSchema.parse(rawInput);
    const period = resolveFromInput(input, context);
    const [built, catalog] = await Promise.all([
      buildPerformanceRows(context, period),
      loadCatalogProducts(context),
    ]);
    const measuredById = new Map(built.rows.map((row) => [row.productId, row]));
    const allRows = catalog.products.map((product) => {
      const measured = measuredById.get(product.id);
      return measured || {
        productId: product.id,
        sku: product.sku,
        name: product.name,
        categoryId: product.categoriaId,
        views: 0,
        uniqueViewers: 0,
        addToCart: 0,
        viewToCartRate: 0,
        previousViews: 0,
        viewsChange: 0,
        viewsChangePercent: null,
        unitsSold: 0,
        revenue: 0,
        ordersWithProduct: 0,
        ordersPerHundredViews: null,
        unitsPerHundredViews: null,
        price: product.price,
        offerPrice: product.offerPrice,
        discountPercent: null,
        hasActiveOffer: product.hasActiveOffer,
        availableStock: product.availableStock,
        minStock: product.minStock,
        daysOfSupply: null,
        segment: null,
      };
    });
    const selected = input.category
      ? allRows.filter((row) => row.categoryId === input.category)
      : allRows;
    const segmented = calculateProductSegments(
      selected.map((row) => ({
        productId: row.productId,
        name: row.name,
        views: row.views,
        conversion: row.ordersPerHundredViews ?? 0,
        revenue: row.revenue,
        growthPercent: row.viewsChangePercent,
        availableStock: row.availableStock,
        minStock: row.minStock,
        daysOfSupply: row.daysOfSupply,
      })),
    );
    const desired = input.segment ?? "ALL";
    const products = segmented.products
      .filter((product) => desired === "ALL" || product.segments.includes(desired))
      .sort(
        (a, b) =>
          b.opportunityScore - a.opportunityScore || a.name.localeCompare(b.name),
      )
      .slice(0, input.limit ?? 20);
    const evidence = gradeEvidence({
      sampleSize: selected.filter((row) => row.views > 0).length,
      coverageComplete:
        !built.behaviorPage.truncated &&
        !built.ordersPage.truncated &&
        !catalog.truncated,
      freshnessDays: freshnessDays(period, context.now),
      consistentSignals: 2,
      trackingQuality: built.behaviorPage.truncated ? "partial" : "complete",
    });
    return {
      period: describePeriodForModel(period),
      category: input.category ?? null,
      filter: desired,
      evidence,
      thresholds: {
        ...segmented.thresholds,
        methodology:
          "Interes y conversion usan medianas de la distribucion; stock alto usa percentil 75; tendencia usa la distribucion con piso material de +/-15%.",
      },
      opportunityScore:
        "0-100 orientativo: interes 35%, brecha de conversion 30%, inventario disponible 15%, tendencia 10% e ingreso relativo 10%.",
      segmentDefinitions: {
        STARS: "alto interes y alta conversion",
        OPPORTUNITIES: "alto interes y baja conversion",
        EFFICIENT: "bajo interes y alta conversion",
        STAGNANT: "bajo interes y baja conversion",
        STOCK_RISK: "stock en/bajo minimo o <=14 dias de cobertura",
        OVERSTOCK: "bajo interes y stock >= percentil 75",
        GROWING: "crecimiento de interes material",
        DECLINING: "caida de interes material",
      },
      products,
      dataQuality: {
        behaviorTruncated: built.behaviorPage.truncated,
        orders: buildDataQuality(built.ordersPage, period),
        productsAnalyzed: selected.length,
        unknownProductIds: built.unknownProductIds,
        catalogTruncated: catalog.truncated,
      },
      source: source("Catalogo, ventas y comportamiento agregado", period, context),
    };
  },
};

const customerSegmentsSchema = z.object({ ...periodShape }).strict();

const getCustomerSegments: AnalyticsTool = {
  name: "get_customer_segments",
  description:
    "Calcula RFM agregado (recencia, frecuencia, valor) y segmentos sin devolver clientes, ids, nombres, emails, telefonos ni direcciones. Se rehusa si la cobertura es insuficiente.",
  schema: customerSegmentsSchema,
  execute: async (rawInput, context) => {
    const input = customerSegmentsSchema.parse(rawInput);
    const period = resolveFromInput(input, context);
    const page = await loadOrders(context, period);
    const identifiable = new Set(
      page.orders
        .filter(isPaidOrder)
        .map((order) => order.customerKey)
        .filter((key): key is string => Boolean(key)),
    ).size;
    const available = !page.truncated && period.days >= 30 && identifiable >= 20;
    return {
      available,
      period: describePeriodForModel(period),
      method:
        "RFM agregado con umbrales dinamicos (mediana y percentil 75) dentro de la ventana consultada.",
      segments: available
        ? buildCustomerSegments(page.orders, period.endExclusive)
        : [],
      customersAnalyzed: identifiable,
      privacy:
        "Salida exclusivamente agregada; las referencias de cliente se usan solo en memoria para contar y no se devuelven.",
      limitations: [
        "La primera compra y el valor acumulado se limitan a la ventana consultada.",
        ...(!available
          ? ["Se requieren al menos 20 compradores, 30 dias y cobertura no truncada."]
          : []),
      ],
      dataQuality: buildDataQuality(page, period),
      source: source("Pedidos pagados agregados", period, context),
    };
  },
};

const cohortsSchema = z.object({ ...periodShape }).strict();

const analyzeCustomerCohorts: AnalyticsTool = {
  name: "analyze_customer_cohorts",
  description:
    "Agrupa clientes por mes de primera compra observada y calcula recompra a 30/60/90 dias con denominadores maduros. Solo devuelve cohortes agregadas y se rehusa con cobertura insuficiente.",
  schema: cohortsSchema,
  execute: async (rawInput, context) => {
    const input = cohortsSchema.parse(rawInput);
    const period = resolveFromInput(input, context);
    const page = await loadOrders(context, period);
    const customers = new Set(
      page.orders
        .filter(isPaidOrder)
        .map((order) => order.customerKey)
        .filter((key): key is string => Boolean(key)),
    ).size;
    const available = !page.truncated && period.days >= 90 && customers >= 20;
    return {
      available,
      period: describePeriodForModel(period),
      cohorts: available
        ? buildCustomerCohorts(page.orders, period.endExclusive)
        : [],
      method:
        "Cohorte = mes de primera compra observada. La tasa de cada horizonte solo usa clientes cuya cohorte ya maduro ese numero de dias.",
      limitations: [
        "Primera compra significa primera compra dentro de la ventana, no necesariamente la primera historica.",
        ...(!available
          ? ["Se requieren al menos 20 compradores, 90 dias y cobertura no truncada."]
          : []),
      ],
      dataQuality: buildDataQuality(page, period),
      source: source("Pedidos pagados agregados", period, context),
    };
  },
};

const affinitySchema = z
  .object({
    ...periodShape,
    productId: z.string().trim().min(1).max(160).optional(),
    minimumPairOrders: z.number().int().min(2).max(100).optional(),
    limit: z.number().int().min(1).max(30).optional(),
  })
  .strict();

const analyzeProductAffinity: AnalyticsTool = {
  name: "analyze_product_affinity",
  description:
    "Calcula productos comprados juntos en pedidos pagados con support, confidence y lift. Marca evidencia debil y no crea bundles ni promociones.",
  schema: affinitySchema,
  execute: async (rawInput, context) => {
    const input = affinitySchema.parse(rawInput);
    const period = resolveFromInput(input, context);
    const page = await loadOrders(context, period);
    const analysis = analyzeAffinity(page.orders, input.minimumPairOrders ?? 2);
    const filtered = input.productId
      ? analysis.pairs.filter(
          (pair) => pair.productA === input.productId || pair.productB === input.productId,
        )
      : analysis.pairs;
    const ids = Array.from(
      new Set(filtered.flatMap((pair) => [pair.productA, pair.productB])),
    );
    const products = await analyticsRepository.getProductsByIds(ids);
    const available = !page.truncated && analysis.eligibleOrders >= 20;
    return {
      available,
      period: describePeriodForModel(period),
      eligibleOrders: analysis.eligibleOrders,
      metrics: {
        support: "pedidos con ambos / pedidos elegibles",
        confidence: "pedidos con ambos / pedidos con el producto origen",
        lift: "support / (support A * support B); >1 indica asociacion positiva, no causalidad",
      },
      pairs: available
        ? filtered.slice(0, input.limit ?? 15).map((pair) => ({
            productA: products.get(pair.productA)?.name ?? "Producto sin catalogo",
            productB: products.get(pair.productB)?.name ?? "Producto sin catalogo",
            pairOrders: pair.pairOrders,
            support: pair.support,
            confidenceAToB: pair.confidenceAToB,
            confidenceBToA: pair.confidenceBToA,
            lift: pair.lift,
            evidence: pair.evidence,
            weakEvidence: pair.evidence === "limited",
          }))
        : [],
      limitations: [
        "La asociacion historica no garantiza que un bundle aumente ventas.",
        ...(!available
          ? ["Se requieren al menos 20 pedidos elegibles y cobertura no truncada."]
          : []),
      ],
      dataQuality: buildDataQuality(page, period),
      source: source("Canastas de pedidos pagados", period, context),
    };
  },
};

const businessBriefSchema = z
  .object({
    ...periodShape,
    limit: z.number().int().min(3).max(7).optional(),
  })
  .strict();

const getBusinessBrief: AnalyticsTool = {
  name: "get_business_brief",
  description:
    "Genera un brief proactivo y acotado con 3-7 hallazgos priorizados de ventas, pedidos, trafico y conversion. Consulta solo las fuentes necesarias y devuelve siguientes analisis sugeridos.",
  schema: businessBriefSchema,
  execute: async (rawInput, context) => {
    const input = businessBriefSchema.parse(rawInput);
    const period = resolveFromInput(input, context);
    const result = await buildBusinessFindings({
      period,
      context,
      areas: ["sales", "orders", "traffic", "conversion", "inventory", "products"],
    });
    const findings = result.findings.slice(0, input.limit ?? 5);
    return {
      period: describePeriodForModel(period),
      findings,
      selection:
        "Se ordenan por score verificable y se limita la salida a cambios materiales para evitar ruido.",
      nextBestQuestions: findings.flatMap((finding) => {
        if (finding.area === "conversion") return ["¿En que etapa del funnel se pierde mas gente?"];
        if (finding.area === "sales") return ["¿Que productos explican la variacion de ventas?"];
        if (finding.area === "traffic") return ["¿Que canales explican el cambio de trafico?"];
        if (finding.area === "inventory") return ["¿Que productos corren riesgo de agotarse?"];
        if (finding.area === "products") return ["¿Cuales tienen alto interes pero baja conversion?"];
        return [];
      }).slice(0, 5),
      dataQuality: result.dataQuality,
      source: source("Ventas confirmadas y telemetria agregada", period, context),
    };
  },
};

export const DECISION_INTELLIGENCE_TOOLS: AnalyticsTool[] = [
  prioritizeBusinessFindings,
  decomposeMetricChange,
  simulateBusinessScenario,
  segmentProductsTool,
  getCustomerSegments,
  analyzeCustomerCohorts,
  analyzeProductAffinity,
  getBusinessBrief,
];

export const __decisionToolsTestables = { buildBusinessFindings };
