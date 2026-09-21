import {
  hasExplicitVisualizationIntent,
  reconcileEvidenceCharts,
} from "../src/services/ai/analytics/admin-report.chart-enrich";
import {
  AdminReport,
  adminReportSchema,
} from "../src/services/ai/analytics/admin-report.schema";

const report = (extraBlocks: AdminReport["blocks"] = []): AdminReport =>
  adminReportSchema.parse({
    summary: "Ranking de productos",
    confidence: "alta",
    sourceMetadata: [
      {
        id: "source-1",
        label: "Ventas por producto",
        observedAt: "2026-08-25T12:00:00.000Z",
        freshness: "fresh",
        coverage: "complete",
      },
    ],
    blocks: [
      {
        type: "kpis",
        items: [{ label: "Ingresos", value: 1500, format: "currency" }],
      },
      ...extraBlocks,
      {
        type: "table",
        columns: [
          { label: "Producto" },
          { label: "Ingresos", format: "currency" },
        ],
        rows: [
          { cells: ["Jersey local", "1000"] },
          { cells: ["Gorra", "500"] },
        ],
      },
      {
        type: "text",
        kind: "conclusion",
        content: "El Jersey local lidera las ventas.",
      },
    ],
  });

const productEvidence = (metric: "revenue" | "units" = "revenue") => [
  {
    tool: "get_sales_by_product",
    ok: true,
    result: {
      metric,
      currency: "MXN",
      products: [
        { name: "Jersey local", sku: "JL-01", revenue: 1000, units: 2 },
        { name: "Gorra", sku: "GO-01", revenue: 500, units: 5 },
      ],
    },
  },
];

const chartFrom = (value: AdminReport) => {
  const chart = value.blocks.find((block) => block.type === "chart");
  if (!chart || chart.type !== "chart") throw new Error("Expected chart");
  return chart;
};

describe("reconcileEvidenceCharts", () => {
  it("crea la grafica solicitada sin quitar KPIs, tabla ni conclusion", () => {
    const result = reconcileEvidenceCharts(
      report(),
      "Gráfica los productos por ventas",
      productEvidence(),
    ).report;
    const types = result.blocks.map((block) => block.type);
    const chart = chartFrom(result);

    expect(types).toEqual(["kpis", "chart", "table", "text"]);
    expect(chart).toMatchObject({
      chartType: "bar",
      xLabel: "Producto",
      valueFormat: "currency",
      sourceIds: ["source-1"],
      seriesLabels: [{ key: "revenue", label: "Ingresos" }],
      data: [
        { x: "Jersey local", series: [{ key: "revenue", value: 1000 }] },
        { x: "Gorra", series: [{ key: "revenue", value: 500 }] },
      ],
    });
    expect(types).toContain("table");
    expect(result.blocks.some((block) => block.type === "text")).toBe(true);
  });

  it("sobrescribe una grafica compatible con cifras inventadas", () => {
    const bogus = {
      type: "chart" as const,
      chartType: "bar" as const,
      title: "Ventas por producto",
      xLabel: "Producto",
      valueFormat: "currency" as const,
      seriesLabels: [{ key: "ventas", label: "Ventas" }],
      data: [{ x: "Inventado", series: [{ key: "ventas", value: 999999 }] }],
    };
    const outcome = reconcileEvidenceCharts(
      report([bogus]),
      "Grafica los productos por ventas",
      productEvidence(),
    );
    const chart = chartFrom(outcome.report);

    expect(outcome.reconciled).toBe(1);
    expect(outcome.added).toBe(0);
    expect(JSON.stringify(chart)).not.toContain("999999");
    expect(chart.data[0]).toEqual({
      x: "Jersey local",
      series: [{ key: "revenue", value: 1000 }],
    });
  });

  it("respeta la metrica units y usa formato numerico", () => {
    const chart = chartFrom(
      reconcileEvidenceCharts(
        report(),
        "Muéstrame en barras las unidades por producto",
        productEvidence("units"),
      ).report,
    );

    expect(chart.valueFormat).toBe("number");
    expect(chart.seriesLabels).toEqual([{ key: "units", label: "Unidades" }]);
    expect(chart.data.map((point) => point.series[0].value)).toEqual([2, 5]);
  });

  it("crea barras de vistas por producto y conserva la tabla", () => {
    const result = reconcileEvidenceCharts(
      report(),
      "Grafica las visitas de la tienda por productos en el ultimo mes",
      [
        {
          tool: "get_product_interest",
          ok: true,
          result: {
            sortBy: "views",
            products: [
              { name: "Jersey visita", sku: "CHA-428", views: 160, uniqueViewers: 107 },
              { name: "Jersey local", sku: "CHA-429", views: 84, uniqueViewers: 57 },
            ],
          },
        },
      ],
    ).report;
    const types = result.blocks.map((block) => block.type);
    const chart = chartFrom(result);

    expect(types).toEqual(["kpis", "chart", "table", "text"]);
    expect(chart).toMatchObject({
      chartType: "bar",
      xLabel: "Producto",
      valueFormat: "number",
      seriesLabels: [{ key: "views", label: "Vistas" }],
      data: [
        { x: "Jersey visita", series: [{ key: "views", value: 160 }] },
        { x: "Jersey local", series: [{ key: "views", value: 84 }] },
      ],
    });
  });

  it("usa pastel cuando el mix de canales es una composicion del total", () => {
    const chart = chartFrom(
      reconcileEvidenceCharts(
        report(),
        "Grafica el origen del trafico",
        [
          {
            tool: "get_traffic_sources",
            ok: true,
            result: {
              channels: [
                { source: "google", medium: "organic", sessions: 40 },
                { source: "directo", medium: "directo", sessions: 25 },
                { source: "instagram", medium: "social", sessions: 10 },
              ],
            },
          },
        ],
      ).report,
    );

    expect(chart).toMatchObject({
      chartType: "pie",
      seriesLabels: [{ key: "sessions", label: "Sesiones" }],
      data: [
        { x: "google / organic", series: [{ key: "sessions", value: 40 }] },
        { x: "directo", series: [{ key: "sessions", value: 25 }] },
        { x: "instagram / social", series: [{ key: "sessions", value: 10 }] },
      ],
    });
  });

  it("agrega la grafica de ranking aunque el usuario no haya dicho grafica", () => {
    const outcome = reconcileEvidenceCharts(
      report(),
      "Como van las ventas por producto",
      productEvidence(),
    );

    expect(outcome.added).toBe(1);
    expect(chartFrom(outcome.report).chartType).toBe("bar");
  });

  it("no agrega grafica cuando el usuario pidio solo la tabla", () => {
    const outcome = reconcileEvidenceCharts(
      report(),
      "Dame la tabla de productos por ventas",
      productEvidence(),
    );

    expect(outcome.added).toBe(0);
    expect(outcome.report.blocks.some((block) => block.type === "chart")).toBe(
      false,
    );
  });

  it.each([
    "Dame los productos por ventas sin gráfica",
    "No gráfica, solo la tabla",
    "No quiero una gráfica, solo la tabla",
    "No chart, solo cifras",
  ])("respeta intencion visual negada: %s", (question) => {
    expect(hasExplicitVisualizationIntent(question)).toBe(false);
    const outcome = reconcileEvidenceCharts(report(), question, productEvidence());
    expect(outcome.report.blocks.some((block) => block.type === "chart")).toBe(
      false,
    );
  });

  it("elimina una grafica del modelo cuando la solicitud la niega", () => {
    const outcome = reconcileEvidenceCharts(
      report([
        {
          type: "chart",
          chartType: "bar",
          title: "Ventas por producto",
          data: [
            {
              x: "Inventado",
              series: [{ key: "revenue", value: 999999 }],
            },
          ],
        },
      ]),
      "No quiero una gráfica, solo tabla",
      productEvidence(),
    );

    expect(outcome).toMatchObject({ added: 0, reconciled: 0, discarded: 1 });
    expect(outcome.report.blocks.some((block) => block.type === "chart")).toBe(
      false,
    );
  });

  it("mapea categorias con valores, formato y fuente exactos", () => {
    const chart = chartFrom(
      reconcileEvidenceCharts(
        report(),
        "Gráfica las unidades vendidas por categoría",
        [
          {
            tool: "get_sales_by_category",
            ok: true,
            result: {
              groupBy: "categoria",
              groups: [
                { name: "Jerseys", revenue: 1800, units: 6 },
                { name: "Accesorios", revenue: 900, units: 11 },
              ],
            },
          },
        ],
      ).report,
    );

    expect(chart).toMatchObject({
      chartType: "bar",
      valueFormat: "number",
      sourceIds: ["source-1"],
      seriesLabels: [{ key: "units", label: "Unidades" }],
      data: [
        { x: "Jerseys", series: [{ key: "units", value: 6 }] },
        { x: "Accesorios", series: [{ key: "units", value: 11 }] },
      ],
    });
  });

  it("mapea una serie diaria real como linea con valores y fuente exactos", () => {
    const chart = chartFrom(
      reconcileEvidenceCharts(
        report(),
        "Gráfica la tendencia diaria de ingresos",
        [
          {
            tool: "get_sales_summary",
            ok: true,
            result: {
              dailySeries: [
                { date: "2026-08-24", revenue: 1250, orders: 2, units: 3 },
                { date: "2026-08-25", revenue: 2100, orders: 4, units: 7 },
              ],
            },
          },
        ],
      ).report,
    );

    expect(chart).toMatchObject({
      chartType: "line",
      valueFormat: "currency",
      sourceIds: ["source-1"],
      seriesLabels: [{ key: "revenue", label: "Ingresos" }],
      data: [
        {
          x: "2026-08-24",
          series: [{ key: "revenue", value: 1250 }],
        },
        {
          x: "2026-08-25",
          series: [{ key: "revenue", value: 2100 }],
        },
      ],
    });
  });

  it("no inventa una grafica cuando no hay evidencia compatible", () => {
    const outcome = reconcileEvidenceCharts(
      report(),
      "Grafica los productos por ventas",
      [{ tool: "get_inventory_health", ok: true, result: { products: [] } }],
    );

    expect(outcome.added).toBe(0);
    expect(outcome.report.blocks.some((block) => block.type === "chart")).toBe(
      false,
    );
  });
});
