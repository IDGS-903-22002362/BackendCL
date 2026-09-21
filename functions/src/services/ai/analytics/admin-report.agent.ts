/**
 * Orquestador del Asistente Administrativo.
 *
 * Flujo real:
 *   pregunta -> Gemini (function calling) -> tools read-only -> evidencia
 *   -> Gemini (structured output) -> informe con bloques -> UI
 *
 * Reutiliza el adaptador Gemini existente (`geminiAdapter`), la misma
 * credencial (`GEMINI_API_KEY`) y los modelos ya configurados en `aiConfig`.
 */

import { Content, Part } from "@google/genai";
import { ZodError } from "zod";
import aiConfig from "../../../config/ai.config";
import { RolUsuario } from "../../../models/usuario.model";
import logger from "../../../utils/logger";
import geminiAdapter from "../adapters/gemini.adapter";
import { AI_INTERNAL_ERROR_CODE, AiRuntimeError } from "../ai.error";
import {
  ForecastTraceEntry,
  reconcileForecastBlocks,
  summarizeAnalysisEvidence,
} from "./admin-report.enrich";
import { reconcileEvidenceCharts } from "./admin-report.chart-enrich";
import { reconcileDecisionBlocksAndSources } from "./admin-report.decision-enrich";
import {
  AdminConversationState,
  buildConversationStatePrompt,
} from "./admin-conversation-state";
import {
  AdminReport,
  adminReportBlockSchema,
  adminReportSchema,
  buildAdminReportJsonSchema,
  prepareAdminReportForReconciliation,
  sanitizeAdminReport,
} from "./admin-report.schema";
import {
  buildInvestigationInstructions,
  buildNoDataReportInstruction,
  buildReportInstructions,
} from "./admin-report.prompt";
import {
  ANALYTICS_TOOL_MAP,
  AnalyticsToolContext,
  buildAnalyticsFunctionDeclarations,
  createAnalyticsToolContext,
} from "./analytics.tools";
import { ANALYTICS_TIMEZONE, toAnalyticsDayKey } from "./period.util";

/** Tope duro de llamadas a herramientas por pregunta. */
export const MAX_TOOL_CALLS_PER_QUESTION = 12;
/** Tamano maximo de evidencia enviada al paso de redaccion. */
const MAX_EVIDENCE_CHARS = 60_000;
/** No se inician nuevas rondas cuando la investigacion supera este tiempo. */
export const MAX_INVESTIGATION_DURATION_MS = 50_000;
/** Una fuente lenta falla de forma aislada para que el informe pueda continuar. */
export const MAX_SINGLE_TOOL_DURATION_MS = 20_000;

const isCorrectableStructuredOutputError = (error: unknown): boolean =>
  error instanceof SyntaxError || error instanceof ZodError;

const toReportCompositionError = (error: unknown): AiRuntimeError =>
  error instanceof AiRuntimeError
    ? error
    : new AiRuntimeError(
        AI_INTERNAL_ERROR_CODE,
        "El asistente no pudo estructurar el informe. Intenta reformular la pregunta.",
        502,
        error,
      );

const TOOL_STATUS_LABELS: Record<string, string> = {
  get_sales_summary: "Analizando ventas...",
  compare_sales_periods: "Comparando periodos...",
  get_sales_by_product: "Revisando productos...",
  get_sales_by_category: "Revisando categorías...",
  get_inventory_health: "Revisando inventario...",
  get_orders_metrics: "Revisando pedidos...",
  get_promotions_performance: "Revisando promociones...",
  get_customer_metrics: "Revisando clientes...",
  get_traffic_summary: "Analizando tráfico...",
  get_conversion_funnel: "Revisando el embudo...",
  get_product_interest: "Midiendo interés por producto...",
  get_product_performance: "Cruzando visitas con ventas...",
  get_traffic_sources: "Revisando canales de tráfico...",
  analyze_metric_relationships: "Buscando relaciones entre métricas...",
  forecast_metric: "Calculando proyección...",
  detect_business_anomalies: "Buscando anomalías...",
  prioritize_business_findings: "Priorizando hallazgos...",
  decompose_metric_change: "Descomponiendo la variación...",
  simulate_business_scenario: "Comparando escenarios...",
  segment_products: "Clasificando productos...",
  get_customer_segments: "Analizando clientes de forma agregada...",
  analyze_customer_cohorts: "Revisando recompra por cohortes...",
  analyze_product_affinity: "Buscando productos comprados juntos...",
  get_business_brief: "Preparando lo más importante...",
};

export interface AdminAgentHistoryEntry {
  role: "user" | "assistant";
  content: string;
}

export interface RunAdminReportInput {
  question: string;
  userId: string;
  role: RolUsuario;
  requestId?: string;
  sessionId?: string;
  history?: AdminAgentHistoryEntry[];
  conversationState?: AdminConversationState;
  now?: Date;
}

export interface AdminToolCallTrace {
  toolName: string;
  arguments: Record<string, unknown>;
  durationMs: number;
  success: boolean;
  resultSize: number;
  periodLabel?: string;
  errorMessage?: string;
}

export interface AdminReportTrace {
  toolsUsed: string[];
  toolCalls: AdminToolCallTrace[];
  investigationRounds: number;
  reachedToolLimit: boolean;
  model: string;
  purpose: string;
  durationMs: number;
  totalAgentDuration: number;
  geminiDuration: number;
  toolDuration: number;
  numberOfToolCalls: number;
  slowestTools: Array<{ label: string; durationMs: number; success: boolean }>;
  sourceTimestamps: string[];
  timeZone: string;
  /** Pronosticos calculados en backend: metrica, metodo e historial usado. */
  forecasts?: ForecastTraceEntry[];
  anomaliesDetected?: number;
  blockTypes?: string[];
  suggestedQuestions?: number;
}

export interface AdminReportResult {
  report: AdminReport;
  trace: AdminReportTrace;
}

export type AdminAgentEvent =
  | { type: "status"; data: { status: string; step: number } }
  | { type: "final"; data: AdminReportResult };

const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value ?? null);
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));

  return `{${entries
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`)
    .join(",")}}`;
};

const toPlainArguments = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const extractPeriodLabel = (result: unknown): string | undefined => {
  if (typeof result !== "object" || result === null) {
    return undefined;
  }

  const record = result as Record<string, unknown>;
  const candidates = [record.period, record.currentPeriod, record.lookback];

  for (const candidate of candidates) {
    if (
      typeof candidate === "object" &&
      candidate !== null &&
      typeof (candidate as { label?: unknown }).label === "string"
    ) {
      return (candidate as { label: string }).label;
    }
  }

  return undefined;
};

interface EvidenceEntry {
  tool: string;
  arguments: Record<string, unknown>;
  ok: boolean;
  result?: unknown;
  error?: string;
  observedAt: string;
}

class AdminReportAgent {
  private readonly baseLogger = logger.child({
    component: "admin-report-agent",
  });

  /**
   * Ejecuta el agente emitiendo eventos de estado durante la investigacion.
   * El controller puede reenviarlos por SSE o simplemente consumir el `final`.
   */
  async *run(input: RunAdminReportInput): AsyncGenerator<AdminAgentEvent> {
    const startedAt = Date.now();
    const now = input.now || new Date();
    const maxToolSteps = Math.max(1, aiConfig.gemini.maxToolSteps);
    const promptContext = {
      nowLabel: new Intl.DateTimeFormat("es-MX", {
        timeZone: ANALYTICS_TIMEZONE,
        dateStyle: "full",
        timeStyle: "short",
      }).format(now),
      todayDayKey: toAnalyticsDayKey(now),
      maxToolSteps,
    };

    const toolContext = createAnalyticsToolContext({
      userId: input.userId,
      role: input.role,
      requestId: input.requestId,
      now,
    });

    const declarations = buildAnalyticsFunctionDeclarations();
    const contents: Content[] = this.buildInitialContents(input);
    const evidence: EvidenceEntry[] = [];
    const toolCalls: AdminToolCallTrace[] = [];
    const executedSignatures = new Set<string>();

    let investigationRounds = 0;
    let reachedToolLimit = false;
    let geminiDurationMs = 0;

    yield {
      type: "status",
      data: { status: "Interpretando la pregunta...", step: 0 },
    };

    for (let round = 1; round <= maxToolSteps; round += 1) {
      if (Date.now() - startedAt >= MAX_INVESTIGATION_DURATION_MS) {
        reachedToolLimit = true;
        break;
      }
      investigationRounds = round;

      const geminiStartedAt = Date.now();
      const generation = await geminiAdapter.generate({
        model: aiConfig.gemini.primaryModel,
        purpose: "main",
        systemInstruction: buildInvestigationInstructions(promptContext),
        contents,
        tools: declarations,
      });
      geminiDurationMs += Date.now() - geminiStartedAt;

      const functionCalls = generation.functionCalls || [];
      if (functionCalls.length === 0) {
        break;
      }

      const modelContent = generation.response.candidates?.[0]?.content;
      contents.push(
        modelContent && Array.isArray(modelContent.parts)
          ? modelContent
          : {
              role: "model",
              parts: functionCalls.map((call) => ({ functionCall: call })),
            },
      );

      const responseParts: Part[] = [];
      const remaining = Math.max(
        0,
        MAX_TOOL_CALLS_PER_QUESTION - toolCalls.length,
      );
      const selectedCalls = functionCalls.slice(0, remaining);
      const omittedCalls = functionCalls.slice(remaining);
      if (omittedCalls.length > 0) reachedToolLimit = true;

      // Gemini puede solicitar varias funciones independientes en una ronda.
      // Promise.all conserva el orden declarado; el cache request-local comparte
      // promesas y la firma evita duplicados aun dentro de este mismo lote.
      for (const call of selectedCalls) {
        yield {
          type: "status",
          data: {
            status:
              TOOL_STATUS_LABELS[call.name || ""] || "Consultando datos...",
            step: round,
          },
        };
      }
      const executions = await Promise.all(
        selectedCalls.map((call) =>
          this.executeToolCall(
            call.name,
            toPlainArguments(call.args),
            toolContext,
            executedSignatures,
          ),
        ),
      );

      for (let index = 0; index < selectedCalls.length; index += 1) {
        const call = selectedCalls[index];
        const execution = executions[index];
        toolCalls.push(execution.trace);
        if (execution.evidence) evidence.push(execution.evidence);
        responseParts.push({
          functionResponse: {
            name: call.name || "unknown_tool",
            response: execution.response,
          },
        });
      }

      for (const call of omittedCalls) {
        responseParts.push({
          functionResponse: {
            name: call.name || "unknown_tool",
            response: {
              ok: false,
              error:
                "Se alcanzo el limite de consultas para esta pregunta. Responde con la evidencia ya obtenida.",
            },
          },
        });
      }

      contents.push({ role: "user", parts: responseParts });

      if (reachedToolLimit) {
        break;
      }
    }

    yield {
      type: "status",
      data: { status: "Preparando informe...", step: investigationRounds + 1 },
    };

    const composition = await this.composeReport({
      question: input.question,
      history: input.history,
      evidence,
      promptContext,
    });
    const report = composition.report;
    geminiDurationMs += composition.geminiDurationMs;

    const durationMs = Date.now() - startedAt;
    const analysis = summarizeAnalysisEvidence(evidence);
    const blockTypes = Array.from(new Set(report.blocks.map((block) => block.type)));
    const trace: AdminReportTrace = {
      toolsUsed: Array.from(new Set(toolCalls.map((call) => call.toolName))),
      toolCalls,
      investigationRounds,
      reachedToolLimit,
      model: aiConfig.gemini.primaryModel,
      purpose: "main",
      durationMs,
      totalAgentDuration: durationMs,
      geminiDuration: geminiDurationMs,
      toolDuration: toolCalls.reduce((sum, call) => sum + call.durationMs, 0),
      numberOfToolCalls: toolCalls.length,
      slowestTools: [...toolCalls]
        .sort((a, b) => b.durationMs - a.durationMs)
        .slice(0, 3)
        .map((call) => ({
          label: TOOL_STATUS_LABELS[call.toolName]?.replace(/\.\.\.$/, "") || "Consulta de datos",
          durationMs: call.durationMs,
          success: call.success,
        })),
      sourceTimestamps: Array.from(
        new Set(evidence.filter((entry) => entry.ok).map((entry) => entry.observedAt)),
      ),
      timeZone: ANALYTICS_TIMEZONE,
      forecasts: analysis.forecasts.length > 0 ? analysis.forecasts : undefined,
      anomaliesDetected: analysis.anomaliesDetected,
      blockTypes,
      suggestedQuestions: report.suggestedQuestions?.length ?? 0,
    };

    this.baseLogger.info("admin_report_completed", {
      provider: aiConfig.gemini.provider,
      model: trace.model,
      purpose: trace.purpose,
      sessionId: input.sessionId,
      userId: input.userId,
      requestId: input.requestId,
      toolsUsed: trace.toolsUsed,
      toolCalls: toolCalls.length,
      investigationRounds,
      reachedToolLimit,
      durationMs,
      success: true,
      fallbackUsed: false,
      blocks: report.blocks.length,
      blockTypes,
      forecasts: analysis.forecasts,
      anomaliesDetected: analysis.anomaliesDetected,
      anomalySeverities: analysis.anomalySeverities,
      suggestedQuestions: trace.suggestedQuestions,
    });

    yield { type: "final", data: { report, trace } };
  }

  /** Version no incremental: util para tests y para respuestas JSON simples. */
  async execute(input: RunAdminReportInput): Promise<AdminReportResult> {
    let result: AdminReportResult | undefined;

    for await (const event of this.run(input)) {
      if (event.type === "final") {
        result = event.data;
      }
    }

    if (!result) {
      throw new AiRuntimeError(
        AI_INTERNAL_ERROR_CODE,
        "El asistente administrativo no pudo generar el informe",
        502,
      );
    }

    return result;
  }

  private buildInitialContents(input: RunAdminReportInput): Content[] {
    const history = (input.history || []).slice(-6);
    const contents: Content[] = history.map((entry) => ({
      role: entry.role === "assistant" ? "model" : "user",
      parts: [{ text: entry.content }],
    }));

    const statePrompt = buildConversationStatePrompt(input.conversationState);
    if (statePrompt) {
      contents.push({ role: "user", parts: [{ text: statePrompt }] });
    }
    contents.push({ role: "user", parts: [{ text: input.question }] });
    return contents;
  }

  private async executeToolCall(
    toolName: string | undefined,
    args: Record<string, unknown>,
    context: AnalyticsToolContext,
    executedSignatures: Set<string>,
  ): Promise<{
    trace: AdminToolCallTrace;
    response: Record<string, unknown>;
    evidence?: EvidenceEntry;
  }> {
    const startedAt = Date.now();
    const name = toolName || "";
    const tool = ANALYTICS_TOOL_MAP.get(name);

    if (!tool) {
      return {
        trace: {
          toolName: name || "unknown_tool",
          arguments: args,
          durationMs: 0,
          success: false,
          resultSize: 0,
          errorMessage: "Herramienta no disponible",
        },
        response: {
          ok: false,
          error: `La herramienta "${name}" no existe. Usa solo las herramientas declaradas.`,
        },
      };
    }

    const signature = `${name}:${stableStringify(args)}`;
    if (executedSignatures.has(signature)) {
      return {
        trace: {
          toolName: name,
          arguments: args,
          durationMs: 0,
          success: false,
          resultSize: 0,
          errorMessage: "Consulta duplicada omitida",
        },
        response: {
          ok: false,
          error:
            "Esta consulta ya se ejecuto con los mismos argumentos. Reutiliza el resultado anterior o cambia los parametros.",
        },
      };
    }

    executedSignatures.add(signature);

    try {
      const result = await Promise.race([
        tool.execute(args, context),
        new Promise<never>((_, reject) => {
          const timer = setTimeout(
            () => reject(new Error("La fuente excedio el tiempo maximo de consulta")),
            MAX_SINGLE_TOOL_DURATION_MS,
          );
          timer.unref?.();
        }),
      ]);
      const durationMs = Date.now() - startedAt;
      const serialized = JSON.stringify(result);
      const observedAt = new Date().toISOString();

      this.baseLogger.info("admin_report_tool_completed", {
        toolName: name,
        durationMs,
        success: true,
        resultSize: serialized.length,
        requestId: context.requestId,
      });

      return {
        trace: {
          toolName: name,
          arguments: args,
          durationMs,
          success: true,
          resultSize: serialized.length,
          periodLabel: extractPeriodLabel(result),
        },
        response: { ok: true, data: result },
        evidence: {
          tool: name,
          arguments: args,
          ok: true,
          result,
          observedAt,
        },
      };
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      const message =
        error instanceof Error ? error.message : "Error desconocido";

      this.baseLogger.error("admin_report_tool_failed", {
        toolName: name,
        durationMs,
        success: false,
        requestId: context.requestId,
        errorMessage: message,
      });

      return {
        trace: {
          toolName: name,
          arguments: args,
          durationMs,
          success: false,
          resultSize: 0,
          errorMessage: message,
        },
        response: {
          ok: false,
          error: `La consulta fallo: ${message}. Continua con la informacion disponible y advierte la limitacion.`,
        },
        evidence: {
          tool: name,
          arguments: args,
          ok: false,
          error: message,
          observedAt: new Date().toISOString(),
        },
      };
    }
  }

  private buildEvidencePrompt(input: {
    question: string;
    history?: AdminAgentHistoryEntry[];
    evidence: EvidenceEntry[];
  }): string {
    const payload = {
      question: input.question,
      previousTurns: (input.history || []).slice(-4),
      toolResults: input.evidence,
    };

    const serialized = JSON.stringify(payload, null, 2);
    if (serialized.length <= MAX_EVIDENCE_CHARS) {
      return serialized;
    }

    // Recorta resultados antiguos antes que la pregunta del usuario.
    const trimmed = {
      ...payload,
      toolResults: input.evidence.slice(-3),
      truncatedEvidence: true,
    };

    return JSON.stringify(trimmed, null, 2).slice(0, MAX_EVIDENCE_CHARS);
  }

  private async composeReport(input: {
    question: string;
    history?: AdminAgentHistoryEntry[];
    evidence: EvidenceEntry[];
    promptContext: {
      nowLabel: string;
      todayDayKey: string;
      maxToolSteps: number;
    };
  }): Promise<{ report: AdminReport; geminiDurationMs: number }> {
    const responseJsonSchema = buildAdminReportJsonSchema();
    const baseInstructions = buildReportInstructions(input.promptContext);
    const systemInstruction =
      input.evidence.length === 0
        ? `${baseInstructions}\n\n${buildNoDataReportInstruction()}`
        : baseInstructions;
    const prompt = this.buildEvidencePrompt(input);

    let geminiDurationMs = 0;
    const attempt = async (extraInstruction?: string): Promise<AdminReport> => {
      const generationStartedAt = Date.now();
      const raw = await geminiAdapter.generateStructured<unknown>({
        model: aiConfig.gemini.primaryModel,
        purpose: "main",
        systemInstruction: extraInstruction
          ? `${systemInstruction}\n\n${extraInstruction}`
          : systemInstruction,
        prompt,
        responseJsonSchema,
      });
      geminiDurationMs += Date.now() - generationStartedAt;

      // El schema enviado al proveedor es intencionalmente superficial. Antes
      // del parse estricto se eliminan placeholders calculados por el modelo y
      // se reponen solo desde tools deterministas del backend.
      const candidate = prepareAdminReportForReconciliation(raw);
      // Las cifras de pronostico se toman del servicio de forecasting, nunca
      // de lo que haya escrito el modelo.
      const reconciliation = reconcileForecastBlocks(candidate, input.evidence);

      if (reconciliation.reconciled > 0 || reconciliation.unsupported > 0) {
        this.baseLogger.info("admin_report_forecast_reconciled", {
          reconciled: reconciliation.reconciled,
          unsupported: reconciliation.unsupported,
        });
      }

      const decisionReconciled = reconcileDecisionBlocksAndSources(
        reconciliation.report,
        input.evidence,
      );
      const chartReconciliation = reconcileEvidenceCharts(
        decisionReconciled,
        input.question,
        input.evidence,
      );
      if (
        chartReconciliation.added > 0 ||
        chartReconciliation.reconciled > 0 ||
        chartReconciliation.discarded > 0
      ) {
        this.baseLogger.info("admin_report_charts_reconciled", {
          added: chartReconciliation.added,
          reconciled: chartReconciliation.reconciled,
          discarded: chartReconciliation.discarded,
        });
      }
      const reconciledBlocks = chartReconciliation.report.blocks.filter((block) => {
        if (
          block.type !== "forecast" &&
          block.type !== "scenario" &&
          block.type !== "diagram" &&
          block.type !== "segment"
        ) {
          return true;
        }
        return adminReportBlockSchema.safeParse(block).success;
      });
      const strictCandidate = {
        ...chartReconciliation.report,
        blocks:
          reconciledBlocks.length > 0
            ? reconciledBlocks
            : [
                {
                  type: "text" as const,
                  kind: "contexto" as const,
                  content:
                    "La evidencia disponible no permite presentar los bloques calculados solicitados.",
                },
              ],
      };
      const parsed = adminReportSchema.parse(strictCandidate);
      const sanitized = sanitizeAdminReport(parsed);

      if (sanitized.blocks.length !== reconciliation.report.blocks.length) {
        // Solo se registran tipos y nombres de campos, nunca los datos.
        this.baseLogger.warn("admin_report_blocks_discarded", {
          model: aiConfig.gemini.primaryModel,
          received: reconciliation.report.blocks.length,
          kept: sanitized.blocks.length,
          discarded: reconciliation.report.blocks
            .filter((block) => !sanitized.blocks.includes(block))
            .map(
              (block) =>
                `${block.type}:${Object.entries(block)
                  .filter(([, value]) => value !== undefined)
                  .map(([key]) => key)
                  .join("|")}`,
            ),
        });
      }

      return sanitized;
    };

    try {
      return { report: await attempt(), geminiDurationMs };
    } catch (error) {
      if (!isCorrectableStructuredOutputError(error)) {
        this.baseLogger.error("admin_report_failed", {
          provider: aiConfig.gemini.provider,
          model: aiConfig.gemini.primaryModel,
          success: false,
          errorMessage:
            error instanceof Error ? error.message : "Error desconocido",
        });
        throw toReportCompositionError(error);
      }

      this.baseLogger.warn("admin_report_schema_retry", {
        provider: aiConfig.gemini.provider,
        model: aiConfig.gemini.primaryModel,
        errorMessage:
          error instanceof Error ? error.message : "Error desconocido",
      });

      try {
        return {
          report: await attempt(
            "La respuesta anterior no cumplio el esquema JSON. Devuelve unicamente JSON valido segun el esquema, sin texto adicional.",
          ),
          geminiDurationMs,
        };
      } catch (retryError) {
        this.baseLogger.error("admin_report_failed", {
          provider: aiConfig.gemini.provider,
          model: aiConfig.gemini.primaryModel,
          success: false,
          errorMessage:
            retryError instanceof Error
              ? retryError.message
              : "Error desconocido",
        });

        throw toReportCompositionError(retryError);
      }
    }
  }
}

export const adminReportAgent = new AdminReportAgent();
export default adminReportAgent;

export const __agentTestables = {
  stableStringify,
  extractPeriodLabel,
  TOOL_STATUS_LABELS,
};
