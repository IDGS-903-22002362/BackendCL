export type GeminiExecutionMode = "apiKey" | "vertexai";

import {
  AI_CONFIG_ERROR_CODE,
  AiRuntimeError,
  RECOMMENDED_VERTEX_GEMINI_MODEL,
} from "../services/ai/ai.error";

interface AssertAiConfigOptions {
  requireGemini?: boolean;
  requireTryOn?: boolean;
  requirePreviewMockup?: boolean;
}

const toInt = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.floor(parsed) : fallback;
};

const toBool = (value: string | undefined, fallback = false): boolean => {
  if (value === undefined) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes";
};

const normalizeBaseUrl = (value: string | undefined): string | undefined => {
  if (!value) {
    return undefined;
  }

  return value.trim().replace(/\/+$/, "");
};

const resolveGeminiMode = (): GeminiExecutionMode => {
  const configuredMode = process.env.AI_GEMINI_MODE?.trim().toLowerCase();

  if (configuredMode === "vertexai") {
    return "vertexai";
  }

  if (
    configuredMode === "apikey" ||
    configuredMode === "apiKey".toLowerCase()
  ) {
    return "apiKey";
  }

  if (process.env.GOOGLE_GENAI_USE_VERTEXAI === "true") {
    return "vertexai";
  }

  return "apiKey";
};

const geminiMode: GeminiExecutionMode = resolveGeminiMode();

const LEGACY_UNSUPPORTED_VERTEX_MODELS = new Set([
  "gemini-2.5-pro-preview-05-06",
  "gemini-3.1-pro-preview",
]);

const VERTEX_UNSUPPORTED_MODEL_PATTERN =
  /(preview|experimental|exp|\d{2}-\d{2})/i;

const buildVertexModelConfigError = (model: string): AiRuntimeError =>
  new AiRuntimeError(
    AI_CONFIG_ERROR_CODE,
    `Configuracion AI invalida: el modelo "${model}" no es compatible con generateContent en modo vertexai. Ajusta AI_GEMINI_MODE=vertexai y GEMINI_MODEL_PRIMARY=${RECOMMENDED_VERTEX_GEMINI_MODEL}.`,
    500,
  );

const assertVertexCompatibleGeminiModel = (model: string): void => {
  const normalizedModel = model.trim();

  if (!normalizedModel) {
    throw buildVertexModelConfigError(model);
  }

  if (LEGACY_UNSUPPORTED_VERTEX_MODELS.has(normalizedModel)) {
    throw buildVertexModelConfigError(normalizedModel);
  }

  if (VERTEX_UNSUPPORTED_MODEL_PATTERN.test(normalizedModel)) {
    throw buildVertexModelConfigError(normalizedModel);
  }
};

export const aiConfig = {
  gemini: {
    mode: geminiMode,
    apiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY,
    primaryModel:
      process.env.GEMINI_MODEL_PRIMARY || RECOMMENDED_VERTEX_GEMINI_MODEL,
    fastModel: process.env.GEMINI_MODEL_FAST || "gemini-2.5-flash",
    summaryModel: process.env.GEMINI_MODEL_SUMMARY || "gemini-2.5-flash-lite",
    timeoutMs: toInt(process.env.AI_GEMINI_TIMEOUT_MS, 30000),
    maxToolSteps: toInt(process.env.AI_MAX_TOOL_STEPS, 6),
    maxContextMessages: toInt(process.env.AI_CONTEXT_MAX_MESSAGES, 12),
    maxSummaryChars: toInt(process.env.AI_SUMMARY_MAX_CHARS, 2500),
    temperature: Number(process.env.AI_GEMINI_TEMPERATURE ?? 0.2),
    project: process.env.GCP_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT,
    region:
      process.env.GCP_REGION ||
      process.env.GOOGLE_CLOUD_LOCATION ||
      "us-central1",
  },
  tryOn: {
    project: process.env.GCP_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT,
    region:
      process.env.GCP_REGION ||
      process.env.GOOGLE_CLOUD_LOCATION ||
      "us-central1",
    model: process.env.VERTEX_TRYON_MODEL || "virtual-try-on-001",
    endpointPublisher: process.env.VERTEX_TRYON_PUBLISHER || "google",
    timeoutMs: toInt(process.env.AI_TRYON_TIMEOUT_MS, 120000),
    pollIntervalMs: toInt(process.env.AI_TRYON_POLL_INTERVAL_MS, 4000),
  },
  previewMockup: {
    project: process.env.GCP_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT,
    region:
      process.env.GCP_REGION ||
      process.env.GOOGLE_CLOUD_LOCATION ||
      "us-central1",
    model:
      process.env.AI_PREVIEW_MOCKUP_MODEL ||
      process.env.VERTEX_IMAGE_MOCKUP_MODEL ||
      "imagen-product-recontext-preview-06-30",
    apiVersion: process.env.AI_PREVIEW_MOCKUP_API_VERSION,
    fallbackModel:
      process.env.AI_PREVIEW_MOCKUP_FALLBACK_MODEL ||
      "gemini-2.5-flash-image",
    fallbackRegion:
      process.env.AI_PREVIEW_MOCKUP_FALLBACK_REGION ||
      process.env.GCP_REGION ||
      process.env.GOOGLE_CLOUD_LOCATION ||
      "us-central1",
    fallbackApiVersion:
      process.env.AI_PREVIEW_MOCKUP_FALLBACK_API_VERSION || "v1",
    timeoutMs: toInt(process.env.AI_PREVIEW_MOCKUP_TIMEOUT_MS, 120000),
  },
  uploads: {
    maxBytes: toInt(process.env.AI_UPLOAD_MAX_MB, 10) * 1024 * 1024,
    maxFiles: toInt(process.env.AI_UPLOAD_MAX_FILES, 1),
    minWidth: toInt(process.env.AI_UPLOAD_MIN_WIDTH, 512),
    minHeight: toInt(process.env.AI_UPLOAD_MIN_HEIGHT, 512),
    maxPixels: toInt(process.env.AI_UPLOAD_MAX_PIXELS, 16_000_000),
    allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
  },
  storage: {
    bucket:
      process.env.AI_STORAGE_BUCKET ||
      process.env.GCS_TRYON_BUCKET ||
      process.env.STORAGE_BUCKET,
    uploadFolder: process.env.AI_STORAGE_UPLOAD_FOLDER || "ai/uploads",
    resultFolder: process.env.AI_STORAGE_RESULT_FOLDER || "ai/tryon-results",
    signedUrlTtlSec: toInt(process.env.AI_SIGNED_URL_TTL_SEC, 900),
    makePublic: toBool(process.env.AI_STORAGE_PUBLIC, false),
  },
  api: {
    rateLimitWindowMs: toInt(process.env.AI_RATE_LIMIT_WINDOW_MS, 60000),
    rateLimitMax: toInt(process.env.AI_RATE_LIMIT_MAX, 30),
    enableSse: toBool(process.env.AI_ENABLE_SSE, true),
  },
  storefront: {
    baseUrl: normalizeBaseUrl(process.env.STORE_PUBLIC_BASE_URL),
    productPathTemplate:
      process.env.STORE_PRODUCT_PATH_TEMPLATE || "/productos/:id",
  },
};

export const getAiRuntimeSummary = () => ({
  geminiMode: aiConfig.gemini.mode,
  geminiPrimaryModel: aiConfig.gemini.primaryModel,
  geminiProject: aiConfig.gemini.project,
  geminiRegion: aiConfig.gemini.region,
  hasGeminiApiKey: Boolean(aiConfig.gemini.apiKey),
  tryOnProject: aiConfig.tryOn.project,
  tryOnRegion: aiConfig.tryOn.region,
  tryOnModel: aiConfig.tryOn.model,
  previewMockupModel: aiConfig.previewMockup.model,
  previewMockupFallbackModel: aiConfig.previewMockup.fallbackModel,
  previewMockupFallbackRegion: aiConfig.previewMockup.fallbackRegion,
  storageBucket: aiConfig.storage.bucket,
});

export const assertAiConfig = (options: AssertAiConfigOptions = {}): void => {
  const requireGemini = options.requireGemini ?? true;

  if (requireGemini) {
    if (aiConfig.gemini.mode === "apiKey" && !aiConfig.gemini.apiKey) {
      throw new Error(
        "GEMINI_API_KEY es requerido cuando AI_GEMINI_MODE=apiKey",
      );
    }

    if (aiConfig.gemini.mode === "vertexai") {
      if (!aiConfig.gemini.project) {
        throw new Error(
          "GCP_PROJECT_ID es requerido cuando AI_GEMINI_MODE=vertexai",
        );
      }

      if (!aiConfig.gemini.region) {
        throw new Error(
          "GCP_REGION es requerido cuando AI_GEMINI_MODE=vertexai",
        );
      }

      assertVertexCompatibleGeminiModel(aiConfig.gemini.primaryModel);
    }
  }

  if (!aiConfig.storage.bucket) {
    throw new Error(
      "AI_STORAGE_BUCKET o GCS_TRYON_BUCKET es requerido para el modulo AI",
    );
  }

  if (options.requireTryOn) {
    if (!aiConfig.tryOn.project) {
      throw new Error("GCP_PROJECT_ID es requerido para Vertex Try-On");
    }

    if (!aiConfig.tryOn.region) {
      throw new Error("GCP_REGION es requerido para Vertex Try-On");
    }

    if (!aiConfig.tryOn.model) {
      throw new Error("VERTEX_TRYON_MODEL es requerido para Vertex Try-On");
    }
  }

  if (options.requirePreviewMockup) {
    if (!aiConfig.previewMockup.project) {
      throw new Error("GCP_PROJECT_ID es requerido para AI preview mockup");
    }

    if (!aiConfig.previewMockup.region) {
      throw new Error("GCP_REGION es requerido para AI preview mockup");
    }

    if (!aiConfig.previewMockup.model) {
      throw new Error(
        "AI_PREVIEW_MOCKUP_MODEL o VERTEX_IMAGE_MOCKUP_MODEL es requerido para AI preview mockup",
      );
    }
  }
};

export default aiConfig;
