/**
 * Contrato de respuesta estructurada del Asistente Administrativo.
 *
 * El modelo nunca devuelve HTML ni codigo de grafica: solo datos y
 * configuracion. El frontend decide como renderizar cada bloque.
 */

import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

export const ADMIN_REPORT_BLOCK_TYPES = [
  "text",
  "kpis",
  "table",
  "chart",
  "recommendations",
  "warning",
  "forecast",
  "anomaly",
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
  type: z.enum(["text"]),
  title: z.string().optional(),
  kind: z
    .enum(["observacion", "inferencia", "conclusion", "contexto"])
    .describe("Distingue hechos observados, inferencias y contexto."),
  content: z.string().min(1).describe("Texto del bloque."),
});

const warningBlockSchema = z.object({
  type: z.enum(["warning"]),
  title: z.string().optional(),
  content: z
    .string()
    .min(1)
    .describe("Limitacion, dato faltante o metrica incompleta."),
});

const kpisBlockSchema = z.object({
  type: z.enum(["kpis"]),
  title: z.string().optional(),
  items: z.array(kpiItemSchema).min(1),
});

const tableBlockSchema = z.object({
  type: z.enum(["table"]),
  title: z.string().optional(),
  columns: z.array(tableColumnSchema).min(1),
  rows: z.array(tableRowSchema).min(1),
});

const chartBlockSchema = z.object({
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

export const adminReportBlockSchema = z.union([
  textBlockSchema,
  warningBlockSchema,
  kpisBlockSchema,
  tableBlockSchema,
  chartBlockSchema,
  recommendationsBlockSchema,
  forecastBlockSchema,
  anomalyBlockSchema,
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

/**
 * JSON Schema listo para `responseJsonSchema` de Gemini.
 * Se eliminan `$schema`, `definitions` y `$defs` porque el API rechaza
 * referencias de nivel superior (misma convencion que chat-planner).
 */
export const buildAdminReportJsonSchema = (): Record<string, unknown> => {
  const schema = zodToJsonSchema(adminReportSchema, {
    target: "jsonSchema7",
    $refStrategy: "none",
  }) as Record<string, unknown>;

  delete schema.$schema;
  delete schema.definitions;
  delete schema.$defs;

  return schema;
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
      default:
        return true;
    }
  });

  return {
    ...report,
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
