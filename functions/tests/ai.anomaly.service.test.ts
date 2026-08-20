/**
 * Deteccion de anomalias y correlaciones del Asistente Administrativo.
 *
 * Las pruebas cubren el requisito mas delicado: un cambio pequeno no puede
 * reportarse como anomalia, y una correlacion nunca puede presentarse como
 * causa.
 */

import {
  MIN_BASELINE_OBSERVATIONS,
  detectProductAnomalies,
  detectSeriesAnomalies,
  rankAnomalies,
} from "../src/services/ai/analytics/anomaly.service";
import {
  RELATIONSHIP_CATALOG,
  analyzeCorrelation,
  pearson,
  spearman,
} from "../src/services/ai/analytics/correlation.util";
import {
  SeriesPoint,
  __forecastTestables,
} from "../src/services/ai/analytics/forecast.service";

const buildSeries = (values: number[]): SeriesPoint[] =>
  values.map((value, index) => ({
    date: __forecastTestables.addDays("2026-06-01", index),
    value,
  }));

describe("detectSeriesAnomalies", () => {
  it("no juzga desvios sin linea base suficiente", () => {
    const result = detectSeriesAnomalies({
      metric: "visits",
      metricLabel: "Visitas",
      series: buildSeries([10, 12, 11, 9, 10]),
    });

    expect(result.findings).toHaveLength(0);
    expect(result.skippedReason).toContain(String(MIN_BASELINE_OBSERVATIONS + 1));
  });

  it("ignora variaciones normales del dia a dia", () => {
    const baseline = Array.from({ length: 20 }, (_, index) =>
      [100, 104, 96, 102, 98][index % 5],
    );
    const result = detectSeriesAnomalies({
      metric: "visits",
      metricLabel: "Visitas",
      series: buildSeries([...baseline, 103, 97, 101]),
      recentDays: 3,
    });

    expect(result.findings).toHaveLength(0);
    expect(result.skippedReason).toBeNull();
  });

  it("detecta una caida fuerte y la clasifica como caida", () => {
    const baseline = Array.from({ length: 20 }, (_, index) =>
      [200, 205, 195, 210, 198][index % 5],
    );
    const result = detectSeriesAnomalies({
      metric: "orders",
      metricLabel: "Pedidos pagados",
      series: buildSeries([...baseline, 40]),
      recentDays: 1,
    });

    expect(result.findings).toHaveLength(1);
    const [finding] = result.findings;
    expect(finding.direction).toBe("caida");
    expect(finding.severity).toBe("alta");
    expect(finding.observedValue).toBe(40);
    expect(finding.expectedRange.lower).toBeGreaterThanOrEqual(0);
    expect(finding.evidence).toContain("nivel habitual");
  });

  it("detecta un pico inusual de trafico", () => {
    const baseline = Array.from({ length: 20 }, (_, index) =>
      [50, 55, 45, 52, 48][index % 5],
    );
    const result = detectSeriesAnomalies({
      metric: "visits",
      metricLabel: "Visitas",
      series: buildSeries([...baseline, 400]),
      recentDays: 1,
    });

    expect(result.findings[0].direction).toBe("pico");
    expect(result.findings[0].severity).toBe("alta");
  });

  it("reporta un cambio de nivel en una serie plana sin dispersion", () => {
    const result = detectSeriesAnomalies({
      metric: "orders",
      metricLabel: "Pedidos pagados",
      series: buildSeries([...Array.from({ length: 20 }, () => 10), 0]),
      recentDays: 1,
    });

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].deviationScore).toBeNull();
    expect(result.findings[0].severity).toBe("alta");
  });

  it("ordena los hallazgos por severidad", () => {
    const ranked = rankAnomalies([
      {
        metric: "a",
        metricLabel: "A",
        scope: "serie_diaria",
        reference: "2026-06-01",
        observedValue: 1,
        expectedValue: 2,
        expectedRange: { lower: 0, upper: 4 },
        deviationScore: 3.1,
        direction: "caida",
        severity: "media",
        evidence: "",
      },
      {
        metric: "b",
        metricLabel: "B",
        scope: "producto",
        reference: "Jersey",
        observedValue: 9,
        expectedValue: 2,
        expectedRange: { lower: 0, upper: 4 },
        deviationScore: null,
        direction: "pico",
        severity: "alta",
        evidence: "",
      },
    ]);

    expect(ranked.map((finding) => finding.severity)).toEqual(["alta", "media"]);
  });
});

describe("detectProductAnomalies", () => {
  const products = [
    {
      productId: "p1",
      name: "Jersey local",
      views: 320,
      addToCart: 18,
      unitsSold: 0,
      availableStock: 40,
      daysOfSupply: null,
    },
    {
      productId: "p2",
      name: "Jersey visitante",
      views: 300,
      addToCart: 4,
      unitsSold: 0,
      availableStock: 0,
      daysOfSupply: null,
    },
    {
      productId: "p3",
      name: "Gorra",
      views: 20,
      addToCart: 2,
      unitsSold: 1,
      availableStock: 5,
      daysOfSupply: null,
    },
    {
      productId: "p4",
      name: "Bufanda",
      views: 90,
      addToCart: 30,
      unitsSold: 25,
      availableStock: 6,
      daysOfSupply: 2,
    },
  ];

  it("marca interes alto sin ventas y baja la severidad si no hay stock", () => {
    const findings = detectProductAnomalies({
      products,
      highInterestViewsThreshold: 100,
    });

    const withoutSales = findings.filter(
      (finding) => finding.metric === "producto_vistas_sin_venta",
    );

    expect(withoutSales.map((finding) => finding.reference)).toEqual([
      "Jersey local",
      "Jersey visitante",
    ]);
    expect(withoutSales[0].severity).toBe("media");
    expect(withoutSales[1].severity).toBe("baja");
    expect(withoutSales[1].evidence).toContain("no tiene stock");
  });

  it("avisa cuando el inventario se agota en pocos dias", () => {
    const findings = detectProductAnomalies({
      products,
      highInterestViewsThreshold: 100,
    });

    const supply = findings.find(
      (finding) => finding.metric === "inventario_dias_cobertura",
    );

    expect(supply?.reference).toBe("Bufanda");
    expect(supply?.severity).toBe("alta");
  });

  it("no reporta productos con pocas vistas como anomalia de interes", () => {
    const findings = detectProductAnomalies({
      products,
      highInterestViewsThreshold: 1000,
    });

    expect(
      findings.some((finding) => finding.metric === "producto_vistas_sin_venta"),
    ).toBe(false);
  });
});

describe("correlaciones", () => {
  it("no calcula correlacion con menos de tres pares", () => {
    expect(pearson([1, 2], [2, 4])).toBeNull();
    expect(spearman([1, 2], [2, 4])).toBeNull();
  });

  it("detecta una relacion positiva perfecta", () => {
    const points = Array.from({ length: 12 }, (_, index) => ({
      label: `dia-${index}`,
      x: index * 10,
      y: index * 30,
    }));

    const result = analyzeCorrelation(points);

    expect(result.pearson).toBe(1);
    expect(result.strength).toBe("fuerte");
    expect(result.direction).toBe("positiva");
    expect(result.reliable).toBe(true);
    expect(result.caveat).toContain("no implica causalidad");
  });

  it("detecta una relacion negativa y advierte con pocos puntos", () => {
    const points = Array.from({ length: 5 }, (_, index) => ({
      label: `p-${index}`,
      x: index,
      y: 100 - index * 20,
    }));

    const result = analyzeCorrelation(points);

    expect(result.pearson).toBe(-1);
    expect(result.direction).toBe("negativa");
    expect(result.reliable).toBe(false);
    expect(result.caveat).toContain("indicio");
  });

  it("devuelve no_calculable cuando una variable no varia", () => {
    const points = Array.from({ length: 10 }, (_, index) => ({
      label: `p-${index}`,
      x: 5,
      y: index,
    }));

    const result = analyzeCorrelation(points);

    expect(result.pearson).toBeNull();
    expect(result.strength).toBe("no_calculable");
    expect(result.direction).toBe("sin_direccion");
  });

  it("captura relaciones monotonas no lineales con Spearman", () => {
    const points = Array.from({ length: 12 }, (_, index) => ({
      label: `p-${index}`,
      x: index,
      y: Math.pow(index, 3),
    }));

    const result = analyzeCorrelation(points);

    expect(result.spearman).toBe(1);
    expect(result.pearson).not.toBeNull();
  });

  it("solo declara relaciones del catalogo permitido", () => {
    for (const definition of Object.values(RELATIONSHIP_CATALOG)) {
      expect(["tiempo", "producto"]).toContain(definition.unit);
      expect(definition.description.length).toBeGreaterThan(10);
    }
  });
});
