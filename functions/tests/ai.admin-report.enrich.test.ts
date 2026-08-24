/**
 * Reconciliacion del informe con la evidencia real.
 *
 * Requisito no negociable: las cifras de un pronostico salen del servicio de
 * forecasting, no del modelo. Estas pruebas verifican que cualquier numero
 * inventado por el modelo se reemplace o el bloque se descarte.
 */

import {
  collectForecastPayloads,
  reconcileForecastBlocks,
  summarizeAnalysisEvidence,
} from "../src/services/ai/analytics/admin-report.enrich";
import {
  AdminReport,
  sanitizeAdminReport,
} from "../src/services/ai/analytics/admin-report.schema";

const forecastEvidence = (overrides: Record<string, unknown> = {}) => ({
  tool: "forecast_metric",
  ok: true,
  result: {
    metric: "revenue",
    metricLabel: "Ingresos",
    forecast: {
      available: true,
      method: "seasonal_naive",
      methodLabel: "mismo dia de la semana anterior (seasonal naive)",
      quality: "media",
      horizon: 2,
      observations: 60,
      historical: [
        { date: "2026-08-17", value: 1000 },
        { date: "2026-08-18", value: 1100 },
      ],
      forecast: [
        { date: "2026-08-19", value: 1200, lower: 900, upper: 1500 },
        { date: "2026-08-20", value: 1250, lower: 950, upper: 1550 },
      ],
      error: { mae: 120.5, rmse: 160.2, mape: 11.4 },
      ...overrides,
    },
  },
});

const buildReport = (blocks: AdminReport["blocks"]): AdminReport => ({
  summary: "Proyeccion de ingresos",
  confidence: "media",
  blocks,
});

describe("collectForecastPayloads", () => {
  it("indexa por metrica solo los pronosticos disponibles", () => {
    const payloads = collectForecastPayloads([
      forecastEvidence(),
      {
        tool: "forecast_metric",
        ok: true,
        result: {
          metric: "orders",
          forecast: { available: false, reason: "historial insuficiente" },
        },
      },
      { tool: "get_sales_summary", ok: true, result: { revenue: 1 } },
    ]);

    expect(Array.from(payloads.keys())).toEqual(["revenue"]);
    expect(payloads.get("revenue")?.forecast).toHaveLength(2);
    expect(payloads.get("revenue")?.method).toContain("seasonal naive");
  });

  it("ignora resultados de tools que fallaron", () => {
    const payloads = collectForecastPayloads([
      { tool: "forecast_metric", ok: false, result: undefined },
    ]);

    expect(payloads.size).toBe(0);
  });
});

describe("reconcileForecastBlocks", () => {
  it("reemplaza las cifras que el modelo escribio por las calculadas", () => {
    const report = buildReport([
      {
        type: "forecast",
        title: "Ingresos proyectados",
        metric: "revenue",
        horizon: 30,
        method: "red neuronal",
        quality: "alta",
        historical: [{ date: "2026-01-01", value: 99999 }],
        forecast: [{ date: "2026-08-19", value: 88888 }],
        error: { mae: 0 },
      },
    ]);

    const { report: reconciled, reconciled: count } = reconcileForecastBlocks(
      report,
      [forecastEvidence()],
    );

    const block = reconciled.blocks[0];
    if (block.type !== "forecast") {
      throw new Error("Se esperaba un bloque de pronostico");
    }

    expect(count).toBe(1);
    expect(block.forecast).toEqual([
      { date: "2026-08-19", value: 1200, lower: 900, upper: 1500 },
      { date: "2026-08-20", value: 1250, lower: 950, upper: 1550 },
    ]);
    expect(block.historical).toHaveLength(2);
    expect(block.horizon).toBe(2);
    expect(block.method).toContain("seasonal naive");
    expect(block.quality).toBe("media");
    expect(block.valueFormat).toBe("currency");
    expect(block.error).toEqual({ mae: 120.5, rmse: 160.2, mape: 11.4 });
  });

  it("descarta el bloque cuando el modelo proyecto sin haber consultado la tool", () => {
    const report = buildReport([
      {
        type: "forecast",
        metric: "orders",
        forecast: [{ date: "2026-08-19", value: 42 }],
      },
      {
        type: "kpis",
        items: [{ label: "Pedidos", value: 10, format: "number" }],
      },
    ]);

    const { report: reconciled, unsupported } = reconcileForecastBlocks(report, []);
    const sanitized = sanitizeAdminReport(reconciled);

    expect(unsupported).toBe(1);
    expect(sanitized.blocks.map((block) => block.type)).toEqual(["kpis"]);
  });

  it("usa el unico pronostico disponible si el modelo nombro mal la metrica", () => {
    const report = buildReport([
      { type: "forecast", metric: "ingresos_totales", forecast: [] },
    ]);

    const { report: reconciled } = reconcileForecastBlocks(report, [
      forecastEvidence(),
    ]);

    const block = reconciled.blocks[0];
    if (block.type !== "forecast") {
      throw new Error("Se esperaba un bloque de pronostico");
    }

    expect(block.metric).toBe("revenue");
    expect(block.forecast).toHaveLength(2);
  });

  it("no toca los bloques que no son pronostico", () => {
    const report = buildReport([
      {
        type: "table",
        columns: [{ label: "Producto" }],
        rows: [{ cells: ["Jersey"] }],
      },
    ]);

    const { report: reconciled } = reconcileForecastBlocks(report, [
      forecastEvidence(),
    ]);

    expect(reconciled.blocks[0]).toEqual(report.blocks[0]);
  });
});

describe("summarizeAnalysisEvidence", () => {
  it("registra metodo, historial y horizonte de cada pronostico", () => {
    const summary = summarizeAnalysisEvidence([forecastEvidence()]);

    expect(summary.forecasts).toEqual([
      {
        metric: "revenue",
        method: "seasonal_naive",
        observations: 60,
        horizon: 2,
        quality: "media",
        mae: 120.5,
      },
    ]);
  });

  it("cuenta anomalias detectadas y sus severidades", () => {
    const summary = summarizeAnalysisEvidence([
      {
        tool: "detect_business_anomalies",
        ok: true,
        result: {
          anomalies: [{ severity: "alta" }, { severity: "media" }],
        },
      },
    ]);

    expect(summary.anomaliesDetected).toBe(2);
    expect(summary.anomalySeverities).toEqual(["alta", "media"]);
  });

  it("no registra nada cuando el pronostico no estuvo disponible", () => {
    const summary = summarizeAnalysisEvidence([
      {
        tool: "forecast_metric",
        ok: true,
        result: { metric: "visits", forecast: { available: false } },
      },
    ]);

    expect(summary.forecasts).toHaveLength(0);
    expect(summary.anomaliesDetected).toBe(0);
  });
});
