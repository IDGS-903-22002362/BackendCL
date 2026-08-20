/**
 * Correlaciones entre metricas permitidas.
 *
 * El modelo no puede ejecutar codigo ni pedir combinaciones arbitrarias: solo
 * puede elegir una de las relaciones declaradas en RELATIONSHIP_CATALOG.
 *
 * La salida separa explicitamente correlacion de causalidad. Una correlacion
 * alta nunca debe presentarse como prueba de causa.
 */

const round2 = (value: number): number => Math.round(value * 100) / 100;
const round3 = (value: number): number => Math.round(value * 1000) / 1000;

export const RELATIONSHIP_KEYS = [
  "visits_vs_revenue",
  "visits_vs_orders",
  "product_views_vs_units",
  "add_to_cart_vs_orders",
  "sessions_vs_conversion",
  "product_views_vs_units_by_product",
  "stock_vs_units_by_product",
  "discount_vs_conversion_by_product",
] as const;

export type RelationshipKey = (typeof RELATIONSHIP_KEYS)[number];

export interface RelationshipDefinition {
  key: RelationshipKey;
  label: string;
  /** "tiempo" compara series diarias; "producto" compara productos. */
  unit: "tiempo" | "producto";
  xLabel: string;
  yLabel: string;
  description: string;
}

export const RELATIONSHIP_CATALOG: Record<
  RelationshipKey,
  RelationshipDefinition
> = {
  visits_vs_revenue: {
    key: "visits_vs_revenue",
    label: "Visitas diarias vs ingresos diarios",
    unit: "tiempo",
    xLabel: "Visitas",
    yLabel: "Ingresos",
    description:
      "Relacion entre las visitas registradas cada dia y los ingresos de pedidos pagados creados ese mismo dia.",
  },
  visits_vs_orders: {
    key: "visits_vs_orders",
    label: "Visitas diarias vs pedidos pagados",
    unit: "tiempo",
    xLabel: "Visitas",
    yLabel: "Pedidos pagados",
    description:
      "Relacion entre visitas diarias y cantidad de pedidos pagados del mismo dia.",
  },
  product_views_vs_units: {
    key: "product_views_vs_units",
    label: "Vistas de producto diarias vs unidades vendidas",
    unit: "tiempo",
    xLabel: "Vistas de producto",
    yLabel: "Unidades vendidas",
    description:
      "Relacion diaria entre vistas de producto y unidades pagadas del mismo dia.",
  },
  add_to_cart_vs_orders: {
    key: "add_to_cart_vs_orders",
    label: "Agregados al carrito vs pedidos pagados",
    unit: "tiempo",
    xLabel: "Agregados al carrito",
    yLabel: "Pedidos pagados",
    description:
      "Relacion diaria entre eventos de agregar al carrito y pedidos pagados.",
  },
  sessions_vs_conversion: {
    key: "sessions_vs_conversion",
    label: "Sesiones vs conversion de sesion",
    unit: "tiempo",
    xLabel: "Sesiones",
    yLabel: "Conversion de sesion (%)",
    description:
      "Relacion diaria entre volumen de sesiones y el porcentaje de sesiones que terminaron en compra.",
  },
  product_views_vs_units_by_product: {
    key: "product_views_vs_units_by_product",
    label: "Vistas vs unidades vendidas por producto",
    unit: "producto",
    xLabel: "Vistas del producto",
    yLabel: "Unidades vendidas",
    description:
      "Comparacion entre productos: vistas acumuladas frente a unidades pagadas en el mismo periodo.",
  },
  stock_vs_units_by_product: {
    key: "stock_vs_units_by_product",
    label: "Stock disponible vs unidades vendidas por producto",
    unit: "producto",
    xLabel: "Stock disponible",
    yLabel: "Unidades vendidas",
    description:
      "Comparacion entre productos: inventario disponible actual frente a unidades vendidas del periodo.",
  },
  discount_vs_conversion_by_product: {
    key: "discount_vs_conversion_by_product",
    label: "Descuento vigente vs conversion por producto",
    unit: "producto",
    xLabel: "Descuento (%)",
    yLabel: "Pedidos por 100 vistas",
    description:
      "Comparacion entre productos con oferta activa: porcentaje de descuento frente a pedidos por cada 100 vistas.",
  },
};

export interface CorrelationPoint {
  label: string;
  x: number;
  y: number;
}

export interface CorrelationResult {
  pairs: number;
  pearson: number | null;
  spearman: number | null;
  strength: "fuerte" | "moderada" | "debil" | "nula" | "no_calculable";
  direction: "positiva" | "negativa" | "sin_direccion";
  reliable: boolean;
  caveat: string;
}

const meanOf = (values: number[]): number =>
  values.length > 0 ? values.reduce((acc, value) => acc + value, 0) / values.length : 0;

export const pearson = (xs: number[], ys: number[]): number | null => {
  const size = Math.min(xs.length, ys.length);
  if (size < 3) {
    return null;
  }

  const xMean = meanOf(xs.slice(0, size));
  const yMean = meanOf(ys.slice(0, size));

  let covariance = 0;
  let xVariance = 0;
  let yVariance = 0;

  for (let index = 0; index < size; index += 1) {
    const dx = xs[index] - xMean;
    const dy = ys[index] - yMean;
    covariance += dx * dy;
    xVariance += dx * dx;
    yVariance += dy * dy;
  }

  if (xVariance === 0 || yVariance === 0) {
    return null;
  }

  return round3(covariance / Math.sqrt(xVariance * yVariance));
};

/** Rangos promediados para empates (necesario en series con muchos ceros). */
const rankValues = (values: number[]): number[] => {
  const indexed = values
    .map((value, index) => ({ value, index }))
    .sort((a, b) => a.value - b.value);

  const ranks = new Array<number>(values.length).fill(0);
  let position = 0;

  while (position < indexed.length) {
    let end = position;
    while (
      end + 1 < indexed.length &&
      indexed[end + 1].value === indexed[position].value
    ) {
      end += 1;
    }

    const averageRank = (position + end) / 2 + 1;
    for (let index = position; index <= end; index += 1) {
      ranks[indexed[index].index] = averageRank;
    }

    position = end + 1;
  }

  return ranks;
};

export const spearman = (xs: number[], ys: number[]): number | null => {
  const size = Math.min(xs.length, ys.length);
  if (size < 3) {
    return null;
  }

  return pearson(rankValues(xs.slice(0, size)), rankValues(ys.slice(0, size)));
};

const describeStrength = (
  value: number | null,
): CorrelationResult["strength"] => {
  if (value === null) {
    return "no_calculable";
  }

  const absolute = Math.abs(value);
  if (absolute >= 0.7) {
    return "fuerte";
  }
  if (absolute >= 0.4) {
    return "moderada";
  }
  if (absolute >= 0.2) {
    return "debil";
  }
  return "nula";
};

export const analyzeCorrelation = (
  points: CorrelationPoint[],
): CorrelationResult => {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const pearsonValue = pearson(xs, ys);
  const spearmanValue = spearman(xs, ys);

  return {
    pairs: points.length,
    pearson: pearsonValue,
    spearman: spearmanValue,
    strength: describeStrength(pearsonValue),
    direction:
      pearsonValue === null || Math.abs(pearsonValue) < 0.2
        ? "sin_direccion"
        : pearsonValue > 0
          ? "positiva"
          : "negativa",
    reliable: points.length >= 10 && pearsonValue !== null,
    caveat:
      points.length < 10
        ? "Muy pocos puntos para sostener una relacion; tratar como indicio, no como hallazgo."
        : "Correlacion no implica causalidad: puede haber factores externos (temporada, campanas, precio) que expliquen ambas metricas.",
  };
};

export const summarizePoints = (
  points: CorrelationPoint[],
  limit = 40,
): CorrelationPoint[] =>
  points
    .slice(0, limit)
    .map((point) => ({ ...point, x: round2(point.x), y: round2(point.y) }));

export const __correlationTestables = { rankValues, describeStrength };
