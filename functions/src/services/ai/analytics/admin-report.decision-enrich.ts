/** Reconciliacion de bloques de fase 3 con resultados deterministas de tools. */

import { AdminReport, AdminReportBlock } from "./admin-report.schema";

export interface DecisionEvidenceEntry {
  tool: string;
  arguments?: Record<string, unknown>;
  ok: boolean;
  result?: unknown;
  observedAt?: string;
}

const FRIENDLY_SOURCE_LABELS: Record<string, string> = {
  get_sales_summary: "Ventas confirmadas",
  compare_sales_periods: "Comparacion de ventas",
  get_sales_by_product: "Ventas por producto",
  get_sales_by_category: "Ventas por categoria",
  get_inventory_health: "Inventario disponible",
  get_orders_metrics: "Estado de pedidos",
  get_promotions_performance: "Promociones historicas",
  get_customer_metrics: "Clientes agregados",
  get_traffic_summary: "Trafico agregado",
  get_conversion_funnel: "Embudo de conversion",
  get_product_interest: "Interes por producto",
  get_product_performance: "Desempeno de productos",
  get_traffic_sources: "Canales de trafico",
  analyze_metric_relationships: "Relacion entre metricas",
  forecast_metric: "Pronostico estadistico",
  detect_business_anomalies: "Deteccion de anomalias",
  prioritize_business_findings: "Hallazgos priorizados",
  decompose_metric_change: "Descomposicion matematica",
  simulate_business_scenario: "Simulacion matematica",
  segment_products: "Segmentacion de productos",
  get_customer_segments: "Segmentos agregados de clientes",
  analyze_customer_cohorts: "Cohortes agregadas de clientes",
  analyze_product_affinity: "Afinidad de canastas",
  get_business_brief: "Resumen ejecutivo de negocio",
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const asNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const periodLabel = (result: Record<string, unknown> | null): string | undefined => {
  const candidate = result?.period ?? result?.currentPeriod ?? result?.analysisWindow;
  if (typeof candidate === "string") return candidate;
  const record = asRecord(candidate);
  return typeof record?.label === "string" ? record.label : undefined;
};

const hasTruncated = (value: unknown): boolean => {
  if (Array.isArray(value)) return value.some(hasTruncated);
  const record = asRecord(value);
  if (!record) return false;
  if (record.truncated === true) return true;
  return Object.values(record).some(hasTruncated);
};

const selectedEvidenceIndexes = (
  block: AdminReportBlock,
  evidence: DecisionEvidenceEntry[],
): number[] => {
  const byType: Record<string, string[]> = {
    insight: ["prioritize_business_findings", "get_business_brief"],
    scenario: ["simulate_business_scenario"],
    comparison: ["simulate_business_scenario", "prioritize_business_findings"],
    diagram: ["get_conversion_funnel", "decompose_metric_change"],
    segment:
      block.type === "segment" && block.segmentType === "product"
        ? ["segment_products"]
        : block.type === "segment" && block.segmentType === "cohort"
          ? ["analyze_customer_cohorts"]
          : ["get_customer_segments"],
    forecast: ["forecast_metric"],
    anomaly: ["detect_business_anomalies"],
    recommendations: ["prioritize_business_findings", "segment_products"],
  };
  const preferred = byType[block.type];
  const candidates = evidence
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => entry.ok);
  const selected = preferred
    ? candidates.filter(({ entry }) => preferred.includes(entry.tool))
    : candidates;
  return (selected.length > 0 ? selected : candidates).slice(0, 4).map(({ index }) => index);
};

const reconcileScenario = (
  block: AdminReportBlock,
  evidence: DecisionEvidenceEntry[],
): AdminReportBlock => {
  if (block.type !== "scenario") return block;
  const entry = [...evidence]
    .reverse()
    .find((candidate) => candidate.ok && candidate.tool === "simulate_business_scenario");
  const result = asRecord(entry?.result);
  const calculation = asRecord(result?.calculation);
  const baseline = asRecord(calculation?.baseline);
  const simulated = asRecord(calculation?.simulated);
  if (!baseline || !simulated || result?.available !== true) {
    return { ...block, baseline: [], result: [] };
  }
  const metric = (label: string, record: Record<string, unknown>, key: string, format?: "currency" | "number" | "percentage") => {
    const value = asNumber(record[key]);
    return value === undefined ? [] : [{ label, value, ...(format ? { format } : {}) }];
  };
  const assumptions = Array.isArray(result.assumptions)
    ? result.assumptions.filter((item): item is string => typeof item === "string")
    : block.assumptions;
  const limitations = Array.isArray(result.limitations)
    ? result.limitations.filter((item): item is string => typeof item === "string")
    : block.limitations;
  return {
    ...block,
    status: "simulated",
    scenarioType: "custom",
    baseline: [
      ...metric("Trafico", baseline, "traffic", "number"),
      ...metric("Conversion", baseline, "conversionRate", "percentage"),
      ...metric("Ticket promedio", baseline, "averageOrderValue", "currency"),
      ...metric("Ingresos", baseline, "revenue", "currency"),
    ],
    result: [
      ...metric("Trafico", simulated, "traffic", "number"),
      ...metric("Conversion", simulated, "conversionRate", "percentage"),
      ...metric("Ticket promedio", simulated, "averageOrderValue", "currency"),
      ...metric("Ingresos simulados", simulated, "revenue", "currency"),
    ],
    assumptions,
    limitations,
  };
};

const reconcileInsight = (
  block: AdminReportBlock,
  evidence: DecisionEvidenceEntry[],
): AdminReportBlock => {
  if (block.type !== "insight") return block;
  if (!block.findingId) {
    return {
      ...block,
      classification: "inference",
      priority: "low",
      evidence: "limited",
      metric: undefined,
      change: undefined,
      limitations: [
        ...(block.limitations || []),
        "No se pudo vincular el hallazgo con una observacion priorizada.",
      ],
    };
  }
  for (const entry of evidence) {
    if (!entry.ok || !["prioritize_business_findings", "get_business_brief"].includes(entry.tool)) continue;
    const result = asRecord(entry.result);
    const findings: unknown[] = result && Array.isArray(result.findings)
      ? result.findings
      : [];
    const match = findings.map(asRecord).find((finding) => finding?.id === block.findingId);
    if (!match) continue;
    const priority = match.priority;
    const evidenceLevel = match.evidence;
    return {
      ...block,
      priority:
        priority === "critical" || priority === "high" || priority === "medium" ||
        priority === "low" || priority === "opportunity"
          ? priority
          : block.priority,
      evidence:
        evidenceLevel === "high" || evidenceLevel === "medium" || evidenceLevel === "limited"
          ? evidenceLevel
          : block.evidence,
      metric: typeof match.metric === "string" ? match.metric : block.metric,
      change: asNumber(match.changePercent) ?? block.change,
      classification: "observed",
    };
  }
  return {
    ...block,
    classification: "inference",
    priority: "low",
    evidence: "limited",
    metric: undefined,
    change: undefined,
    limitations: [
      ...(block.limitations || []),
      "El hallazgo no coincidio con la evidencia priorizada disponible.",
    ],
  };
};

const reconcileSegment = (
  block: AdminReportBlock,
  evidence: DecisionEvidenceEntry[],
): AdminReportBlock => {
  if (block.type !== "segment") return block;
  const toolName =
    block.segmentType === "product"
      ? "segment_products"
      : block.segmentType === "cohort"
        ? "analyze_customer_cohorts"
        : "get_customer_segments";
  const entry = [...evidence].reverse().find(
    (candidate) => candidate.ok && candidate.tool === toolName,
  );
  const result = asRecord(entry?.result);
  if (!result || result.available === false) return { ...block, items: [] };

  if (block.segmentType === "product") {
    const products = Array.isArray(result.products) ? result.products : [];
    const evidenceLevel: "high" | "medium" | "limited" =
      result.evidence === "high" || result.evidence === "medium" || result.evidence === "limited"
        ? result.evidence
        : "limited";
    return {
      ...block,
      methodology:
        typeof result.opportunityScore === "string"
          ? result.opportunityScore
          : block.methodology,
      items: products.flatMap((raw) => {
        const product = asRecord(raw);
        if (!product) return [];
        const label = typeof product.name === "string" ? product.name : null;
        const segment = typeof product.segment === "string" ? product.segment : null;
        if (!label || !segment) return [];
        const metrics = [
          ["Vistas", "views", "number"],
          ["Conversion", "conversion", "percentage"],
          ["Ingresos", "revenue", "currency"],
          ["Stock", "availableStock", "number"],
        ].flatMap(([metricLabel, key, format]) => {
          const value = asNumber(product[key]);
          return value === undefined
            ? []
            : [{ label: metricLabel, value, format: format as "number" | "percentage" | "currency", status: "observed" as const }];
        });
        const score = asNumber(product.opportunityScore);
        return [{
          label,
          segment,
          ...(score === undefined ? {} : { score }),
          evidence: evidenceLevel,
          metrics,
        }];
      }).slice(0, 50),
    };
  }

  if (block.segmentType === "customer") {
    const segments = Array.isArray(result.segments) ? result.segments : [];
    return {
      ...block,
      methodology: typeof result.method === "string" ? result.method : block.methodology,
      items: segments.flatMap((raw) => {
        const segment = asRecord(raw);
        if (!segment) return [];
        const label = typeof segment.segment === "string" ? segment.segment : null;
        if (!label) return [];
        return [{
          label,
          segment: label,
          evidence: "medium" as const,
          metrics: [
            ["Clientes", "customers", "number"],
            ["Pedidos promedio", "averageOrders", "number"],
            ["Gasto promedio", "averageSpend", "currency"],
            ["Recencia promedio", "averageRecencyDays", "number"],
          ].flatMap(([metricLabel, key, format]) => {
            const value = asNumber(segment[key]);
            return value === undefined ? [] : [{ label: metricLabel, value, format: format as "number" | "currency", status: "observed" as const }];
          }),
        }];
      }).slice(0, 50),
    };
  }

  const cohorts = Array.isArray(result.cohorts) ? result.cohorts : [];
  return {
    ...block,
    methodology: typeof result.method === "string" ? result.method : block.methodology,
    items: cohorts.flatMap((raw) => {
      const cohort = asRecord(raw);
      if (!cohort) return [];
      const label = typeof cohort.cohort === "string" ? cohort.cohort : null;
      if (!label) return [];
      return [{
        label,
        segment: "cohort",
        evidence: "medium" as const,
        metrics: [
          ["Clientes", "customers"],
          ["Recompra 30 dias", "repeat30Rate"],
          ["Recompra 60 dias", "repeat60Rate"],
          ["Recompra 90 dias", "repeat90Rate"],
        ].flatMap(([metricLabel, key], index) => {
          const value = asNumber(cohort[key]);
          return value === undefined ? [] : [{ label: metricLabel, value, format: index === 0 ? ("number" as const) : ("percentage" as const), status: "observed" as const }];
        }),
      }];
    }).slice(0, 50),
  };
};

const reconcileDiagram = (
  block: AdminReportBlock,
  evidence: DecisionEvidenceEntry[],
): AdminReportBlock => {
  if (block.type !== "diagram") return block;
  if (block.diagramType === "funnel") {
    const entry = [...evidence].reverse().find(
      (candidate) => candidate.ok && candidate.tool === "get_conversion_funnel",
    );
    const result = asRecord(entry?.result);
    const stages: Array<Record<string, unknown> | null> =
      result && Array.isArray(result.stages)
        ? result.stages.map(asRecord).filter(Boolean)
        : [];
    if (stages.length >= 2) {
      const nodes = stages.flatMap((stage, index) => {
        const id = typeof stage?.stage === "string" ? stage.stage : `stage-${index}`;
        const label = typeof stage?.label === "string" ? stage.label : id;
        const value = asNumber(stage?.sessions);
        return value === undefined ? [] : [{ id, label, value, format: "number" as const, classification: "observed" as const }];
      });
      return {
        ...block,
        nodes,
        edges: nodes.slice(1).map((node, index) => {
          const stage = stages[index + 1];
          return {
            from: nodes[index].id,
            to: node.id,
            rate: asNumber(stage?.conversionFromPreviousRate),
          };
        }),
      };
    }
  }
  const entry = [...evidence].reverse().find(
    (candidate) => candidate.ok && candidate.tool === "decompose_metric_change",
  );
  const diagram = asRecord(asRecord(entry?.result)?.diagram);
  const nodes: unknown[] = diagram && Array.isArray(diagram.nodes) ? diagram.nodes : [];
  const edges: unknown[] = diagram && Array.isArray(diagram.edges) ? diagram.edges : [];
  return nodes.length >= 2
    ? { ...block, nodes: nodes as never, edges: edges as never }
    : { ...block, nodes: [], edges: [] };
};

export const reconcileDecisionBlocksAndSources = (
  report: AdminReport,
  evidence: DecisionEvidenceEntry[],
): AdminReport => {
  const successful = evidence
    .map((entry, originalIndex) => ({ entry, originalIndex }))
    .filter(({ entry }) => entry.ok && FRIENDLY_SOURCE_LABELS[entry.tool]);
  const sourceMetadata = successful.map(({ entry, originalIndex }) => {
    const result = asRecord(entry.result);
    const partial = hasTruncated(result);
    return {
      id: `source-${originalIndex + 1}`,
      label: FRIENDLY_SOURCE_LABELS[entry.tool],
      period: periodLabel(result),
      observedAt: entry.observedAt || new Date().toISOString(),
      freshness: partial ? ("partial" as const) : ("fresh" as const),
      coverage: partial ? ("partial" as const) : ("complete" as const),
    };
  });
  const idByEvidenceIndex = new Map(
    successful.map(({ originalIndex }, index) => [originalIndex, sourceMetadata[index].id]),
  );
  const blocks = report.blocks.map((original) => {
    const reconciled = reconcileDiagram(
      reconcileSegment(
        reconcileInsight(reconcileScenario(original, evidence), evidence),
        evidence,
      ),
      evidence,
    );
    const validExisting = (reconciled.sourceIds || []).filter((id) =>
      sourceMetadata.some((sourceItem) => sourceItem.id === id),
    );
    const automatic = selectedEvidenceIndexes(reconciled, evidence)
      .map((index) => idByEvidenceIndex.get(index))
      .filter((id): id is string => Boolean(id));
    const sourceIds = Array.from(new Set([...validExisting, ...automatic])).slice(0, 8);
    return { ...reconciled, ...(sourceIds.length > 0 ? { sourceIds } : {}) };
  });
  return {
    ...report,
    blocks,
    sourceMetadata: sourceMetadata.length > 0 ? sourceMetadata : undefined,
  };
};

export const __decisionEnrichTestables = { hasTruncated, periodLabel };
