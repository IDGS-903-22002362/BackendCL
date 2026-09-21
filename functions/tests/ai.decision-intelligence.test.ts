import type { AnalyticsOrder } from "../src/services/ai/analytics/analytics.repository";
import {
  analyzeAffinity,
  buildCustomerCohorts,
  decomposeMultiplicativeChange,
  gradeEvidence,
  segmentProducts,
  simulateScenario,
} from "../src/services/ai/analytics/decision-intelligence.metrics";
import { ANALYTICS_TOOLS } from "../src/services/ai/analytics/analytics.tools";
import {
  adminReportSchema,
  sanitizeAdminReport,
} from "../src/services/ai/analytics/admin-report.schema";
import {
  __conversationStateTestables,
  evolveAdminConversationState,
} from "../src/services/ai/analytics/admin-conversation-state";

const order = (
  id: string,
  products: string[],
  overrides: Partial<AnalyticsOrder> = {},
): AnalyticsOrder => ({
  id,
  createdAt: overrides.createdAt || new Date("2026-01-01T18:00:00.000Z"),
  dayKey: overrides.dayKey || "2026-01-01",
  estado: "ENTREGADA",
  paymentStatus: "PAGADO",
  fulfillmentMethod: "DELIVERY",
  metodoPago: "TARJETA",
  total: overrides.total ?? 100,
  subtotal: overrides.total ?? 100,
  shippingTotal: 0,
  discountTotal: 0,
  promoCode: null,
  promoCodeDiscount: 0,
  customerKey: overrides.customerKey ?? `customer-${id}`,
  items: products.map((productoId) => ({
    productoId,
    cantidad: 1,
    precioUnitario: 100,
    subtotal: 100,
  })),
  ...overrides,
});

describe("simulaciones deterministas", () => {
  const baseline = {
    traffic: 1000,
    conversionRate: 2,
    averageOrderValue: 500,
  };

  it.each([
    ["traffic +10%", { trafficPercent: 10 }, 11000],
    ["conversion +10%", { conversionRatePercent: 10 }, 11000],
    ["AOV +10%", { averageOrderValuePercent: 10 }, 11000],
    [
      "combinacion +10%",
      {
        trafficPercent: 10,
        conversionRatePercent: 10,
        averageOrderValuePercent: 10,
      },
      13310,
    ],
  ])("calcula %s", (_label, adjustments, expectedRevenue) => {
    const result = simulateScenario(baseline, adjustments);
    expect(result.baseline.revenue).toBe(10000);
    expect(result.simulated.revenue).toBe(expectedRevenue);
  });

  it("descompone exactamente paidOrders x AOV sin llamarlo causalidad", () => {
    const result = decomposeMultiplicativeChange([
      { key: "paidOrders", previous: 10, current: 12 },
      { key: "averageOrderValue", previous: 100, current: 90 },
    ]);
    expect(result.current).toBe(1080);
    expect(result.change).toBe(80);
    expect(
      result.contributions.reduce((sum, item) => sum + item.contribution, 0),
    ).toBe(80);
  });
});

describe("segmentacion de productos", () => {
  const result = segmentProducts([
    { productId: "star", name: "Star", views: 100, conversion: 10, revenue: 1000, growthPercent: 20, availableStock: 20, minStock: 5, daysOfSupply: 30 },
    { productId: "opp", name: "Opportunity", views: 100, conversion: 1, revenue: 500, growthPercent: 0, availableStock: 20, minStock: 5, daysOfSupply: 30 },
    { productId: "efficient", name: "Efficient", views: 10, conversion: 10, revenue: 400, growthPercent: 0, availableStock: 10, minStock: 2, daysOfSupply: 20 },
    { productId: "stagnant", name: "Stagnant", views: 10, conversion: 1, revenue: 50, growthPercent: -20, availableStock: 10, minStock: 2, daysOfSupply: null },
    { productId: "risk", name: "Risk", views: 90, conversion: 8, revenue: 900, growthPercent: 30, availableStock: 2, minStock: 5, daysOfSupply: 5 },
    { productId: "overstock", name: "Overstock", views: 5, conversion: 0, revenue: 0, growthPercent: -30, availableStock: 100, minStock: 5, daysOfSupply: null },
  ]);
  const byId = new Map(result.products.map((product) => [product.productId, product]));

  it("clasifica los cuatro cuadrantes con medianas dinamicas", () => {
    expect(byId.get("star")?.segments).toContain("STARS");
    expect(byId.get("opp")?.segments).toContain("OPPORTUNITIES");
    expect(byId.get("efficient")?.segments).toContain("EFFICIENT");
    expect(byId.get("stagnant")?.segments).toContain("STAGNANT");
    expect(result.thresholds.views).not.toBe(100);
  });

  it("anade riesgo de stock y sobreinventario", () => {
    expect(byId.get("risk")?.segments).toContain("STOCK_RISK");
    expect(byId.get("overstock")?.segments).toContain("OVERSTOCK");
    expect(byId.get("opp")?.opportunityScore).toBeGreaterThan(0);
  });
});

describe("afinidad de productos", () => {
  it("calcula support, confidence y lift sobre canastas sinteticas", () => {
    const baskets = [
      ["A", "B"], ["A", "B"], ["A", "B"], ["A"], ["A"],
      ["B"], ["C"], ["C"], ["C"], ["C"],
    ];
    const result = analyzeAffinity(
      baskets.map((products, index) => order(String(index), products)),
    );
    const pair = result.pairs.find(
      (candidate) => candidate.productA === "A" && candidate.productB === "B",
    );
    expect(result.eligibleOrders).toBe(10);
    expect(pair).toMatchObject({
      pairOrders: 3,
      support: 0.3,
      confidenceAToB: 0.6,
      confidenceBToA: 0.75,
      lift: 1.5,
      evidence: "limited",
    });
  });
});

describe("cohortes", () => {
  it("usa denominadores maduros y recompra a 30/60/90 dias", () => {
    const orders = [
      order("1", ["A"], { customerKey: "c1", createdAt: new Date("2026-01-01T12:00:00Z") }),
      order("2", ["A"], { customerKey: "c1", createdAt: new Date("2026-01-20T12:00:00Z") }),
      order("3", ["A"], { customerKey: "c2", createdAt: new Date("2026-01-05T12:00:00Z") }),
      order("4", ["B"], { customerKey: "c3", createdAt: new Date("2026-02-01T12:00:00Z") }),
      order("5", ["B"], { customerKey: "c3", createdAt: new Date("2026-03-15T12:00:00Z") }),
    ];
    const cohorts = buildCustomerCohorts(orders, new Date("2026-04-15T12:00:00Z"));
    expect(cohorts[0]).toMatchObject({
      cohort: "2026-01",
      customers: 2,
      eligible30: 2,
      repeat30Rate: 50,
      eligible60: 2,
      repeat60Rate: 50,
      eligible90: 2,
      repeat90Rate: 50,
    });
    expect(cohorts[1].repeat60Rate).toBe(100);
  });
});

describe("evidencia, registro, schema y estado", () => {
  it("degrada evidencia cuando la cobertura es parcial", () => {
    expect(
      gradeEvidence({
        sampleSize: 1000,
        coverageComplete: false,
        freshnessDays: 1,
        consistentSignals: 3,
      }),
    ).toBe("limited");
  });

  it("registra las ocho tools de fase 3 sin duplicados", () => {
    const names = ANALYTICS_TOOLS.map((tool) => tool.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "prioritize_business_findings",
        "decompose_metric_change",
        "simulate_business_scenario",
        "segment_products",
        "get_customer_segments",
        "analyze_customer_cohorts",
        "analyze_product_affinity",
        "get_business_brief",
      ]),
    );
    expect(new Set(names).size).toBe(names.length);
  });

  it("acepta bloques anteriores y los nuevos de forma aditiva", () => {
    const legacy = adminReportSchema.parse({
      summary: "Resumen",
      confidence: "media",
      blocks: [{ type: "text", kind: "conclusion", content: "Sin cambios" }],
    });
    expect(sanitizeAdminReport(legacy).blocks).toHaveLength(1);

    const modern = adminReportSchema.parse({
      summary: "Resumen",
      confidence: "alta",
      sourceMetadata: [{ id: "source-1", label: "Ventas confirmadas", observedAt: "2026-01-01T00:00:00Z", freshness: "fresh", coverage: "complete" }],
      blocks: [
        { type: "insight", findingId: "sales", title: "Ventas", summary: "Subieron", classification: "observed", priority: "opportunity", evidence: "high", change: 10, sourceIds: ["source-1"] },
        { type: "scenario", title: "Conversion +10%", scenarioType: "custom", status: "simulated", baseline: [{ label: "Ingresos", value: 100 }], result: [{ label: "Ingresos", value: 110 }], assumptions: ["Todo lo demas constante"], limitations: ["No es forecast"] },
        { type: "comparison", title: "Opciones", options: [
          { name: "A", description: "Primera", evidence: "medium", advantages: [], risks: [], expectedDirection: "positiva", requirements: [] },
          { name: "B", description: "Segunda", evidence: "limited", advantages: [], risks: [], expectedDirection: "incierta", requirements: [] },
        ] },
        { type: "diagram", diagramType: "flow", title: "Flujo", nodes: [{ id: "a", label: "A" }, { id: "b", label: "B" }], edges: [{ from: "a", to: "b" }] },
        { type: "segment", segmentType: "product", title: "Productos", methodology: "mediana", items: [{ label: "Jersey", segment: "STARS", evidence: "medium", metrics: [] }] },
      ],
    });
    expect(modern.blocks.map((block) => block.type)).toEqual([
      "insight", "scenario", "comparison", "diagram", "segment",
    ]);
  });

  it("resuelve ordinales y conserva opciones en estado estructurado", () => {
    expect(__conversationStateTestables.ordinalIndex("Simula la segunda opción")).toBe(1);
    const state = evolveAdminConversationState({
      question: "¿Qué harías?",
      now: new Date("2026-01-01T00:00:00Z"),
      report: adminReportSchema.parse({
        summary: "Opciones",
        confidence: "media",
        blocks: [{
          type: "comparison",
          title: "Opciones",
          options: [
            { name: "A", description: "Primera", evidence: "medium", advantages: [], risks: [], expectedDirection: "positiva", requirements: [] },
            { name: "B", description: "Segunda", evidence: "medium", advantages: [], risks: [], expectedDirection: "positiva", requirements: [] },
          ],
        }],
      }),
    });
    const next = evolveAdminConversationState({
      previous: state,
      question: "Simula la segunda opción",
      report: adminReportSchema.parse({ summary: "Seguimiento", confidence: "media", blocks: [{ type: "text", kind: "contexto", content: "En proceso" }] }),
    });
    expect(next.selectedOption?.name).toBe("B");
  });
});
