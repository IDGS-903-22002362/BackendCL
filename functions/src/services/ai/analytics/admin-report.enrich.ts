/**
 * Reconciliacion del informe con la evidencia real.
 *
 * Garantia clave de la fase 2: las cifras de un pronostico NUNCA salen del
 * modelo. El modelo solo declara que metrica proyecto; aqui se sustituyen la
 * serie historica, la serie proyectada, el metodo, la calidad y el error por
 * los valores exactos que devolvio `forecast_metric`.
 *
 * Si un bloque de pronostico no tiene respaldo en la evidencia se vacia su
 * serie para que `sanitizeAdminReport` lo descarte.
 */

import { AdminReport } from "./admin-report.schema";

export const FORECAST_TOOL_NAME = "forecast_metric";
/** Puntos historicos maximos enviados al frontend por bloque. */
const MAX_HISTORICAL_POINTS = 120;

export interface ReportEvidenceEntry {
  tool: string;
  ok: boolean;
  result?: unknown;
}

interface ForecastPayload {
  metric: string;
  metricLabel?: string;
  method?: string;
  quality?: string;
  horizon?: number;
  historical: Array<{ date: string; value: number }>;
  forecast: Array<{
    date: string;
    value: number;
    lower?: number;
    upper?: number;
  }>;
  error?: { mae?: number; rmse?: number; mape?: number };
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const asNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

interface MappedPoint {
  date: string;
  value: number;
  lower?: number;
  upper?: number;
}

const mapPoints = (value: unknown): MappedPoint[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const points: MappedPoint[] = [];

  for (const raw of value) {
    const point = asRecord(raw);
    const date = point && typeof point.date === "string" ? point.date : null;
    const numeric = asNumber(point?.value);

    if (!date || numeric === undefined) {
      continue;
    }

    const lower = asNumber(point?.lower);
    const upper = asNumber(point?.upper);

    points.push({
      date,
      value: numeric,
      ...(lower === undefined ? {} : { lower }),
      ...(upper === undefined ? {} : { upper }),
    });
  }

  return points;
};

const normalizeQuality = (value: unknown): "alta" | "media" | "baja" | undefined => {
  if (value === "alta" || value === "media" || value === "baja") {
    return value;
  }
  return undefined;
};

/** Extrae los pronosticos exitosos de la evidencia, indexados por metrica. */
export const collectForecastPayloads = (
  evidence: ReportEvidenceEntry[],
): Map<string, ForecastPayload> => {
  const payloads = new Map<string, ForecastPayload>();

  for (const entry of evidence) {
    if (entry.tool !== FORECAST_TOOL_NAME || !entry.ok) {
      continue;
    }

    const result = asRecord(entry.result);
    const forecast = asRecord(result?.forecast);

    if (!result || !forecast || forecast.available !== true) {
      continue;
    }

    const metric = typeof result.metric === "string" ? result.metric : null;
    const points = mapPoints(forecast.forecast);

    if (!metric || points.length === 0) {
      continue;
    }

    const errorRecord = asRecord(forecast.error);

    payloads.set(metric.toLowerCase(), {
      metric,
      metricLabel:
        typeof result.metricLabel === "string" ? result.metricLabel : undefined,
      method:
        typeof forecast.methodLabel === "string"
          ? forecast.methodLabel
          : typeof forecast.method === "string"
            ? forecast.method
            : undefined,
      quality: normalizeQuality(forecast.quality),
      horizon: asNumber(forecast.horizon),
      historical: mapPoints(forecast.historical).slice(-MAX_HISTORICAL_POINTS),
      forecast: points,
      error: errorRecord
        ? {
            mae: asNumber(errorRecord.mae),
            rmse: asNumber(errorRecord.rmse),
            mape: asNumber(errorRecord.mape),
          }
        : undefined,
    });
  }

  return payloads;
};

export const ANOMALY_TOOL_NAME = "detect_business_anomalies";

export interface ForecastTraceEntry {
  metric: string;
  method: string;
  observations: number;
  horizon: number;
  quality: string;
  mae: number | null;
}

export interface AnalysisTraceSummary {
  forecasts: ForecastTraceEntry[];
  anomaliesDetected: number;
  anomalySeverities: string[];
}

/**
 * Resumen observable del analisis: que se proyecto, con que modelo estadistico,
 * cuantos dias de historia se usaron y cuantas anomalias se detectaron.
 * Solo metadatos, sin datos de negocio ni identificadores.
 */
export const summarizeAnalysisEvidence = (
  evidence: ReportEvidenceEntry[],
): AnalysisTraceSummary => {
  const forecasts: ForecastTraceEntry[] = [];
  const anomalySeverities: string[] = [];
  let anomaliesDetected = 0;

  for (const entry of evidence) {
    if (!entry.ok) {
      continue;
    }

    const result = asRecord(entry.result);
    if (!result) {
      continue;
    }

    if (entry.tool === FORECAST_TOOL_NAME) {
      const forecast = asRecord(result.forecast);
      if (!forecast || forecast.available !== true) {
        continue;
      }

      const errorRecord = asRecord(forecast.error);

      forecasts.push({
        metric: typeof result.metric === "string" ? result.metric : "desconocida",
        method: typeof forecast.method === "string" ? forecast.method : "desconocido",
        observations: asNumber(forecast.observations) ?? 0,
        horizon: asNumber(forecast.horizon) ?? 0,
        quality: typeof forecast.quality === "string" ? forecast.quality : "desconocida",
        mae: asNumber(errorRecord?.mae) ?? null,
      });
      continue;
    }

    if (entry.tool === ANOMALY_TOOL_NAME && Array.isArray(result.anomalies)) {
      anomaliesDetected += result.anomalies.length;

      for (const raw of result.anomalies) {
        const anomaly = asRecord(raw);
        if (anomaly && typeof anomaly.severity === "string") {
          anomalySeverities.push(anomaly.severity);
        }
      }
    }
  }

  return { forecasts, anomaliesDetected, anomalySeverities };
};

const CURRENCY_METRICS = new Set(["revenue"]);

/**
 * Sustituye las cifras de cada bloque de pronostico por las calculadas en el
 * backend. Devuelve cuantos bloques se respaldaron y cuantos quedaron sin
 * evidencia (esos se descartan despues en la sanitizacion).
 */
export const reconcileForecastBlocks = (
  report: AdminReport,
  evidence: ReportEvidenceEntry[],
): { report: AdminReport; reconciled: number; unsupported: number } => {
  const payloads = collectForecastPayloads(evidence);
  const onlyPayload = payloads.size === 1 ? Array.from(payloads.values())[0] : null;

  let reconciled = 0;
  let unsupported = 0;

  const blocks = report.blocks.map((block) => {
    if (block.type !== "forecast") {
      return block;
    }

    const payload =
      payloads.get(String(block.metric || "").toLowerCase()) || onlyPayload;

    if (!payload) {
      unsupported += 1;
      return { ...block, historical: [], forecast: [] };
    }

    reconciled += 1;

    return {
      ...block,
      metric: payload.metric,
      metricLabel: payload.metricLabel ?? block.metricLabel,
      method: payload.method ?? block.method,
      quality: normalizeQuality(payload.quality) ?? block.quality,
      horizon: payload.horizon ?? payload.forecast.length,
      valueFormat: CURRENCY_METRICS.has(payload.metric.toLowerCase())
        ? ("currency" as const)
        : ("number" as const),
      historical: payload.historical,
      forecast: payload.forecast,
      error: payload.error ?? block.error,
    };
  });

  return { report: { ...report, blocks }, reconciled, unsupported };
};
