/**
 * Pronostico de series diarias para el Asistente Administrativo.
 *
 * El modelo de lenguaje NUNCA inventa el futuro: recibe el resultado de este
 * servicio y solo lo interpreta. Aqui se implementan metodos estadisticos
 * simples, deterministas y verificables por backtesting; no hay dependencias
 * externas ni infraestructura de machine learning.
 *
 * Flujo: serie diaria real -> backtesting de varios metodos -> se elige el de
 * menor error historico -> se proyecta con banda de incertidumbre derivada del
 * error observado en ese mismo backtesting.
 */

export const FORECAST_METHODS = [
  "naive",
  "seasonal_naive",
  "moving_average_7",
  "weighted_moving_average_7",
  "exponential_smoothing",
  "damped_trend",
] as const;

export type ForecastMethodKey = (typeof FORECAST_METHODS)[number];

/** Observaciones minimas para permitir cualquier pronostico. */
export const MIN_FORECAST_OBSERVATIONS = 14;
/** Observaciones minimas para considerar estacionalidad semanal. */
export const MIN_SEASONAL_OBSERVATIONS = 21;
/** Horizonte maximo permitido en esta fase. */
export const MAX_FORECAST_HORIZON = 30;
/** Observaciones minimas de entrenamiento en cada origen de backtesting. */
const MIN_TRAIN_OBSERVATIONS = 10;
/** Origenes de backtesting evaluados (los mas recientes). */
const MAX_BACKTEST_ORIGINS = 20;
/** Multiplicador de la banda: ~80% si el error fuera normal. */
const INTERVAL_Z = 1.28;
const SEASON_LENGTH = 7;

export interface SeriesPoint {
  date: string;
  value: number;
}

export interface ForecastPoint {
  date: string;
  value: number;
  lower: number;
  upper: number;
}

export interface ForecastErrorMetrics {
  mae: number;
  rmse: number;
  /** null cuando la serie tiene ceros y el MAPE no es interpretable. */
  mape: number | null;
  samples: number;
}

export interface ForecastCandidate extends ForecastErrorMetrics {
  method: ForecastMethodKey;
  label: string;
}

export interface ForecastSuccess {
  available: true;
  method: ForecastMethodKey;
  methodLabel: string;
  granularity: "day";
  horizon: number;
  requestedHorizon: number;
  historical: SeriesPoint[];
  forecast: ForecastPoint[];
  error: ForecastErrorMetrics;
  quality: "alta" | "media" | "baja";
  observations: number;
  historyFrom: string;
  historyTo: string;
  nonZeroObservations: number;
  backtestOrigins: number;
  candidates: ForecastCandidate[];
  intervalBasis: string;
  notes: string[];
}

export interface ForecastUnavailable {
  available: false;
  reason: string;
  missing: string[];
  observations: number;
  minimumObservations: number;
}

export type ForecastOutcome = ForecastSuccess | ForecastUnavailable;

const METHOD_LABELS: Record<ForecastMethodKey, string> = {
  naive: "ultimo valor observado (naive)",
  seasonal_naive: "mismo dia de la semana anterior (seasonal naive)",
  moving_average_7: "promedio movil de 7 dias",
  weighted_moving_average_7: "promedio movil ponderado de 7 dias",
  exponential_smoothing: "suavizado exponencial simple",
  damped_trend: "tendencia amortiguada (Holt amortiguado)",
};

const round2 = (value: number): number => Math.round(value * 100) / 100;

const mean = (values: number[]): number =>
  values.length > 0 ? values.reduce((acc, value) => acc + value, 0) / values.length : 0;

type Predictor = (step: number) => number;

const naiveFit = (history: number[]): Predictor => {
  const last = history[history.length - 1] ?? 0;
  return () => last;
};

const seasonalNaiveFit = (history: number[]): Predictor | null => {
  if (history.length < SEASON_LENGTH) {
    return null;
  }

  const season = history.slice(history.length - SEASON_LENGTH);
  return (step) => season[(step - 1) % SEASON_LENGTH];
};

const movingAverageFit = (history: number[], window: number): Predictor | null => {
  if (history.length < window) {
    return null;
  }

  const average = mean(history.slice(history.length - window));
  return () => average;
};

const weightedMovingAverageFit = (
  history: number[],
  window: number,
): Predictor | null => {
  if (history.length < window) {
    return null;
  }

  const slice = history.slice(history.length - window);
  let weightedSum = 0;
  let weightTotal = 0;

  slice.forEach((value, index) => {
    const weight = index + 1;
    weightedSum += value * weight;
    weightTotal += weight;
  });

  const forecast = weightTotal > 0 ? weightedSum / weightTotal : 0;
  return () => forecast;
};

const ALPHA_GRID = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];
const BETA_GRID = [0.05, 0.1, 0.2, 0.3];
const DAMPING = 0.9;

const sesLevel = (history: number[], alpha: number): number => {
  let level = history[0];
  for (let index = 1; index < history.length; index += 1) {
    level = alpha * history[index] + (1 - alpha) * level;
  }
  return level;
};

const sesInSampleSse = (history: number[], alpha: number): number => {
  let level = history[0];
  let sse = 0;

  for (let index = 1; index < history.length; index += 1) {
    const error = history[index] - level;
    sse += error * error;
    level = alpha * history[index] + (1 - alpha) * level;
  }

  return sse;
};

const exponentialSmoothingFit = (history: number[]): Predictor | null => {
  if (history.length < 3) {
    return null;
  }

  let bestAlpha = ALPHA_GRID[0];
  let bestSse = Number.POSITIVE_INFINITY;

  for (const alpha of ALPHA_GRID) {
    const sse = sesInSampleSse(history, alpha);
    if (sse < bestSse) {
      bestSse = sse;
      bestAlpha = alpha;
    }
  }

  const level = sesLevel(history, bestAlpha);
  return () => level;
};

const holtState = (
  history: number[],
  alpha: number,
  beta: number,
): { level: number; trend: number; sse: number } => {
  let level = history[0];
  let trend = history[1] - history[0];
  let sse = 0;

  for (let index = 1; index < history.length; index += 1) {
    const forecast = level + DAMPING * trend;
    const error = history[index] - forecast;
    sse += error * error;

    const previousLevel = level;
    level = alpha * history[index] + (1 - alpha) * (previousLevel + DAMPING * trend);
    trend = beta * (level - previousLevel) + (1 - beta) * DAMPING * trend;
  }

  return { level, trend, sse };
};

const dampedTrendFit = (history: number[]): Predictor | null => {
  if (history.length < 5) {
    return null;
  }

  let best = { level: history[history.length - 1], trend: 0, sse: Number.POSITIVE_INFINITY };

  for (const alpha of ALPHA_GRID) {
    for (const beta of BETA_GRID) {
      const state = holtState(history, alpha, beta);
      if (state.sse < best.sse) {
        best = state;
      }
    }
  }

  return (step) => {
    let dampingSum = 0;
    for (let index = 1; index <= step; index += 1) {
      dampingSum += Math.pow(DAMPING, index);
    }
    return best.level + best.trend * dampingSum;
  };
};

const FITTERS: Record<ForecastMethodKey, (history: number[]) => Predictor | null> = {
  naive: (history) => naiveFit(history),
  seasonal_naive: (history) => seasonalNaiveFit(history),
  moving_average_7: (history) => movingAverageFit(history, SEASON_LENGTH),
  weighted_moving_average_7: (history) =>
    weightedMovingAverageFit(history, SEASON_LENGTH),
  exponential_smoothing: (history) => exponentialSmoothingFit(history),
  damped_trend: (history) => dampedTrendFit(history),
};

interface BacktestOutcome {
  metrics: ForecastErrorMetrics;
  /** Errores absolutos agrupados por horizonte (1-based). */
  errorsByStep: Map<number, number[]>;
  origins: number;
}

/**
 * Backtesting de origen rodante: en cada corte se entrena solo con el pasado y
 * se mide el error a 1..horizon pasos. Es determinista para una misma serie.
 */
const backtest = (
  values: number[],
  method: ForecastMethodKey,
  horizon: number,
): BacktestOutcome | null => {
  const errorsByStep = new Map<number, number[]>();
  const absoluteErrors: number[] = [];
  const squaredErrors: number[] = [];
  const percentErrors: number[] = [];

  const firstOrigin = Math.max(MIN_TRAIN_OBSERVATIONS, values.length - MAX_BACKTEST_ORIGINS);
  let origins = 0;

  for (let origin = firstOrigin; origin < values.length; origin += 1) {
    const train = values.slice(0, origin);
    const predictor = FITTERS[method](train);

    if (!predictor) {
      continue;
    }

    origins += 1;
    const maxStep = Math.min(horizon, values.length - origin);

    for (let step = 1; step <= maxStep; step += 1) {
      const actual = values[origin + step - 1];
      const predicted = predictor(step);
      const error = Math.abs(actual - predicted);

      absoluteErrors.push(error);
      squaredErrors.push(error * error);

      if (actual !== 0) {
        percentErrors.push((error / Math.abs(actual)) * 100);
      }

      const bucket = errorsByStep.get(step) || [];
      bucket.push(error);
      errorsByStep.set(step, bucket);
    }
  }

  if (absoluteErrors.length === 0) {
    return null;
  }

  return {
    metrics: {
      mae: round2(mean(absoluteErrors)),
      rmse: round2(Math.sqrt(mean(squaredErrors))),
      mape: percentErrors.length > 0 ? round2(mean(percentErrors)) : null,
      samples: absoluteErrors.length,
    },
    errorsByStep,
    origins,
  };
};

const resolveQuality = (input: {
  observations: number;
  origins: number;
  mape: number | null;
  nonZeroObservations: number;
}): "alta" | "media" | "baja" => {
  if (
    input.observations < MIN_SEASONAL_OBSERVATIONS ||
    input.origins < 5 ||
    input.nonZeroObservations < 7 ||
    input.mape === null ||
    input.mape > 40
  ) {
    return "baja";
  }

  if (input.observations >= 56 && input.origins >= 10 && input.mape <= 15) {
    return "alta";
  }

  return "media";
};

const addDays = (dayKey: string, days: number): string => {
  const [year, month, day] = dayKey.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day) + days * 24 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
};

/**
 * Produce el pronostico de una serie diaria contigua (sin huecos: los dias sin
 * actividad deben venir en cero).
 */
export const forecastSeries = (input: {
  series: SeriesPoint[];
  horizon: number;
  /** true cuando la metrica no puede ser negativa (dinero, pedidos, visitas). */
  nonNegative?: boolean;
}): ForecastOutcome => {
  const series = input.series.filter(
    (point) => typeof point.value === "number" && Number.isFinite(point.value),
  );
  const observations = series.length;
  const notes: string[] = [];

  if (observations < MIN_FORECAST_OBSERVATIONS) {
    return {
      available: false,
      reason:
        "No existen suficientes datos historicos para producir una prediccion confiable.",
      missing: [
        `Se requieren al menos ${MIN_FORECAST_OBSERVATIONS} dias con datos y solo hay ${observations}.`,
      ],
      observations,
      minimumObservations: MIN_FORECAST_OBSERVATIONS,
    };
  }

  const requestedHorizon = Math.max(1, Math.round(input.horizon));
  const horizonCap = Math.min(
    MAX_FORECAST_HORIZON,
    Math.max(1, Math.floor(observations / 2)),
  );
  const horizon = Math.min(requestedHorizon, horizonCap);

  if (horizon < requestedHorizon) {
    notes.push(
      `El horizonte se redujo de ${requestedHorizon} a ${horizon} dias porque solo hay ${observations} dias de historial.`,
    );
  }

  const values = series.map((point) => point.value);
  const nonZeroObservations = values.filter((value) => value !== 0).length;

  const candidates: ForecastCandidate[] = [];
  const outcomes = new Map<ForecastMethodKey, BacktestOutcome>();

  for (const method of FORECAST_METHODS) {
    if (method === "seasonal_naive" && observations < MIN_SEASONAL_OBSERVATIONS) {
      continue;
    }

    const outcome = backtest(values, method, horizon);
    if (!outcome) {
      continue;
    }

    outcomes.set(method, outcome);
    candidates.push({
      method,
      label: METHOD_LABELS[method],
      ...outcome.metrics,
    });
  }

  if (candidates.length === 0) {
    return {
      available: false,
      reason:
        "No fue posible validar ningun metodo de pronostico con el historial disponible.",
      missing: [
        "El backtesting necesita al menos 11 dias consecutivos con datos antes del corte.",
      ],
      observations,
      minimumObservations: MIN_FORECAST_OBSERVATIONS,
    };
  }

  candidates.sort((a, b) => (a.mae !== b.mae ? a.mae - b.mae : a.rmse - b.rmse));
  const winner = candidates[0];
  const winnerOutcome = outcomes.get(winner.method) as BacktestOutcome;

  const predictor = FITTERS[winner.method](values);
  if (!predictor) {
    return {
      available: false,
      reason:
        "El metodo seleccionado no pudo ajustarse a la serie completa.",
      missing: ["Historial insuficiente para el metodo ganador."],
      observations,
      minimumObservations: MIN_FORECAST_OBSERVATIONS,
    };
  }

  const lastDay = series[series.length - 1].date;
  const forecast: ForecastPoint[] = [];
  let bandWidth = winnerOutcome.metrics.rmse;

  for (let step = 1; step <= horizon; step += 1) {
    const stepErrors = winnerOutcome.errorsByStep.get(step) || [];
    if (stepErrors.length >= 3) {
      const stepRmse = Math.sqrt(mean(stepErrors.map((error) => error * error)));
      bandWidth = Math.max(bandWidth, stepRmse);
    }

    const expected = predictor(step);
    const margin = INTERVAL_Z * bandWidth;
    const lower = expected - margin;

    forecast.push({
      date: addDays(lastDay, step),
      value: round2(input.nonNegative === false ? expected : Math.max(0, expected)),
      lower: round2(input.nonNegative === false ? lower : Math.max(0, lower)),
      upper: round2(expected + margin),
    });
  }

  const quality = resolveQuality({
    observations,
    origins: winnerOutcome.origins,
    mape: winnerOutcome.metrics.mape,
    nonZeroObservations,
  });

  if (winnerOutcome.metrics.mape === null) {
    notes.push(
      "El MAPE no es interpretable porque la serie tiene dias en cero; se usa MAE y RMSE.",
    );
  }

  if (nonZeroObservations < observations / 2) {
    notes.push(
      `Mas de la mitad de los dias del historial estan en cero (${observations - nonZeroObservations} de ${observations}), por lo que la proyeccion es poco estable.`,
    );
  }

  return {
    available: true,
    method: winner.method,
    methodLabel: METHOD_LABELS[winner.method],
    granularity: "day",
    horizon,
    requestedHorizon,
    historical: series,
    forecast,
    error: winnerOutcome.metrics,
    quality,
    observations,
    historyFrom: series[0].date,
    historyTo: lastDay,
    nonZeroObservations,
    backtestOrigins: winnerOutcome.origins,
    candidates,
    intervalBasis:
      "Banda = valor esperado +/- 1.28 x error cuadratico medio observado en backtesting para ese horizonte. No es una probabilidad exacta.",
    notes,
  };
};

export const __forecastTestables = {
  backtest,
  addDays,
  resolveQuality,
  FITTERS,
  METHOD_LABELS,
};
