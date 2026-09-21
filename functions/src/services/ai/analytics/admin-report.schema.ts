/**
 * Contrato de respuesta estructurada del Asistente Administrativo.
 *
 * El modelo nunca devuelve HTML ni codigo de grafica: solo datos y
 * configuracion. El frontend decide como renderizar cada bloque.
 */

import { z } from "zod";

export const ADMIN_REPORT_BLOCK_TYPES = [
  "text",
  "kpis",
  "table",
  "chart",
  "recommendations",
  "warning",
  "forecast",
  "anomaly",
  "insight",
  "scenario",
  "comparison",
  "diagram",
  "segment",
] as const;

export const ADMIN_REPORT_CHART_TYPES = [
  "bar",
  "line",
  "pie",
  "scatter",
] as const;

export const ADMIN_REPORT_VALUE_FORMATS = [
  "currency",
  "number",
  "percentage",
  "text",
] as const;

const traceableShape = {
  sourceIds: z
    .array(z.string().min(1))
    .max(8)
    .optional()
    .describe("Referencias a sourceMetadata. El backend elimina referencias invalidas."),
};

const sourceMetadataSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1).describe("Nombre legible de la fuente, no nombre tecnico."),
  period: z.string().optional(),
  filters: z.array(z.string().min(1)).max(8).optional(),
  observedAt: z.string().min(1),
  freshness: z.enum(["fresh", "partial", "stale"]),
  coverage: z.enum(["complete", "partial"]),
  note: z.string().optional(),
});

const metricValueSchema = z.object({
  label: z.string().min(1),
  value: z.number(),
  format: z.enum(ADMIN_REPORT_VALUE_FORMATS).optional(),
  status: z.enum(["observed", "forecast", "simulated"]).optional(),
});

const kpiItemSchema = z.object({
  label: z.string().min(1).describe("Nombre corto del indicador."),
  value: z.number().describe("Valor numerico exacto tomado de una tool."),
  format: z.enum(["currency", "number", "percentage"]),
  change: z
    .number()
    .optional()
    .describe(
      "Variacion porcentual contra el periodo comparado. Omitir si no hubo comparacion real.",
    ),
  hint: z
    .string()
    .optional()
    .describe("Aclaracion breve, por ejemplo el periodo exacto medido."),
});

const tableColumnSchema = z.object({
  label: z.string().min(1),
  format: z.enum(ADMIN_REPORT_VALUE_FORMATS).optional(),
});

const tableRowSchema = z.object({
  cells: z
    .array(z.string())
    .describe(
      "Valores en el mismo orden que las columnas. Los numeros van sin formato (ej. 12345.5); el frontend los formatea.",
    ),
});

const chartPointSchema = z.object({
  x: z
    .string()
    .min(1)
    .describe(
      'Etiqueta del eje X (fecha, categoria o producto). En chartType="scatter" debe ser el valor numerico del eje X sin formato.',
    ),
  label: z
    .string()
    .optional()
    .describe(
      'Nombre legible del punto. Util en scatter para identificar el producto.',
    ),
  series: z.array(
    z.object({
      key: z.string().min(1),
      value: z.number(),
    }),
  ),
});

const recommendationSchema = z.object({
  action: z.string().min(1).describe("Accion concreta sugerida."),
  reason: z.string().min(1).describe("Por que se sugiere, con base en la evidencia."),
  evidence: z
    .string()
    .optional()
    .describe("Dato observado que respalda la recomendacion."),
  expectedImpact: z
    .string()
    .optional()
    .describe("Impacto esperado. No inventar cifras si no hay evidencia."),
  risk: z.string().optional(),
  priority: z.enum(["alta", "media", "baja"]),
});

/**
 * Cada tipo de bloque es una variante independiente con sus campos
 * obligatorios. Un objeto unico con todo opcional hacia que el modelo
 * repartiera los campos de un bloque entre varios elementos del arreglo.
 */
const textBlockSchema = z.object({
  ...traceableShape,
  type: z.enum(["text"]),
  title: z.string().optional(),
  kind: z
    .enum([
      "observacion",
      "inferencia",
      "recomendacion",
      "prediccion",
      "simulacion",
      "conclusion",
      "contexto",
    ])
    .describe("Distingue hechos observados, inferencias y contexto."),
  content: z.string().min(1).describe("Texto del bloque."),
});

const warningBlockSchema = z.object({
  ...traceableShape,
  type: z.enum(["warning"]),
  title: z.string().optional(),
  content: z
    .string()
    .min(1)
    .describe("Limitacion, dato faltante o metrica incompleta."),
});

const kpisBlockSchema = z.object({
  ...traceableShape,
  type: z.enum(["kpis"]),
  title: z.string().optional(),
  items: z.array(kpiItemSchema).min(1),
});

const tableBlockSchema = z.object({
  ...traceableShape,
  type: z.enum(["table"]),
  title: z.string().optional(),
  columns: z.array(tableColumnSchema).min(1),
  rows: z.array(tableRowSchema).min(1),
});

const chartBlockSchema = z.object({
  ...traceableShape,
  type: z.enum(["chart"]),
  title: z.string().optional(),
  chartType: z.enum(ADMIN_REPORT_CHART_TYPES),
  xLabel: z.string().optional(),
  seriesLabels: z
    .array(z.object({ key: z.string().min(1), label: z.string().min(1) }))
    .optional()
    .describe("Etiquetas legibles de cada serie del grafico."),
  data: z.array(chartPointSchema).min(1),
  valueFormat: z
    .enum(ADMIN_REPORT_VALUE_FORMATS)
    .optional()
    .describe("Formato de los valores del grafico."),
});

const recommendationsBlockSchema = z.object({
  ...traceableShape,
  type: z.enum(["recommendations"]),
  title: z.string().optional(),
  recommendations: z.array(recommendationSchema).min(1),
});

const forecastPointSchema = z.object({
  date: z.string().min(1).describe("Dia en formato YYYY-MM-DD."),
  value: z.number(),
  lower: z.number().optional(),
  upper: z.number().optional(),
});

/**
 * El bloque de pronostico solo declara QUE metrica se proyecto. Las series,
 * el metodo y el error los rellena el backend con la salida real de
 * `forecast_metric`, para que el modelo no pueda alterar las cifras.
 */
const forecastBlockSchema = z.object({
  ...traceableShape,
  type: z.enum(["forecast"]),
  title: z.string().optional(),
  metric: z
    .string()
    .min(1)
    .describe(
      'Metrica proyectada, igual que la devolvio forecast_metric: "revenue", "orders", "units", "visits", "sessions" o "product_views".',
    ),
  metricLabel: z.string().optional(),
  horizon: z.number().int().positive().optional(),
  valueFormat: z.enum(["currency", "number", "percentage"]).optional(),
  method: z.string().optional(),
  quality: z.enum(["alta", "media", "baja"]).optional(),
  historical: z.array(forecastPointSchema).optional(),
  forecast: z.array(forecastPointSchema).optional(),
  error: z
    .object({
      mae: z.number().optional(),
      rmse: z.number().optional(),
      mape: z.number().optional(),
    })
    .optional(),
  note: z
    .string()
    .optional()
    .describe("Lectura breve del pronostico. No prometas certeza."),
});

const anomalyBlockSchema = z.object({
  ...traceableShape,
  type: z.enum(["anomaly"]),
  title: z.string().optional(),
  severity: z.enum(["alta", "media", "baja"]),
  metric: z.string().min(1).describe("Metrica afectada."),
  metricLabel: z.string().optional(),
  reference: z
    .string()
    .optional()
    .describe("Dia o producto donde se observo el desvio."),
  observed: z.number().describe("Valor observado tal como lo devolvio la tool."),
  expected: z
    .string()
    .min(1)
    .describe("Rango o nivel esperado, citando la tool. Ej: 'entre 120 y 190'."),
  valueFormat: z.enum(["currency", "number", "percentage"]).optional(),
  explanation: z
    .string()
    .min(1)
    .describe("Que significa el desvio y que lo respalda."),
});

const insightBlockSchema = z.object({
  ...traceableShape,
  type: z.enum(["insight"]),
  findingId: z.string().optional(),
  title: z.string().min(1),
  summary: z.string().min(1),
  classification: z.enum([
    "observed",
    "inference",
    "recommendation",
    "prediction",
    "simulation",
  ]),
  priority: z.enum(["critical", "high", "medium", "low", "opportunity"]),
  evidence: z.enum(["high", "medium", "limited"]),
  metric: z.string().optional(),
  change: z.number().optional(),
  limitations: z.array(z.string().min(1)).max(6).optional(),
});

const scenarioBlockSchema = z.object({
  ...traceableShape,
  type: z.enum(["scenario"]),
  title: z.string().min(1),
  scenarioType: z.enum(["pessimistic", "base", "optimistic", "custom"]),
  status: z.enum(["simulated"]),
  baseline: z.array(metricValueSchema).min(1),
  result: z.array(metricValueSchema).min(1),
  assumptions: z.array(z.string().min(1)).min(1).max(10),
  limitations: z.array(z.string().min(1)).min(1).max(10),
});

const comparisonOptionSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  evidence: z.enum(["high", "medium", "limited"]),
  advantages: z.array(z.string().min(1)).max(6),
  risks: z.array(z.string().min(1)).max(6),
  expectedDirection: z.string().min(1),
  requirements: z.array(z.string().min(1)).max(6),
});

const comparisonBlockSchema = z.object({
  ...traceableShape,
  type: z.enum(["comparison"]),
  title: z.string().min(1),
  options: z.array(comparisonOptionSchema).min(2).max(4),
  recommendedOption: z.string().optional(),
  recommendationReason: z.string().optional(),
});

const diagramNodeSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  value: z.number().optional(),
  format: z.enum(ADMIN_REPORT_VALUE_FORMATS).optional(),
  classification: z.enum(["observed", "inference"]).optional(),
  evidence: z.enum(["high", "medium", "limited"]).optional(),
});

const diagramBlockSchema = z.object({
  ...traceableShape,
  type: z.enum(["diagram"]),
  diagramType: z.enum(["flow", "funnel", "cause-tree"]),
  title: z.string().min(1),
  nodes: z.array(diagramNodeSchema).min(2).max(20),
  edges: z
    .array(
      z.object({
        from: z.string().min(1),
        to: z.string().min(1),
        label: z.string().optional(),
        rate: z.number().optional(),
      }),
    )
    .max(30),
});

const segmentBlockSchema = z.object({
  ...traceableShape,
  type: z.enum(["segment"]),
  title: z.string().min(1),
  segmentType: z.enum(["product", "customer", "cohort"]),
  methodology: z.string().min(1),
  thresholds: z.array(z.string().min(1)).max(10).optional(),
  items: z
    .array(
      z.object({
        label: z.string().min(1),
        segment: z.string().min(1),
        score: z.number().optional(),
        evidence: z.enum(["high", "medium", "limited"]),
        metrics: z.array(metricValueSchema).max(10),
      }),
    )
    .min(1)
    .max(50),
});

export const adminReportBlockSchema = z.union([
  textBlockSchema,
  warningBlockSchema,
  kpisBlockSchema,
  tableBlockSchema,
  chartBlockSchema,
  recommendationsBlockSchema,
  forecastBlockSchema,
  anomalyBlockSchema,
  insightBlockSchema,
  scenarioBlockSchema,
  comparisonBlockSchema,
  diagramBlockSchema,
  segmentBlockSchema,
]);

export const adminReportSchema = z.object({
  summary: z
    .string()
    .min(1)
    .describe("Conclusion principal en una o dos frases, sin cifras inventadas."),
  confidence: z
    .enum(["alta", "media", "baja"])
    .describe("Confianza en la conclusion segun la evidencia disponible."),
  blocks: z.array(adminReportBlockSchema).min(1),
  sourceMetadata: z.array(sourceMetadataSchema).max(24).optional(),
  suggestedQuestions: z
    .array(z.string().min(3).max(140))
    .max(5)
    .optional()
    .describe(
      "Hasta 5 siguientes preguntas concretas que el usuario podria hacer, derivadas de lo que se acaba de analizar. Deben poder responderse con las herramientas disponibles.",
    ),
});

export type AdminReportKpiItem = z.infer<typeof kpiItemSchema>;
export type AdminReportBlock = z.infer<typeof adminReportBlockSchema>;
export type AdminReport = z.infer<typeof adminReportSchema>;

type ProviderJsonSchema = Record<string, unknown>;

const providerStringSchema: ProviderJsonSchema = { type: "string" };
const providerNumberSchema: ProviderJsonSchema = { type: "number" };
const providerStringArraySchema: ProviderJsonSchema = {
  type: "array",
  items: providerStringSchema,
};

const providerEnum = (values: readonly string[]): ProviderJsonSchema => ({
  type: "string",
  enum: [...values],
});

const providerArray = (items: ProviderJsonSchema): ProviderJsonSchema => ({
  type: "array",
  items,
});

const providerObject = (
  properties: Record<string, ProviderJsonSchema>,
  required: string[],
): ProviderJsonSchema => ({ type: "object", properties, required });

const providerBlock = (
  type: (typeof ADMIN_REPORT_BLOCK_TYPES)[number],
  properties: Record<string, ProviderJsonSchema>,
  required: string[],
): ProviderJsonSchema =>
  providerObject(
    {
      type: providerEnum([type]),
      title: providerStringSchema,
      sourceIds: providerStringArraySchema,
      ...properties,
    },
    ["type", ...required],
  );

const providerMetricItem = providerObject(
  {
    label: providerStringSchema,
    value: providerNumberSchema,
    format: providerEnum(["currency", "number", "percentage"]),
    change: providerNumberSchema,
    hint: providerStringSchema,
  },
  ["label", "value", "format"],
);

const providerBlockSchemas: ProviderJsonSchema[] = [
  providerBlock(
    "text",
    {
      kind: providerEnum([
        "observacion",
        "inferencia",
        "recomendacion",
        "prediccion",
        "simulacion",
        "conclusion",
        "contexto",
      ]),
      content: providerStringSchema,
    },
    ["kind", "content"],
  ),
  providerBlock("kpis", { items: providerArray(providerMetricItem) }, ["items"]),
  providerBlock(
    "table",
    {
      columns: providerArray(
        providerObject(
          {
            label: providerStringSchema,
            format: providerEnum(ADMIN_REPORT_VALUE_FORMATS),
          },
          ["label"],
        ),
      ),
      rows: providerArray(
        providerObject(
          { cells: providerStringArraySchema },
          ["cells"],
        ),
      ),
    },
    ["columns", "rows"],
  ),
  providerBlock(
    "chart",
    {
      chartType: providerEnum(ADMIN_REPORT_CHART_TYPES),
      xLabel: providerStringSchema,
      seriesLabels: providerArray(
        providerObject(
          { key: providerStringSchema, label: providerStringSchema },
          ["key", "label"],
        ),
      ),
      data: providerArray(
        providerObject(
          {
            x: providerStringSchema,
            label: providerStringSchema,
            series: providerArray(
              providerObject(
                { key: providerStringSchema, value: providerNumberSchema },
                ["key", "value"],
              ),
            ),
          },
          ["x", "series"],
        ),
      ),
      valueFormat: providerEnum(ADMIN_REPORT_VALUE_FORMATS),
    },
    ["chartType", "data"],
  ),
  providerBlock(
    "recommendations",
    {
      recommendations: providerArray(
        providerObject(
          {
            action: providerStringSchema,
            reason: providerStringSchema,
            evidence: providerStringSchema,
            expectedImpact: providerStringSchema,
            risk: providerStringSchema,
            priority: providerEnum(["alta", "media", "baja"]),
          },
          ["action", "reason", "priority"],
        ),
      ),
    },
    ["recommendations"],
  ),
  providerBlock("warning", { content: providerStringSchema }, ["content"]),
  // Forecast values come exclusively from forecast_metric during reconciliation.
  providerBlock(
    "forecast",
    { metric: providerStringSchema, note: providerStringSchema },
    ["metric"],
  ),
  providerBlock(
    "anomaly",
    {
      severity: providerEnum(["alta", "media", "baja"]),
      metric: providerStringSchema,
      metricLabel: providerStringSchema,
      reference: providerStringSchema,
      observed: providerNumberSchema,
      expected: providerStringSchema,
      valueFormat: providerEnum(["currency", "number", "percentage"]),
      explanation: providerStringSchema,
    },
    ["severity", "metric", "observed", "expected", "explanation"],
  ),
  providerBlock(
    "insight",
    {
      findingId: providerStringSchema,
      summary: providerStringSchema,
      classification: providerEnum([
        "observed",
        "inference",
        "recommendation",
        "prediction",
        "simulation",
      ]),
      priority: providerEnum([
        "critical",
        "high",
        "medium",
        "low",
        "opportunity",
      ]),
      evidence: providerEnum(["high", "medium", "limited"]),
      metric: providerStringSchema,
      change: providerNumberSchema,
      limitations: providerStringArraySchema,
    },
    ["title", "summary", "classification", "priority", "evidence"],
  ),
  // Scenario calculations and assumptions are restored from the allowlisted tool.
  providerBlock(
    "scenario",
    {
      scenarioType: providerEnum([
        "pessimistic",
        "base",
        "optimistic",
        "custom",
      ]),
      status: providerEnum(["simulated"]),
    },
    ["title", "scenarioType", "status"],
  ),
  providerBlock(
    "comparison",
    {
      options: providerArray(
        providerObject(
          {
            name: providerStringSchema,
            description: providerStringSchema,
            evidence: providerEnum(["high", "medium", "limited"]),
            advantages: providerStringArraySchema,
            risks: providerStringArraySchema,
            expectedDirection: providerStringSchema,
            requirements: providerStringArraySchema,
          },
          [
            "name",
            "description",
            "evidence",
            "advantages",
            "risks",
            "expectedDirection",
            "requirements",
          ],
        ),
      ),
      recommendedOption: providerStringSchema,
      recommendationReason: providerStringSchema,
    },
    ["title", "options"],
  ),
  // Nodes and edges are deterministic funnel/decomposition evidence.
  providerBlock(
    "diagram",
    { diagramType: providerEnum(["flow", "funnel", "cause-tree"]) },
    ["title", "diagramType"],
  ),
  // Segment items (and their nested metrics) are always restored from tools.
  providerBlock(
    "segment",
    { segmentType: providerEnum(["product", "customer", "cohort"]) },
    ["title", "segmentType"],
  ),
];

const providerReportEnvelopeSchema = z.object({
  summary: z.string(),
  confidence: z.enum(["alta", "media", "baja"]),
  blocks: z
    .array(
      z
        .object({ type: z.enum(ADMIN_REPORT_BLOCK_TYPES) })
        .passthrough(),
    )
    .min(1),
  suggestedQuestions: z.array(z.string()).optional(),
});

/**
 * JSON Schema listo para `responseJsonSchema` de Gemini.
 * Es deliberadamente mas superficial que el contrato final: Gemini solo
 * redacta campos narrativos y discriminadores. Valores calculados de
 * forecast/scenario/diagram/segment se reponen desde evidencia confiable
 * antes de ejecutar `adminReportSchema.parse`.
 */
export const buildAdminReportJsonSchema = (): Record<string, unknown> => {
  return providerObject(
    {
      summary: providerStringSchema,
      confidence: providerEnum(["alta", "media", "baja"]),
      blocks: providerArray({ anyOf: providerBlockSchemas }),
      suggestedQuestions: providerStringArraySchema,
    },
    ["summary", "confidence", "blocks"],
  );
};

/**
 * Valida solo el sobre y elimina valores calculados escritos por el modelo.
 * El tipo se usa de forma transitoria por los reconciliadores; el contrato
 * estricto se aplica despues de incorporar la evidencia de backend.
 */
export const prepareAdminReportForReconciliation = (
  raw: unknown,
): AdminReport => {
  const parsed = providerReportEnvelopeSchema.parse(raw);
  const blocks = parsed.blocks.map((rawBlock) => {
    const { sourceIds: providerSourceIds, ...providerFields } = rawBlock;
    const sourceIds = Array.isArray(providerSourceIds)
      ? providerSourceIds.filter((id): id is string => typeof id === "string")
      : undefined;
    const trace = sourceIds && sourceIds.length > 0 ? { sourceIds } : {};

    switch (rawBlock.type) {
      case "forecast":
        return {
          ...trace,
          type: "forecast" as const,
          title: rawBlock.title,
          metric: typeof rawBlock.metric === "string" ? rawBlock.metric : "",
          note: rawBlock.note,
          historical: [],
          forecast: [],
        };
      case "scenario":
        return {
          ...trace,
          type: "scenario" as const,
          title: rawBlock.title,
          scenarioType: rawBlock.scenarioType,
          status: "simulated" as const,
          baseline: [],
          result: [],
          assumptions: [],
          limitations: [],
        };
      case "diagram":
        return {
          ...trace,
          type: "diagram" as const,
          title: rawBlock.title,
          diagramType: rawBlock.diagramType,
          nodes: [],
          edges: [],
        };
      case "segment":
        return {
          ...trace,
          type: "segment" as const,
          title: rawBlock.title,
          segmentType: rawBlock.segmentType,
          methodology: "Calculado con evidencia agregada del backend.",
          items: [],
        };
      case "insight":
        return {
          ...providerFields,
          ...trace,
          limitations: Array.isArray(rawBlock.limitations)
            ? rawBlock.limitations.filter(
                (item): item is string => typeof item === "string",
              )
            : undefined,
        };
      default:
        return { ...providerFields, ...trace };
    }
  });

  return {
    summary: parsed.summary,
    confidence: parsed.confidence,
    blocks,
    suggestedQuestions: parsed.suggestedQuestions,
  } as AdminReport;
};

/**
 * Normaliza la respuesta del modelo antes de enviarla al frontend:
 * descarta bloques incompletos en vez de romper la vista.
 */
const normalizeSuggestions = (
  questions: string[] | undefined,
): string[] | undefined => {
  if (!questions || questions.length === 0) {
    return undefined;
  }

  const seen = new Set<string>();
  const unique: string[] = [];

  for (const question of questions) {
    const trimmed = question.trim();
    const key = trimmed.toLowerCase();

    if (trimmed.length < 3 || seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(trimmed);
  }

  return unique.length > 0 ? unique.slice(0, 5) : undefined;
};

export const sanitizeAdminReport = (report: AdminReport): AdminReport => {
  const blocks = report.blocks.filter((block) => {
    switch (block.type) {
      case "text":
      case "warning":
        return block.content.trim().length > 0;
      case "table":
        return block.rows.every(
          (row) => row.cells.length === block.columns.length,
        );
      case "chart":
        // Un scatter con un solo punto no comunica ninguna relacion.
        return block.chartType !== "scatter" || block.data.length >= 3;
      case "forecast":
        // Sin serie proyectada real el bloque no se puede graficar.
        return Array.isArray(block.forecast) && block.forecast.length > 0;
      case "diagram": {
        const ids = new Set(block.nodes.map((node) => node.id));
        return (
          block.nodes.length >= 2 &&
          block.edges.every((edge) => ids.has(edge.from) && ids.has(edge.to))
        );
      }
      case "scenario":
        return block.baseline.length > 0 && block.result.length > 0;
      case "comparison":
        return block.options.length >= 2;
      case "segment":
        return block.items.length > 0;
      default:
        return true;
    }
  });

  return {
    ...report,
    sourceMetadata: report.sourceMetadata?.filter(
      (entry, index, entries) =>
        entries.findIndex((candidate) => candidate.id === entry.id) === index,
    ),
    suggestedQuestions: normalizeSuggestions(report.suggestedQuestions),
    blocks:
      blocks.length > 0
        ? blocks
        : [
            {
              type: "text",
              title: "Sin contenido presentable",
              kind: "contexto",
              content:
                "El analisis no produjo bloques validos. Vuelve a intentar la consulta con un periodo distinto.",
            },
          ],
  };
};
