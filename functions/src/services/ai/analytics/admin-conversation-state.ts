/** Estado pequeno y estructurado para referencias conversacionales. */

import { AdminReport } from "./admin-report.schema";

export interface AdminDecisionOptionState {
  index: number;
  name: string;
  description: string;
}

export interface AdminConversationState {
  version: 1;
  period?: string;
  filters?: { category?: string };
  selectedFinding?: { index: number; id?: string; title: string };
  findings?: Array<{ index: number; id?: string; title: string }>;
  selectedProducts?: string[];
  options?: AdminDecisionOptionState[];
  selectedOption?: AdminDecisionOptionState;
  scenario?: { title: string; optionIndex?: number };
  updatedAt: string;
}

const PERIOD_PATTERNS: Array<[RegExp, string]> = [
  [/\bhoy\b/i, "today"],
  [/\bayer\b/i, "yesterday"],
  [/esta semana/i, "this_week"],
  [/semana (pasada|anterior)/i, "last_week"],
  [/este mes/i, "this_month"],
  [/mes (pasado|anterior)/i, "last_month"],
  [/ultim(?:os|as) 7 dias/i, "last_7_days"],
  [/ultim(?:os|as) 30 dias/i, "last_30_days"],
  [/ultim(?:os|as) 90 dias/i, "last_90_days"],
];

const ORDINALS: Array<[RegExp, number]> = [
  [/\b(primer|primero|primera|1(?:a|o|er)?)\b/i, 0],
  [/\b(segund[oa]|2(?:a|o)?)\b/i, 1],
  [/\b(tercer|tercero|tercera|3(?:a|o|er)?)\b/i, 2],
  [/\b(cuart[oa]|4(?:a|o)?)\b/i, 3],
];

const ordinalIndex = (question: string): number | undefined =>
  ORDINALS.find(([pattern]) => pattern.test(question))?.[1];

const inferPeriod = (question: string): string | undefined =>
  PERIOD_PATTERNS.find(([pattern]) => pattern.test(question))?.[1];

const inferCategoryFilter = (question: string): string | undefined => {
  const match = question.match(/\bsolo\s+([\p{L}\d][\p{L}\d\s-]{1,40})/iu);
  return match?.[1]?.replace(/[?.!,;:].*$/, "").trim() || undefined;
};

export const normalizeAdminConversationState = (
  value: unknown,
): AdminConversationState | undefined => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const state = value as Partial<AdminConversationState>;
  if (state.version !== 1) return undefined;
  return {
    version: 1,
    ...(typeof state.period === "string" ? { period: state.period } : {}),
    ...(state.filters && typeof state.filters === "object"
      ? { filters: { ...state.filters } }
      : {}),
    ...(state.selectedFinding ? { selectedFinding: state.selectedFinding } : {}),
    ...(Array.isArray(state.findings) ? { findings: state.findings.slice(0, 7) } : {}),
    ...(Array.isArray(state.selectedProducts)
      ? { selectedProducts: state.selectedProducts.filter((item) => typeof item === "string").slice(0, 20) }
      : {}),
    ...(Array.isArray(state.options) ? { options: state.options.slice(0, 4) } : {}),
    ...(state.selectedOption ? { selectedOption: state.selectedOption } : {}),
    ...(state.scenario ? { scenario: state.scenario } : {}),
    updatedAt:
      typeof state.updatedAt === "string" ? state.updatedAt : new Date(0).toISOString(),
  };
};

export const evolveAdminConversationState = (input: {
  previous?: AdminConversationState;
  question: string;
  report: AdminReport;
  now?: Date;
}): AdminConversationState => {
  const previous = input.previous;
  const ordinal = ordinalIndex(input.question);
  const period = inferPeriod(input.question) ?? previous?.period;
  const category = inferCategoryFilter(input.question) ?? previous?.filters?.category;
  const findings = input.report.blocks
    .filter((block) => block.type === "insight")
    .slice(0, 7)
    .map((block, index) => ({
      index,
      ...(block.type === "insight" && block.findingId ? { id: block.findingId } : {}),
      title: block.title || `Hallazgo ${index + 1}`,
    }));
  const comparison = [...input.report.blocks]
    .reverse()
    .find((block) => block.type === "comparison");
  const options =
    comparison?.type === "comparison"
      ? comparison.options.map((option, index) => ({
          index,
          name: option.name,
          description: option.description,
        }))
      : previous?.options;
  const chosenOption =
    ordinal !== undefined && options?.[ordinal]
      ? options[ordinal]
      : previous?.selectedOption;
  const selectedFinding =
    ordinal !== undefined && (findings.length > 0 ? findings : previous?.findings || [])[ordinal]
      ? (findings.length > 0 ? findings : previous?.findings || [])[ordinal]
      : previous?.selectedFinding;
  const segment = [...input.report.blocks]
    .reverse()
    .find((block) => block.type === "segment" && block.segmentType === "product");
  const selectedProducts =
    segment?.type === "segment"
      ? segment.items.map((item) => item.label).slice(0, 20)
      : previous?.selectedProducts;
  const scenario = [...input.report.blocks]
    .reverse()
    .find((block) => block.type === "scenario");

  return {
    version: 1,
    ...(period ? { period } : {}),
    ...(category ? { filters: { category } } : {}),
    ...(findings.length > 0 ? { findings } : previous?.findings ? { findings: previous.findings } : {}),
    ...(selectedFinding ? { selectedFinding } : {}),
    ...(selectedProducts?.length ? { selectedProducts } : {}),
    ...(options?.length ? { options } : {}),
    ...(chosenOption ? { selectedOption: chosenOption } : {}),
    ...(scenario?.type === "scenario"
      ? { scenario: { title: scenario.title, ...(chosenOption ? { optionIndex: chosenOption.index } : {}) } }
      : previous?.scenario
        ? { scenario: previous.scenario }
        : {}),
    updatedAt: (input.now || new Date()).toISOString(),
  };
};

export const buildConversationStatePrompt = (
  state: AdminConversationState | undefined,
): string | undefined => {
  if (!state) return undefined;
  return [
    "CONTEXTO ESTRUCTURADO DE LA SESION (solo referencias, no sustituye datos vivos):",
    JSON.stringify(state),
    "Resuelve 'el primero', 'la segunda opcion', 'esos productos' y filtros con este estado.",
    "Si la respuesta requiere cifras actuales, vuelve a llamar las tools correspondientes.",
  ].join("\n");
};

export const __conversationStateTestables = {
  ordinalIndex,
  inferPeriod,
  inferCategoryFilter,
};
