/**
 * Contrato de respuesta del Asistente Administrativo.
 *
 * Cada tipo de bloque es una variante con campos obligatorios: asi el modelo
 * no puede devolver un "chart" sin datos ni repartir campos entre bloques.
 */

import {
  ADMIN_REPORT_BLOCK_TYPES,
  adminReportSchema,
  buildAdminReportJsonSchema,
  sanitizeAdminReport,
} from "../src/services/ai/analytics/admin-report.schema";

const baseReport = {
  summary: "Resumen de prueba",
  confidence: "media" as const,
};

describe("adminReportSchema", () => {
  it("acepta los bloques originales de la primera fase", () => {
    const parsed = adminReportSchema.parse({
      ...baseReport,
      blocks: [
        {
          type: "text",
          kind: "conclusion",
          content: "Las ventas crecieron respecto al periodo previo.",
        },
        { type: "warning", content: "El periodo actual esta incompleto." },
        {
          type: "kpis",
          items: [{ label: "Ingresos", value: 1200, format: "currency" }],
        },
        {
          type: "table",
          columns: [{ label: "Producto" }, { label: "Ingresos", format: "currency" }],
          rows: [{ cells: ["Jersey local", "1200"] }],
        },
        {
          type: "chart",
          chartType: "bar",
          data: [{ x: "Jerseys", series: [{ key: "ingresos", value: 1200 }] }],
        },
        {
          type: "recommendations",
          recommendations: [
            { action: "Revisar stock", reason: "Quedan 2 piezas", priority: "alta" },
          ],
        },
      ],
    });

    expect(parsed.blocks.map((block) => block.type)).toEqual([
      "text",
      "warning",
      "kpis",
      "table",
      "chart",
      "recommendations",
    ]);
  });

  it("acepta pronosticos, anomalias y preguntas sugeridas", () => {
    const parsed = adminReportSchema.parse({
      ...baseReport,
      blocks: [
        {
          type: "forecast",
          metric: "revenue",
          horizon: 7,
          method: "seasonal_naive",
          quality: "media",
          historical: [{ date: "2026-08-18", value: 1000 }],
          forecast: [{ date: "2026-08-19", value: 1100, lower: 900, upper: 1300 }],
          error: { mae: 120, rmse: 150, mape: 11 },
        },
        {
          type: "anomaly",
          severity: "alta",
          metric: "orders",
          reference: "2026-08-19",
          observed: 2,
          expected: "entre 10 y 18",
          explanation: "Caida muy por debajo del rango habitual.",
        },
      ],
      suggestedQuestions: [
        "Comparar con el mes anterior",
        "  comparar con el mes anterior  ",
        "Analizar el funnel",
      ],
    });

    const sanitized = sanitizeAdminReport(parsed);

    expect(sanitized.blocks.map((block) => block.type)).toEqual([
      "forecast",
      "anomaly",
    ]);
    expect(sanitized.suggestedQuestions).toEqual([
      "Comparar con el mes anterior",
      "Analizar el funnel",
    ]);
  });

  it("rechaza bloques incompletos en vez de aceptarlos vacios", () => {
    const invalidBlocks = [
      { type: "chart", chartType: "bar" },
      { type: "kpis", items: [] },
      { type: "table", columns: [{ label: "Producto" }] },
      { type: "text", content: "Sin kind" },
      { type: "recommendations", recommendations: [] },
    ];

    for (const block of invalidBlocks) {
      expect(
        adminReportSchema.safeParse({ ...baseReport, blocks: [block] }).success,
      ).toBe(false);
    }
  });

  it("exige al menos un bloque", () => {
    expect(
      adminReportSchema.safeParse({ ...baseReport, blocks: [] }).success,
    ).toBe(false);
  });
});

describe("sanitizeAdminReport", () => {
  it("descarta texto vacio y tablas con celdas desalineadas", () => {
    const sanitized = sanitizeAdminReport({
      ...baseReport,
      blocks: [
        { type: "text", kind: "contexto", content: "   " },
        {
          type: "table",
          columns: [{ label: "Producto" }, { label: "Ingresos" }],
          rows: [{ cells: ["Jersey local"] }],
        },
        {
          type: "kpis",
          items: [{ label: "Pedidos", value: 4, format: "number" }],
        },
      ],
    });

    expect(sanitized.blocks).toHaveLength(1);
    expect(sanitized.blocks[0].type).toBe("kpis");
  });

  it("descarta pronosticos sin serie proyectada y scatter sin relacion", () => {
    const sanitized = sanitizeAdminReport({
      ...baseReport,
      blocks: [
        { type: "forecast", metric: "revenue", horizon: 7 },
        {
          type: "chart",
          chartType: "scatter",
          data: [{ x: "12", label: "Jersey", series: [{ key: "ventas", value: 3 }] }],
        },
        {
          type: "kpis",
          items: [{ label: "Visitas", value: 120, format: "number" }],
        },
      ],
    });

    expect(sanitized.blocks.map((block) => block.type)).toEqual(["kpis"]);
  });

  it("devuelve un bloque explicativo cuando no queda contenido presentable", () => {
    const sanitized = sanitizeAdminReport({
      ...baseReport,
      blocks: [{ type: "warning", content: "" }],
    });

    expect(sanitized.blocks).toHaveLength(1);
    expect(sanitized.blocks[0].type).toBe("text");
  });
});

describe("buildAdminReportJsonSchema", () => {
  it("no expone referencias que el API de Gemini rechaza", () => {
    const schema = buildAdminReportJsonSchema();

    expect(schema.$schema).toBeUndefined();
    expect(schema.definitions).toBeUndefined();
    expect(schema.$defs).toBeUndefined();
    expect(JSON.stringify(schema)).not.toContain("$ref");
  });

  it("declara los bloques como variantes independientes", () => {
    const schema = buildAdminReportJsonSchema() as {
      properties: { blocks: { items: { anyOf?: unknown[] } } };
    };

    expect(schema.properties.blocks.items.anyOf).toHaveLength(
      ADMIN_REPORT_BLOCK_TYPES.length,
    );
  });
});
