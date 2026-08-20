/**
 * Deteccion de anomalias de negocio con estadistica robusta simple.
 *
 * No hay machine learning: se compara el comportamiento reciente contra la
 * mediana y la desviacion absoluta mediana (MAD) del propio historial. Se usa
 * MAD en lugar de desviacion estandar porque un solo pico no debe inflar el
 * umbral y esconder el resto de las anomalias.
 *
 * Un cambio pequeno NUNCA se reporta como anomalia: ademas del umbral
 * estadistico se exige materialidad minima sobre el nivel habitual.
 */

import { SeriesPoint } from "./forecast.service";

/** Observaciones minimas de linea base para poder juzgar un dia. */
export const MIN_BASELINE_OBSERVATIONS = 10;
/** Constante que hace comparable la MAD con una desviacion estandar. */
const MAD_SCALE = 1.4826;
const DEFAULT_RECENT_DAYS = 7;
const Z_MEDIUM = 3;
const Z_HIGH = 4.5;
/** Cambio relativo minimo para considerar el desvio material. */
const MIN_RELATIVE_CHANGE = 0.15;

export type AnomalySeverity = "alta" | "media" | "baja";

export interface AnomalyFinding {
  metric: string;
  metricLabel: string;
  scope: "serie_diaria" | "producto" | "inventario" | "funnel";
  reference: string;
  observedValue: number;
  expectedValue: number;
  expectedRange: { lower: number; upper: number };
  deviationScore: number | null;
  direction: "pico" | "caida";
  severity: AnomalySeverity;
  evidence: string;
}

const round2 = (value: number): number => Math.round(value * 100) / 100;

const medianOf = (values: number[]): number => {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
};

const madOf = (values: number[], center: number): number =>
  medianOf(values.map((value) => Math.abs(value - center)));

const severityFromScore = (score: number): AnomalySeverity | null => {
  const absolute = Math.abs(score);
  if (absolute >= Z_HIGH) {
    return "alta";
  }
  if (absolute >= Z_MEDIUM) {
    return "media";
  }
  return null;
};

/**
 * Anomalias en una serie diaria: compara los ultimos dias contra la mediana y
 * la dispersion robusta del resto del historial.
 */
export const detectSeriesAnomalies = (input: {
  metric: string;
  metricLabel: string;
  series: SeriesPoint[];
  recentDays?: number;
  nonNegative?: boolean;
}): { findings: AnomalyFinding[]; skippedReason: string | null } => {
  const recentDays = Math.max(1, input.recentDays ?? DEFAULT_RECENT_DAYS);
  const series = input.series;

  if (series.length < MIN_BASELINE_OBSERVATIONS + 1) {
    return {
      findings: [],
      skippedReason: `La metrica ${input.metric} necesita al menos ${MIN_BASELINE_OBSERVATIONS + 1} dias de historial para juzgar desvios y solo hay ${series.length}.`,
    };
  }

  const splitIndex = Math.max(
    MIN_BASELINE_OBSERVATIONS,
    series.length - recentDays,
  );
  const baseline = series.slice(0, splitIndex).map((point) => point.value);
  const recent = series.slice(splitIndex);

  if (baseline.length < MIN_BASELINE_OBSERVATIONS || recent.length === 0) {
    return {
      findings: [],
      skippedReason: `La metrica ${input.metric} no tiene linea base suficiente para comparar los ultimos dias.`,
    };
  }

  const center = medianOf(baseline);
  const rawMad = madOf(baseline, center);
  const scale = rawMad * MAD_SCALE;
  const findings: AnomalyFinding[] = [];

  for (const point of recent) {
    const delta = point.value - center;
    const absoluteDelta = Math.abs(delta);
    const materialityFloor = Math.max(1, Math.abs(center) * MIN_RELATIVE_CHANGE);

    if (absoluteDelta < materialityFloor) {
      continue;
    }

    let score: number | null = null;
    let severity: AnomalySeverity | null = null;

    if (scale > 0) {
      score = round2(delta / scale);
      severity = severityFromScore(score);
    } else if (center > 0 && absoluteDelta >= center * 0.5) {
      // Serie plana que cambia de nivel: sin dispersion no hay z-score, pero
      // un salto de la mitad del nivel habitual si es reportable.
      severity = absoluteDelta >= center ? "alta" : "media";
    }

    if (!severity) {
      continue;
    }

    const lowerBound = center - Z_MEDIUM * scale;
    const expectedRange = {
      lower: round2(
        input.nonNegative === false ? lowerBound : Math.max(0, lowerBound),
      ),
      upper: round2(center + Z_MEDIUM * scale),
    };

    findings.push({
      metric: input.metric,
      metricLabel: input.metricLabel,
      scope: "serie_diaria",
      reference: point.date,
      observedValue: round2(point.value),
      expectedValue: round2(center),
      expectedRange,
      deviationScore: score,
      direction: delta > 0 ? "pico" : "caida",
      severity,
      evidence: `El ${point.date} se registro ${round2(point.value)} frente a un nivel habitual de ${round2(center)} (rango esperado ${expectedRange.lower} a ${expectedRange.upper}) calculado con ${baseline.length} dias previos.`,
    });
  }

  return { findings, skippedReason: null };
};

export interface ProductAnomalyInput {
  productId: string;
  name: string;
  views: number;
  addToCart: number;
  unitsSold: number;
  availableStock: number;
  daysOfSupply: number | null;
}

/**
 * Reglas de negocio sobre productos. Los umbrales salen de la distribucion
 * observada (percentil de vistas), no de constantes arbitrarias.
 */
export const detectProductAnomalies = (input: {
  products: ProductAnomalyInput[];
  /** Percentil de vistas usado como "mucho interes". */
  highInterestViewsThreshold: number;
  limit?: number;
}): AnomalyFinding[] => {
  const limit = input.limit ?? 5;
  const findings: AnomalyFinding[] = [];

  const highInterestNoSales = input.products
    .filter(
      (product) =>
        product.views >= input.highInterestViewsThreshold &&
        product.views > 0 &&
        product.unitsSold === 0,
    )
    .sort((a, b) => b.views - a.views)
    .slice(0, limit);

  for (const product of highInterestNoSales) {
    findings.push({
      metric: "producto_vistas_sin_venta",
      metricLabel: "Producto con vistas y sin ventas",
      scope: "producto",
      reference: product.name,
      observedValue: product.views,
      expectedValue: input.highInterestViewsThreshold,
      expectedRange: { lower: 0, upper: input.highInterestViewsThreshold },
      deviationScore: null,
      direction: "pico",
      severity: product.availableStock > 0 ? "media" : "baja",
      evidence:
        product.availableStock > 0
          ? `${product.name} acumulo ${product.views} vistas y ${product.addToCart} agregados al carrito sin unidades vendidas, con ${product.availableStock} piezas disponibles.`
          : `${product.name} acumulo ${product.views} vistas sin ventas, pero no tiene stock disponible.`,
    });
  }

  const runningOut = input.products
    .filter(
      (product) =>
        product.daysOfSupply !== null &&
        product.daysOfSupply <= 7 &&
        product.availableStock > 0 &&
        product.unitsSold > 0,
    )
    .sort((a, b) => (a.daysOfSupply ?? 0) - (b.daysOfSupply ?? 0))
    .slice(0, limit);

  for (const product of runningOut) {
    findings.push({
      metric: "inventario_dias_cobertura",
      metricLabel: "Cobertura de inventario en dias",
      scope: "inventario",
      reference: product.name,
      observedValue: product.daysOfSupply ?? 0,
      expectedValue: 30,
      expectedRange: { lower: 14, upper: 90 },
      deviationScore: null,
      direction: "caida",
      severity: (product.daysOfSupply ?? 0) <= 3 ? "alta" : "media",
      evidence: `${product.name} tiene ${product.availableStock} piezas y al ritmo de venta reciente se agota en aproximadamente ${product.daysOfSupply} dias.`,
    });
  }

  return findings;
};

export const rankAnomalies = (findings: AnomalyFinding[]): AnomalyFinding[] => {
  const weight: Record<AnomalySeverity, number> = { alta: 3, media: 2, baja: 1 };

  return [...findings].sort((a, b) => {
    if (weight[a.severity] !== weight[b.severity]) {
      return weight[b.severity] - weight[a.severity];
    }

    return Math.abs(b.deviationScore ?? 0) - Math.abs(a.deviationScore ?? 0);
  });
};

export const __anomalyTestables = {
  medianOf,
  madOf,
  severityFromScore,
};
