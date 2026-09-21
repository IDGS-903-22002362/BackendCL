/**
 * Primitivas puras de decision intelligence.
 *
 * Ninguna funcion accede a Firestore ni acepta expresiones. Las tools cargan
 * datos reales y pasan aqui solamente numeros/filas ya normalizados. Esto hace
 * que prioridades, escenarios, segmentos, cohortes y afinidad sean
 * deterministas y faciles de auditar.
 */

import { AnalyticsOrder } from "./analytics.repository";
import { isPaidOrder } from "./analytics.metrics";

export type EvidenceLevel = "high" | "medium" | "limited";
export type BusinessPriority =
  | "critical"
  | "high"
  | "medium"
  | "low"
  | "opportunity";

const round = (value: number, digits = 2): number => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

const clamp = (value: number, minimum = 0, maximum = 1): number =>
  Math.min(maximum, Math.max(minimum, value));

export interface EvidenceInput {
  sampleSize: number;
  coverageComplete: boolean;
  freshnessDays: number;
  consistentSignals?: number;
  trackingQuality?: "complete" | "partial" | "unknown";
}

/** Evidencia alta requiere cobertura completa, actualidad y muestra material. */
export const gradeEvidence = (input: EvidenceInput): EvidenceLevel => {
  const signals = input.consistentSignals ?? 1;
  const tracking = input.trackingQuality ?? "complete";
  if (
    input.coverageComplete &&
    input.sampleSize >= 100 &&
    input.freshnessDays <= 14 &&
    signals >= 2 &&
    tracking === "complete"
  ) {
    return "high";
  }

  if (
    input.coverageComplete &&
    input.sampleSize >= 30 &&
    input.freshnessDays <= 45 &&
    tracking !== "unknown"
  ) {
    return "medium";
  }

  return "limited";
};

export interface PriorityInput {
  impact: number;
  magnitude: number;
  urgency: number;
  evidence: EvidenceLevel;
  trend: number;
  actionability: number;
  opportunity?: boolean;
}

/**
 * Score 0-100: impacto 30%, magnitud 20%, urgencia 20%, evidencia 15%,
 * tendencia 5% y capacidad de actuar 10%. Todas las entradas usan escala 0-1.
 */
export const scoreBusinessPriority = (
  input: PriorityInput,
): { score: number; priority: BusinessPriority } => {
  const evidenceWeight = { high: 1, medium: 0.65, limited: 0.3 }[input.evidence];
  const score = round(
    100 *
      (0.3 * clamp(input.impact) +
        0.2 * clamp(input.magnitude) +
        0.2 * clamp(input.urgency) +
        0.15 * evidenceWeight +
        0.05 * clamp(input.trend) +
        0.1 * clamp(input.actionability)),
  );

  if (input.opportunity && score >= 45) {
    return { score, priority: "opportunity" };
  }
  if (score >= 85 && input.evidence !== "limited") {
    return { score, priority: "critical" };
  }
  if (score >= 65) {
    return { score, priority: "high" };
  }
  if (score >= 40) {
    return { score, priority: "medium" };
  }
  return { score, priority: "low" };
};

export interface ScenarioBaseline {
  traffic: number;
  conversionRate: number;
  averageOrderValue: number;
  units?: number;
  price?: number;
  discount?: number;
}

export interface ScenarioAdjustments {
  trafficPercent?: number;
  conversionRatePercent?: number;
  averageOrderValuePercent?: number;
  unitsPercent?: number;
  pricePercent?: number;
  discountPoints?: number;
}

/**
 * Revenue comercial = trafico * conversion(decimal) * ticket promedio.
 * Revenue de unidades (cuando hay precio) = unidades * precio * (1-descuento).
 * Los cambios son multiplicativos; no se supone elasticidad ni probabilidad.
 */
export const simulateScenario = (
  baseline: ScenarioBaseline,
  adjustments: ScenarioAdjustments,
) => {
  const factor = (percent = 0) => 1 + percent / 100;
  const simulated = {
    traffic: round(baseline.traffic * factor(adjustments.trafficPercent)),
    conversionRate: round(
      baseline.conversionRate * factor(adjustments.conversionRatePercent),
      4,
    ),
    averageOrderValue: round(
      baseline.averageOrderValue * factor(adjustments.averageOrderValuePercent),
    ),
    units:
      baseline.units === undefined
        ? undefined
        : round(baseline.units * factor(adjustments.unitsPercent)),
    price:
      baseline.price === undefined
        ? undefined
        : round(baseline.price * factor(adjustments.pricePercent)),
    discount:
      baseline.discount === undefined
        ? undefined
        : clamp(
            baseline.discount + (adjustments.discountPoints ?? 0),
            0,
            100,
          ),
  };

  const baselineRevenue = round(
    baseline.traffic * (baseline.conversionRate / 100) * baseline.averageOrderValue,
  );
  const simulatedRevenue = round(
    simulated.traffic *
      (simulated.conversionRate / 100) *
      simulated.averageOrderValue,
  );

  const unitRevenue =
    simulated.units !== undefined && simulated.price !== undefined
      ? round(
          simulated.units *
            simulated.price *
            (1 - (simulated.discount ?? 0) / 100),
        )
      : undefined;

  return {
    baseline: { ...baseline, revenue: baselineRevenue },
    simulated: { ...simulated, revenue: simulatedRevenue, unitRevenue },
    change: {
      revenue: round(simulatedRevenue - baselineRevenue),
      revenuePercent:
        baselineRevenue === 0
          ? null
          : round(((simulatedRevenue - baselineRevenue) / baselineRevenue) * 100),
    },
  };
};

type NamedFactor = { key: string; previous: number; current: number };

const permutations = <T>(items: T[]): T[][] => {
  if (items.length <= 1) return [items];
  return items.flatMap((item, index) =>
    permutations(items.filter((_, candidate) => candidate !== index)).map(
      (rest) => [item, ...rest],
    ),
  );
};

/** Shapley sobre una identidad multiplicativa; los aportes suman la variacion. */
export const decomposeMultiplicativeChange = (factors: NamedFactor[]) => {
  if (factors.length < 2 || factors.length > 4) {
    throw new Error("La descomposicion requiere entre 2 y 4 factores");
  }
  const orders = permutations(factors);
  const contribution = new Map(factors.map((factor) => [factor.key, 0]));

  for (const order of orders) {
    const values = new Map(factors.map((factor) => [factor.key, factor.previous]));
    for (const factor of order) {
      const before = factors.reduce(
        (value, entry) => value * (values.get(entry.key) ?? entry.previous),
        1,
      );
      values.set(factor.key, factor.current);
      const after = factors.reduce(
        (value, entry) => value * (values.get(entry.key) ?? entry.previous),
        1,
      );
      contribution.set(
        factor.key,
        (contribution.get(factor.key) ?? 0) + (after - before) / orders.length,
      );
    }
  }

  const previous = factors.reduce((value, factor) => value * factor.previous, 1);
  const current = factors.reduce((value, factor) => value * factor.current, 1);
  return {
    previous: round(previous),
    current: round(current),
    change: round(current - previous),
    contributions: factors.map((factor) => ({
      factor: factor.key,
      previous: round(factor.previous, 4),
      current: round(factor.current, 4),
      contribution: round(contribution.get(factor.key) ?? 0),
    })),
  };
};

export interface ProductSegmentInput {
  productId: string;
  name: string;
  views: number;
  conversion: number;
  revenue: number;
  growthPercent: number | null;
  availableStock: number;
  minStock: number;
  daysOfSupply: number | null;
}

const sorted = (values: number[]): number[] => [...values].sort((a, b) => a - b);

export const percentile = (values: number[], quantile: number): number => {
  if (values.length === 0) return 0;
  const list = sorted(values);
  const position = clamp(quantile) * (list.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return list[lower];
  return list[lower] + (list[upper] - list[lower]) * (position - lower);
};

const percentileRank = (values: number[], value: number): number => {
  if (values.length <= 1) return values.length === 0 ? 0 : 1;
  const lessOrEqual = values.filter((candidate) => candidate <= value).length;
  return clamp((lessOrEqual - 1) / (values.length - 1));
};

/** Segmentacion de cuadrantes + inventario/tendencia con umbrales dinamicos. */
export const segmentProducts = (rows: ProductSegmentInput[]) => {
  const measured = rows.filter((row) => row.views > 0);
  const views = measured.map((row) => row.views);
  const conversions = measured.map((row) => row.conversion);
  const stocks = rows.map((row) => row.availableStock);
  const revenues = rows.map((row) => row.revenue);
  const positiveGrowth = rows
    .map((row) => row.growthPercent ?? 0)
    .filter((value) => value > 0);
  const negativeGrowth = rows
    .map((row) => row.growthPercent ?? 0)
    .filter((value) => value < 0);
  const thresholds = {
    views: round(percentile(views, 0.5)),
    conversion: round(percentile(conversions, 0.5)),
    highStock: round(percentile(stocks, 0.75)),
    growing: round(Math.max(15, percentile(positiveGrowth, 0.5))),
    declining: round(Math.min(-15, percentile(negativeGrowth, 0.5))),
  };

  return {
    thresholds,
    products: rows.map((row) => {
      const highInterest = row.views >= thresholds.views && row.views > 0;
      const highConversion =
        row.conversion >= thresholds.conversion && row.views > 0;
      const quadrant = highInterest
        ? highConversion
          ? "STARS"
          : "OPPORTUNITIES"
        : highConversion
          ? "EFFICIENT"
          : "STAGNANT";
      const segments = [quadrant];
      const demandObserved = row.views > 0 || row.revenue > 0;
      const stockRisk =
        demandObserved &&
        ((row.minStock > 0 && row.availableStock <= row.minStock) ||
          (row.daysOfSupply !== null && row.daysOfSupply <= 14));
      const overstock =
        !highInterest &&
        row.availableStock >=
          Math.max(1, thresholds.highStock, row.minStock * 2) &&
        row.availableStock > Math.max(row.minStock, 0);
      if (stockRisk) segments.push("STOCK_RISK");
      if (overstock) segments.push("OVERSTOCK");
      if ((row.growthPercent ?? 0) >= thresholds.growing) segments.push("GROWING");
      if ((row.growthPercent ?? 0) <= thresholds.declining) segments.push("DECLINING");

      const interest = percentileRank(views, row.views);
      const conversionGap =
        thresholds.conversion > 0
          ? clamp(1 - row.conversion / thresholds.conversion)
          : 0;
      const inventoryReadiness = stockRisk
        ? 0
        : clamp(row.availableStock / Math.max(1, thresholds.highStock));
      const growth = clamp(((row.growthPercent ?? 0) + 50) / 100);
      const revenue = percentileRank(revenues, row.revenue);
      const opportunityScore = round(
        100 *
          (0.35 * interest +
            0.3 * conversionGap +
            0.15 * inventoryReadiness +
            0.1 * growth +
            0.1 * revenue),
      );

      return { ...row, segment: segments[0], segments, opportunityScore };
    }),
  };
};

export interface AffinityPair {
  productA: string;
  productB: string;
  pairOrders: number;
  support: number;
  confidenceAToB: number;
  confidenceBToA: number;
  lift: number;
  evidence: EvidenceLevel;
}

export const analyzeAffinity = (
  orders: AnalyticsOrder[],
  minimumPairOrders = 2,
): { eligibleOrders: number; pairs: AffinityPair[] } => {
  const baskets = orders
    .filter(isPaidOrder)
    .map((order) => Array.from(new Set(order.items.map((item) => item.productoId))))
    .filter((basket) => basket.length > 0);
  const singles = new Map<string, number>();
  const pairs = new Map<string, number>();

  for (const basket of baskets) {
    const ordered = [...basket].sort();
    for (const product of ordered) {
      singles.set(product, (singles.get(product) ?? 0) + 1);
    }
    for (let left = 0; left < ordered.length; left += 1) {
      for (let right = left + 1; right < ordered.length; right += 1) {
        const key = `${ordered[left]}\u0000${ordered[right]}`;
        pairs.set(key, (pairs.get(key) ?? 0) + 1);
      }
    }
  }

  const total = baskets.length;
  const results: AffinityPair[] = [];
  for (const [key, pairOrders] of pairs) {
    if (pairOrders < minimumPairOrders || total === 0) continue;
    const [productA, productB] = key.split("\u0000");
    const countA = singles.get(productA) ?? 0;
    const countB = singles.get(productB) ?? 0;
    const support = pairOrders / total;
    const confidenceAToB = countA > 0 ? pairOrders / countA : 0;
    const confidenceBToA = countB > 0 ? pairOrders / countB : 0;
    const lift = countA > 0 && countB > 0 ? (pairOrders * total) / (countA * countB) : 0;
    const evidence: EvidenceLevel =
      total >= 200 && pairOrders >= 10
        ? "high"
        : total >= 50 && pairOrders >= 5
          ? "medium"
          : "limited";
    results.push({
      productA,
      productB,
      pairOrders,
      support: round(support, 4),
      confidenceAToB: round(confidenceAToB, 4),
      confidenceBToA: round(confidenceBToA, 4),
      lift: round(lift, 4),
      evidence,
    });
  }
  results.sort((a, b) => b.lift - a.lift || b.pairOrders - a.pairOrders);
  return { eligibleOrders: total, pairs: results };
};

const daysBetween = (later: Date, earlier: Date): number =>
  Math.max(0, Math.floor((later.getTime() - earlier.getTime()) / 86_400_000));

export interface CustomerSegmentAggregate {
  segment: string;
  customers: number;
  averageOrders: number;
  averageSpend: number;
  averageRecencyDays: number;
  percentage: number;
}

/** RFM agregado; customerKey se usa en memoria y nunca aparece en la salida. */
export const buildCustomerSegments = (
  orders: AnalyticsOrder[],
  asOf: Date,
): CustomerSegmentAggregate[] => {
  const customers = new Map<
    string,
    { first: Date; last: Date; orders: number; monetary: number }
  >();
  for (const order of orders.filter(isPaidOrder)) {
    if (!order.customerKey) continue;
    const current = customers.get(order.customerKey);
    if (!current) {
      customers.set(order.customerKey, {
        first: order.createdAt,
        last: order.createdAt,
        orders: 1,
        monetary: order.total,
      });
    } else {
      current.first = current.first < order.createdAt ? current.first : order.createdAt;
      current.last = current.last > order.createdAt ? current.last : order.createdAt;
      current.orders += 1;
      current.monetary += order.total;
    }
  }
  const rows = Array.from(customers.values()).map((customer) => ({
    ...customer,
    recency: daysBetween(asOf, customer.last),
  }));
  const frequencyMedian = percentile(rows.map((row) => row.orders), 0.5);
  const monetary75 = percentile(rows.map((row) => row.monetary), 0.75);
  const recencyMedian = percentile(rows.map((row) => row.recency), 0.5);
  const recency75 = percentile(rows.map((row) => row.recency), 0.75);
  const buckets = new Map<string, typeof rows>();

  for (const row of rows) {
    const age = daysBetween(asOf, row.first);
    const segment =
      row.recency >= Math.max(90, recency75)
        ? "inactive"
        : row.recency >= recency75 && (row.orders >= frequencyMedian || row.monetary >= monetary75)
          ? "at_risk"
          : row.monetary >= monetary75 && row.orders >= Math.max(2, frequencyMedian)
            ? "high_value"
            : row.orders >= Math.max(2, frequencyMedian) && row.recency <= recencyMedian
              ? "loyal"
              : row.orders === 1 && age <= 30
                ? "new"
                : "promising";
    const list = buckets.get(segment) ?? [];
    list.push(row);
    buckets.set(segment, list);
  }

  return Array.from(buckets.entries())
    .map(([segment, list]) => ({
      segment,
      customers: list.length,
      averageOrders: round(list.reduce((sum, row) => sum + row.orders, 0) / list.length),
      averageSpend: round(list.reduce((sum, row) => sum + row.monetary, 0) / list.length),
      averageRecencyDays: round(list.reduce((sum, row) => sum + row.recency, 0) / list.length),
      percentage: rows.length > 0 ? round((list.length / rows.length) * 100) : 0,
    }))
    .sort((a, b) => b.customers - a.customers);
};

export interface CohortRow {
  cohort: string;
  customers: number;
  eligible30: number;
  repeat30Rate: number | null;
  eligible60: number;
  repeat60Rate: number | null;
  eligible90: number;
  repeat90Rate: number | null;
}

/** Cohortes mensuales y recompra dentro de 30/60/90 dias de la primera compra. */
export const buildCustomerCohorts = (
  orders: AnalyticsOrder[],
  asOf: Date,
): CohortRow[] => {
  const byCustomer = new Map<string, Date[]>();
  for (const order of orders.filter(isPaidOrder)) {
    if (!order.customerKey) continue;
    const dates = byCustomer.get(order.customerKey) ?? [];
    dates.push(order.createdAt);
    byCustomer.set(order.customerKey, dates);
  }
  const cohorts = new Map<string, Array<{ first: Date; repeats: Date[] }>>();
  for (const dates of byCustomer.values()) {
    dates.sort((a, b) => a.getTime() - b.getTime());
    const first = dates[0];
    const key = first.toISOString().slice(0, 7);
    const rows = cohorts.get(key) ?? [];
    rows.push({ first, repeats: dates.slice(1) });
    cohorts.set(key, rows);
  }

  return Array.from(cohorts.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([cohort, customers]) => {
      const horizon = (days: number) => {
        const eligible = customers.filter(
          (customer) => daysBetween(asOf, customer.first) >= days,
        );
        if (eligible.length === 0) return { eligible: 0, rate: null };
        const repeated = eligible.filter((customer) =>
          customer.repeats.some(
            (date) => daysBetween(date, customer.first) <= days,
          ),
        ).length;
        return { eligible: eligible.length, rate: round((repeated / eligible.length) * 100) };
      };
      const at30 = horizon(30);
      const at60 = horizon(60);
      const at90 = horizon(90);
      return {
        cohort,
        customers: customers.length,
        eligible30: at30.eligible,
        repeat30Rate: at30.rate,
        eligible60: at60.eligible,
        repeat60Rate: at60.rate,
        eligible90: at90.eligible,
        repeat90Rate: at90.rate,
      };
    });
};

export const __decisionMetricTestables = { round, clamp };
