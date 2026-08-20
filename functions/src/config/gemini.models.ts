export const GEMINI_MODELS = {
  main: "gemini-3.7-flash",
  fast: "gemini-3.7-flash",
  summary: "gemini-3.5-flash-lite",
  image: "gemini-3.1-flash-image",
} as const;

/**
 * Modelos Gemini 2.5 conservados solo como rollback operacional explicito.
 * No deben usarse como default ni como fallback silencioso.
 */
export const GEMINI_MODELS_ROLLBACK = {
  main: "gemini-2.5-pro",
  fast: "gemini-2.5-flash",
  summary: "gemini-2.5-flash-lite",
  image: "gemini-2.5-flash-image",
} as const;

export type GeminiModelPurpose = "main" | "fast" | "summary" | "image";
export type GeminiThinkingLevelName = "low" | "medium" | "high";

export const GEMINI_THINKING_LEVELS = {
  main: "medium",
  fast: "low",
} as const satisfies Record<"main" | "fast", GeminiThinkingLevelName>;

export const GEMINI_API_VERSION = "v1";
export const GEMINI_API_VERSION_WITH_THINKING = "v1beta";
