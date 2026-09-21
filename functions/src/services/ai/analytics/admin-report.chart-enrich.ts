/** Deterministic charts derived exclusively from successful tool evidence. */

import { AdminReport, AdminReportBlock } from "./admin-report.schema";

export interface ChartEvidenceEntry {
  tool: string;
  ok: boolean;
  result?: unknown;
}

type ChartBlock = Extract<AdminReportBlock, { type: "chart" }>;
type ChartKind =
  | "product"
  | "product-interest"
  | "product-performance"
  | "category"
  | "daily-sales"
  | "daily-traffic"
  | "traffic-sources"
  | "funnel";

interface ChartCandidate {
  kind: ChartKind;
  block: ChartBlock;
}

const MAX_BAR_POINTS = 15;
const MAX_PIE_SLICES = 8;

const normalizeLanguage = (value: string): string =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

const VISUALIZATION_PATTERN =
  /\b(?:grafic\w*|charts?|barras?|pastel(?:es)?|circular(?:es)?|visualiz\w*|plots?|plotear)\b/;
const NEGATED_VISUALIZATION_PATTERN =
  /\b(?:sin(?:\s+(?:una?|ninguna))?|no(?:\s+(?:me\s+)?(?:quiero|deseo|necesito|hagas|muestres|mostrar|incluyas|incluir|generes|generar))?(?:\s+una?)?|evita(?:r)?(?:\s+la)?|omite(?:\s+la)?|excluye(?:\s+la)?)\s+(?:grafic\w*|charts?|barras?|pastel(?:es)?|circular(?:es)?|visualiz\w*|plots?|plotear)\b/;
const TABLE_ONLY_PATTERN = /\btabl\w*\b/;

const PRODUCT_PATTERN = /\b(?:product\w*|articul\w*|sku|jersey\w*)\b/;
const CATEGORY_PATTERN = /\b(?:categori\w*|linea\w*)\b/;
const TIME_PATTERN =
  /\b(?:tendenc\w*|evolucion\w*|tiempo|diari\w*|dias?|fechas?|histor\w*)\b/;
const UNITS_PATTERN = /\b(?:unidad\w*|pieza\w*|cantidad\w*)\b/;
const ORDERS_PATTERN = /\b(?:pedid\w*|orden\w*)\b/;
const VISITS_PATTERN =
  /\b(?:visit\w*|vistas?|interes|trafico|sesion(?:es)?)\b/;
const SOURCE_PATTERN = /\b(?:canal(?:es)?|fuent\w*|origen(?:es)?|utm)\b/;
const FUNNEL_PATTERN = /\b(?:embudo|funnel|conversion)\b/;
const PIE_PATTERN = /\b(?:pastel(?:es)?|circular(?:es)?|pie|donut)\b/;
const UNIQUE_PATTERN = /\b(?:unic\w*|visitantes?)\b/;
const CART_PATTERN = /\b(?:carrito|agregad\w*)\b/;

export const hasExplicitVisualizationIntent = (question: string): boolean => {
  const normalized = normalizeLanguage(question);
  return (
    VISUALIZATION_PATTERN.test(normalized) &&
    !NEGATED_VISUALIZATION_PATTERN.test(normalized)
  );
};

const hasExplicitVisualizationNegation = (question: string): boolean =>
  NEGATED_VISUALIZATION_PATTERN.test(normalizeLanguage(question));

const hasTableOnlyIntent = (question: string): boolean => {
  const normalized = normalizeLanguage(question);
  return (
    TABLE_ONLY_PATTERN.test(normalized) &&
    !VISUALIZATION_PATTERN.test(normalized)
  );
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const nonEmptyString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const finiteNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const sourceIdsForEvidence = (
  report: AdminReport,
  evidenceIndex: number,
): string[] | undefined => {
  const sourceId = `source-${evidenceIndex + 1}`;
  return report.sourceMetadata?.some((source) => source.id === sourceId)
    ? [sourceId]
    : undefined;
};

const pointsFromRows = (
  rows: unknown[],
  labelOf: (row: Record<string, unknown>) => string | null,
  valueOf: (row: Record<string, unknown>) => number | null,
  key: string,
  limit: number,
): ChartBlock["data"] =>
  rows.flatMap((raw) => {
    const row = asRecord(raw);
    if (!row) return [];
    const label = labelOf(row);
    const value = valueOf(row);
    return label && value !== null
      ? [{ x: label, series: [{ key, value }] }]
      : [];
  }).slice(0, limit);

const chartTypeFor = (
  question: string,
  pointCount: number,
  composition: boolean,
): "pie" | "bar" => {
  if (pointCount < 2) return "bar";
  if (PIE_PATTERN.test(normalizeLanguage(question))) return "pie";
  if (composition && pointCount <= MAX_PIE_SLICES) return "pie";
  return "bar";
};

const productCandidate = (
  report: AdminReport,
  evidence: ChartEvidenceEntry,
  evidenceIndex: number,
): ChartCandidate | null => {
  if (!evidence.ok || evidence.tool !== "get_sales_by_product") return null;
  const result = asRecord(evidence.result);
  if (!result) return null;
  const metric = result?.metric;
  if (metric !== "revenue" && metric !== "units") return null;
  const rows = Array.isArray(result.products) ? result.products : [];
  const data = pointsFromRows(
    rows,
    (row) => nonEmptyString(row.name) || nonEmptyString(row.sku),
    (row) => finiteNumber(row[metric]),
    metric,
    MAX_BAR_POINTS,
  );
  if (data.length === 0) return null;
  const revenue = metric === "revenue";
  return {
    kind: "product",
    block: {
      type: "chart",
      chartType: "bar",
      title: revenue
        ? "Ingresos por producto"
        : "Unidades vendidas por producto",
      xLabel: "Producto",
      valueFormat: revenue ? "currency" : "number",
      seriesLabels: [
        { key: metric, label: revenue ? "Ingresos" : "Unidades" },
      ],
      data,
      sourceIds: sourceIdsForEvidence(report, evidenceIndex),
    },
  };
};

const productInterestCandidate = (
  report: AdminReport,
  evidence: ChartEvidenceEntry,
  evidenceIndex: number,
  question: string,
): ChartCandidate | null => {
  if (!evidence.ok || evidence.tool !== "get_product_interest") return null;
  const result = asRecord(evidence.result);
  const rows = result && Array.isArray(result.products) ? result.products : [];
  const normalized = normalizeLanguage(question);
  const metric = UNIQUE_PATTERN.test(normalized)
    ? "uniqueViewers"
    : CART_PATTERN.test(normalized)
      ? "addToCart"
      : "views";
  const meta =
    metric === "uniqueViewers"
      ? { label: "Visitantes unicos", title: "Visitantes unicos por producto" }
      : metric === "addToCart"
        ? { label: "Agregados al carrito", title: "Agregados al carrito por producto" }
        : { label: "Vistas", title: "Vistas por producto" };
  const data = pointsFromRows(
    rows,
    (row) => nonEmptyString(row.name) || nonEmptyString(row.sku),
    (row) => finiteNumber(row[metric]),
    metric,
    MAX_BAR_POINTS,
  );
  if (data.length === 0) return null;
  const chartType = chartTypeFor(question, data.length, false);
  return {
    kind: "product-interest",
    block: {
      type: "chart",
      chartType,
      title: meta.title,
      xLabel: "Producto",
      valueFormat: "number",
      seriesLabels: [{ key: metric, label: meta.label }],
      data: chartType === "pie" ? data.slice(0, MAX_PIE_SLICES) : data,
      sourceIds: sourceIdsForEvidence(report, evidenceIndex),
    },
  };
};

const productPerformanceCandidate = (
  report: AdminReport,
  evidence: ChartEvidenceEntry,
  evidenceIndex: number,
  question: string,
): ChartCandidate | null => {
  if (!evidence.ok || evidence.tool !== "get_product_performance") return null;
  const result = asRecord(evidence.result);
  const rows = result && Array.isArray(result.products) ? result.products : [];
  const normalized = normalizeLanguage(question);
  const metric = UNITS_PATTERN.test(normalized)
    ? "unitsSold"
    : /\bingresos?\b|\brevenue\b|\bventas?\b/.test(normalized) &&
        !VISITS_PATTERN.test(normalized)
      ? "revenue"
      : "views";
  const meta =
    metric === "unitsSold"
      ? { label: "Unidades", title: "Unidades vendidas por producto", format: "number" as const }
      : metric === "revenue"
        ? { label: "Ingresos", title: "Ingresos por producto", format: "currency" as const }
        : { label: "Vistas", title: "Vistas por producto", format: "number" as const };
  const data = pointsFromRows(
    rows,
    (row) => nonEmptyString(row.name) || nonEmptyString(row.sku),
    (row) => finiteNumber(row[metric]),
    metric,
    MAX_BAR_POINTS,
  );
  if (data.length === 0) return null;
  return {
    kind: "product-performance",
    block: {
      type: "chart",
      chartType: "bar",
      title: meta.title,
      xLabel: "Producto",
      valueFormat: meta.format,
      seriesLabels: [{ key: metric, label: meta.label }],
      data,
      sourceIds: sourceIdsForEvidence(report, evidenceIndex),
    },
  };
};

const categoryCandidate = (
  report: AdminReport,
  evidence: ChartEvidenceEntry,
  evidenceIndex: number,
  question: string,
): ChartCandidate | null => {
  if (!evidence.ok || evidence.tool !== "get_sales_by_category") return null;
  const result = asRecord(evidence.result);
  const metric = UNITS_PATTERN.test(normalizeLanguage(question))
    ? "units"
    : "revenue";
  const rows = result && Array.isArray(result.groups) ? result.groups : [];
  const data = pointsFromRows(
    rows,
    (row) => nonEmptyString(row.name),
    (row) => finiteNumber(row[metric]),
    metric,
    MAX_BAR_POINTS,
  );
  if (data.length === 0) return null;
  const revenue = metric === "revenue";
  const isLine = result?.groupBy === "linea";
  const groupLabel = isLine ? "linea" : "categoria";
  const chartType = chartTypeFor(question, data.length, false);
  return {
    kind: "category",
    block: {
      type: "chart",
      chartType,
      title: revenue
        ? `Ingresos por ${groupLabel}`
        : `Unidades por ${groupLabel}`,
      xLabel: isLine ? "Linea" : "Categoria",
      valueFormat: revenue ? "currency" : "number",
      seriesLabels: [
        { key: metric, label: revenue ? "Ingresos" : "Unidades" },
      ],
      data: chartType === "pie" ? data.slice(0, MAX_PIE_SLICES) : data,
      sourceIds: sourceIdsForEvidence(report, evidenceIndex),
    },
  };
};

const dailySalesCandidate = (
  report: AdminReport,
  evidence: ChartEvidenceEntry,
  evidenceIndex: number,
  question: string,
): ChartCandidate | null => {
  if (!evidence.ok || evidence.tool !== "get_sales_summary") return null;
  const result = asRecord(evidence.result);
  const rows = result && Array.isArray(result.dailySeries)
    ? result.dailySeries
    : [];
  const normalized = normalizeLanguage(question);
  const metric = UNITS_PATTERN.test(normalized)
    ? "units"
    : ORDERS_PATTERN.test(normalized)
      ? "orders"
      : "revenue";
  const data = pointsFromRows(
    rows,
    (row) => nonEmptyString(row.date),
    (row) => finiteNumber(row[metric]),
    metric,
    62,
  );
  if (data.length === 0) return null;
  const metadata =
    metric === "revenue"
      ? { label: "Ingresos", format: "currency" as const }
      : metric === "orders"
        ? { label: "Pedidos", format: "number" as const }
        : { label: "Unidades", format: "number" as const };
  return {
    kind: "daily-sales",
    block: {
      type: "chart",
      chartType: "line",
      title: `${metadata.label} por dia`,
      xLabel: "Fecha",
      valueFormat: metadata.format,
      seriesLabels: [{ key: metric, label: metadata.label }],
      data,
      sourceIds: sourceIdsForEvidence(report, evidenceIndex),
    },
  };
};

const dailyTrafficCandidate = (
  report: AdminReport,
  evidence: ChartEvidenceEntry,
  evidenceIndex: number,
  question: string,
): ChartCandidate | null => {
  if (!evidence.ok || evidence.tool !== "get_traffic_summary") return null;
  const result = asRecord(evidence.result);
  const daily = result && Array.isArray(result.dailySeries)
    ? result.dailySeries
    : [];
  const normalized = normalizeLanguage(question);
  const metric = /\bsesion/.test(normalized)
    ? "sessions"
    : /\bproducto/.test(normalized)
      ? "productViews"
      : "visits";
  if (daily.length > 0) {
    const data = pointsFromRows(
      daily,
      (row) => nonEmptyString(row.date),
      (row) => finiteNumber(row[metric]),
      metric,
      62,
    );
    if (data.length === 0) return null;
    const label =
      metric === "sessions"
        ? "Sesiones"
        : metric === "productViews"
          ? "Vistas de producto"
          : "Visitas";
    return {
      kind: "daily-traffic",
      block: {
        type: "chart",
        chartType: "line",
        title: `${label} por dia`,
        xLabel: "Fecha",
        valueFormat: "number",
        seriesLabels: [{ key: metric, label }],
        data,
        sourceIds: sourceIdsForEvidence(report, evidenceIndex),
      },
    };
  }

  const weekday = result && Array.isArray(result.visitsByWeekday)
    ? result.visitsByWeekday
    : [];
  const data = pointsFromRows(
    weekday,
    (row) => nonEmptyString(row.weekday),
    (row) => finiteNumber(row.visits),
    "visits",
    7,
  );
  if (data.length === 0) return null;
  return {
    kind: "daily-traffic",
    block: {
      type: "chart",
      chartType: "bar",
      title: "Visitas por dia de la semana",
      xLabel: "Dia",
      valueFormat: "number",
      seriesLabels: [{ key: "visits", label: "Visitas" }],
      data,
      sourceIds: sourceIdsForEvidence(report, evidenceIndex),
    },
  };
};

const trafficSourcesCandidate = (
  report: AdminReport,
  evidence: ChartEvidenceEntry,
  evidenceIndex: number,
  question: string,
): ChartCandidate | null => {
  if (!evidence.ok || evidence.tool !== "get_traffic_sources") return null;
  const result = asRecord(evidence.result);
  const rows = result && Array.isArray(result.channels) ? result.channels : [];
  const data = pointsFromRows(
    rows,
    (row) => {
      const source = nonEmptyString(row.source);
      const medium = nonEmptyString(row.medium);
      if (!source) return null;
      return medium && medium !== source ? `${source} / ${medium}` : source;
    },
    (row) => finiteNumber(row.sessions),
    "sessions",
    MAX_BAR_POINTS,
  );
  if (data.length === 0) return null;
  const chartType = chartTypeFor(question, data.length, true);
  return {
    kind: "traffic-sources",
    block: {
      type: "chart",
      chartType,
      title: "Sesiones por canal",
      xLabel: "Canal",
      valueFormat: "number",
      seriesLabels: [{ key: "sessions", label: "Sesiones" }],
      data: chartType === "pie" ? data.slice(0, MAX_PIE_SLICES) : data,
      sourceIds: sourceIdsForEvidence(report, evidenceIndex),
    },
  };
};

const funnelCandidate = (
  report: AdminReport,
  evidence: ChartEvidenceEntry,
  evidenceIndex: number,
): ChartCandidate | null => {
  if (!evidence.ok || evidence.tool !== "get_conversion_funnel") return null;
  const result = asRecord(evidence.result);
  const rows = result && Array.isArray(result.stages) ? result.stages : [];
  const data = pointsFromRows(
    rows,
    (row) => nonEmptyString(row.label) || nonEmptyString(row.stage),
    (row) => finiteNumber(row.sessions),
    "sessions",
    8,
  );
  if (data.length === 0) return null;
  return {
    kind: "funnel",
    block: {
      type: "chart",
      chartType: "bar",
      title: "Embudo de conversion",
      xLabel: "Etapa",
      valueFormat: "number",
      seriesLabels: [{ key: "sessions", label: "Sesiones" }],
      data,
      sourceIds: sourceIdsForEvidence(report, evidenceIndex),
    },
  };
};

const inferKindFromText = (text: string): ChartKind | undefined => {
  const normalized = normalizeLanguage(text);
  if (FUNNEL_PATTERN.test(normalized) || /\betapa/.test(normalized)) {
    return "funnel";
  }
  if (SOURCE_PATTERN.test(normalized) || /\bcanal/.test(normalized)) {
    return "traffic-sources";
  }
  if (CATEGORY_PATTERN.test(normalized)) {
    return "category";
  }
  if (
    (VISITS_PATTERN.test(normalized) || /\bvistas?\b/.test(normalized)) &&
    PRODUCT_PATTERN.test(normalized)
  ) {
    return "product-interest";
  }
  if (PRODUCT_PATTERN.test(normalized) && /\bdesempen/.test(normalized)) {
    return "product-performance";
  }
  if (PRODUCT_PATTERN.test(normalized)) {
    return "product";
  }
  if (TIME_PATTERN.test(normalized) && VISITS_PATTERN.test(normalized)) {
    return "daily-traffic";
  }
  if (TIME_PATTERN.test(normalized)) {
    return "daily-sales";
  }
  return undefined;
};

const selectRequestedCandidate = (
  question: string,
  candidates: ChartCandidate[],
): ChartCandidate | undefined => {
  if (candidates.length === 0) return undefined;
  const normalized = normalizeLanguage(question);
  const preferred: ChartKind[] = [];

  if (FUNNEL_PATTERN.test(normalized)) preferred.push("funnel");
  if (SOURCE_PATTERN.test(normalized)) preferred.push("traffic-sources");
  if (VISITS_PATTERN.test(normalized) && PRODUCT_PATTERN.test(normalized)) {
    preferred.push("product-interest", "product-performance");
  }
  if (CATEGORY_PATTERN.test(normalized)) preferred.push("category");
  if (PRODUCT_PATTERN.test(normalized)) {
    preferred.push("product", "product-interest", "product-performance");
  }
  if (TIME_PATTERN.test(normalized) || VISITS_PATTERN.test(normalized)) {
    preferred.push("daily-traffic", "daily-sales");
  }

  for (const kind of preferred) {
    const match = candidates.find((candidate) => candidate.kind === kind);
    if (match) return match;
  }

  return candidates.length === 1
    ? candidates[0]
    : candidates.find((candidate) => candidate.block.chartType === "bar") ||
      candidates.find((candidate) => candidate.block.chartType === "pie") ||
      candidates[0];
};

const selectExistingCandidate = (
  chart: ChartBlock,
  requested: ChartCandidate | undefined,
  candidates: ChartCandidate[],
): ChartCandidate | undefined => {
  const kind = inferKindFromText(`${chart.title || ""} ${chart.xLabel || ""}`);
  return kind
    ? candidates.find((candidate) => candidate.kind === kind)
    : requested;
};

const insertRequestedChart = (
  blocks: AdminReportBlock[],
  chart: ChartBlock,
): AdminReportBlock[] => {
  const next = [...blocks];
  const firstTable = next.findIndex((block) => block.type === "table");
  const boundary = firstTable >= 0 ? firstTable : next.length;
  let lastKpi = -1;
  for (let index = 0; index < boundary; index += 1) {
    if (next[index].type === "kpis") lastKpi = index;
  }
  next.splice(lastKpi >= 0 ? lastKpi + 1 : boundary, 0, chart);
  return next;
};

const collectCandidates = (
  report: AdminReport,
  question: string,
  evidence: ChartEvidenceEntry[],
): ChartCandidate[] =>
  evidence.flatMap((entry, index) =>
    [
      productCandidate(report, entry, index),
      productInterestCandidate(report, entry, index, question),
      productPerformanceCandidate(report, entry, index, question),
      categoryCandidate(report, entry, index, question),
      dailySalesCandidate(report, entry, index, question),
      dailyTrafficCandidate(report, entry, index, question),
      trafficSourcesCandidate(report, entry, index, question),
      funnelCandidate(report, entry, index),
    ].filter((candidate): candidate is ChartCandidate => candidate !== null),
  );

export const reconcileEvidenceCharts = (
  report: AdminReport,
  question: string,
  evidence: ChartEvidenceEntry[],
): { report: AdminReport; added: number; reconciled: number; discarded: number } => {
  if (hasExplicitVisualizationNegation(question)) {
    const blocks = report.blocks.filter((block) => block.type !== "chart");
    return {
      report: { ...report, blocks },
      added: 0,
      reconciled: 0,
      discarded: report.blocks.length - blocks.length,
    };
  }

  const candidates = collectCandidates(report, question, evidence);
  const tableOnly = hasTableOnlyIntent(question);
  const requested = tableOnly
    ? undefined
    : selectRequestedCandidate(question, candidates);
  let reconciled = 0;
  let discarded = 0;
  let requestedPresent = false;
  let blocks: AdminReportBlock[] = [];
  for (const block of report.blocks) {
    if (block.type !== "chart") {
      blocks.push(block);
      continue;
    }
    const candidate = selectExistingCandidate(block, requested, candidates);
    if (!candidate) {
      discarded += 1;
      continue;
    }
    reconciled += 1;
    if (candidate === requested) requestedPresent = true;
    blocks.push({
      ...candidate.block,
      title: block.title || candidate.block.title,
    });
  }

  let added = 0;
  if (requested && !requestedPresent) {
    blocks = insertRequestedChart(blocks, requested.block);
    added = 1;
  }

  return {
    report: { ...report, blocks },
    added,
    reconciled,
    discarded,
  };
};
