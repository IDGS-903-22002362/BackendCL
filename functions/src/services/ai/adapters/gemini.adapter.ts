import {
  Content,
  FunctionCall,
  FunctionCallingConfigMode,
  FunctionDeclaration,
  GenerateContentConfig,
  GenerateContentResponse,
  GoogleGenAI,
  ThinkingLevel,
} from "@google/genai";
import aiConfig, { assertAiConfig } from "../../../config/ai.config";
import {
  GEMINI_API_VERSION_WITH_THINKING,
  GeminiModelPurpose,
  GeminiThinkingLevelName,
} from "../../../config/gemini.models";
import logger from "../../../utils/logger";
import {
  AI_INVALID_CONFIGURATION_CODE,
  AI_MODEL_UNSUPPORTED_CODE,
  AiRuntimeError,
  RECOMMENDED_VERTEX_GEMINI_MODEL,
} from "../ai.error";

export interface GeminiGenerationInput {
  model?: string;
  purpose?: GeminiModelPurpose;
  thinkingLevel?: GeminiThinkingLevelName;
  prompt?: string;
  contents?: string | Content[];
  systemInstruction?: string;
  tools?: FunctionDeclaration[];
  allowedFunctionNames?: string[];
  responseMimeType?: string;
  responseJsonSchema?: unknown;
}

export interface GeminiGenerationResult {
  text: string;
  functionCalls: FunctionCall[];
  response: GenerateContentResponse;
  model: string;
  purpose: GeminiModelPurpose;
  thinkingLevel?: GeminiThinkingLevelName;
}

interface PreparedToolCallingConfig {
  tools?: Array<{ functionDeclarations: FunctionDeclaration[] }>;
  toolConfig?: {
    functionCallingConfig: {
      mode: FunctionCallingConfigMode;
      allowedFunctionNames?: string[];
    };
  };
  declaredToolNames: string[];
  droppedAllowedFunctionNames: string[];
}

const THINKING_LEVEL_MAP: Record<GeminiThinkingLevelName, ThinkingLevel> = {
  low: ThinkingLevel.LOW,
  medium: ThinkingLevel.MEDIUM,
  high: ThinkingLevel.HIGH,
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const resolveErrorStatus = (error: unknown): number | undefined => {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }

  const status = Reflect.get(error, "status");
  return typeof status === "number" ? status : undefined;
};

const resolveErrorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  if (typeof error === "object" && error !== null) {
    const message = Reflect.get(error, "message");
    if (typeof message === "string" && message.trim()) {
      return message;
    }

    try {
      return JSON.stringify(error);
    } catch {
      return "unknown gemini error";
    }
  }

  return String(error);
};

const isTimeoutError = (error: unknown): boolean => {
  if (error instanceof DOMException && error.name === "AbortError") {
    return true;
  }

  const message = error instanceof Error ? error.message : String(error);
  return /timeout|aborted|abort/i.test(message);
};

const isRetryableGeminiError = (error: unknown): boolean => {
  if (isTimeoutError(error)) {
    return true;
  }

  const status = resolveErrorStatus(error);
  return status === 408 || status === 429 || status === 500 || status === 503;
};

const isGemini3Model = (model: string): boolean =>
  /(^|\/)gemini-3(\.|-)/i.test(model);

const usesThinkingLevel = (model: string): boolean =>
  /gemini-3\.[67]/i.test(model);

class GeminiAdapter {
  private readonly baseLogger = logger.child({ component: "gemini-adapter" });
  private readonly clients = new Map<string, GoogleGenAI>();

  private resolvePurpose(
    input: GeminiGenerationInput,
    model: string,
  ): GeminiModelPurpose {
    if (input.purpose) {
      return input.purpose;
    }

    if (model === aiConfig.gemini.summaryModel) {
      return "summary";
    }

    if (model === aiConfig.gemini.imageModel) {
      return "image";
    }

    return "main";
  }

  private resolveThinkingLevel(
    purpose: GeminiModelPurpose,
    override?: GeminiThinkingLevelName,
  ): GeminiThinkingLevelName | undefined {
    if (override) {
      return override;
    }

    if (purpose === "fast") {
      return aiConfig.gemini.thinkingLevelFast;
    }

    if (purpose === "main") {
      return aiConfig.gemini.thinkingLevelMain;
    }

    return undefined;
  }

  private prepareToolCallingConfig(
    input: GeminiGenerationInput,
  ): PreparedToolCallingConfig {
    const declaredTools = (input.tools || []).filter(
      (tool): tool is FunctionDeclaration =>
        Boolean(tool?.name && tool.name.trim().length > 0),
    );
    const uniqueTools = Array.from(
      new Map(declaredTools.map((tool) => [tool.name!.trim(), tool])).values(),
    );
    const declaredToolNames = uniqueTools.map((tool) => tool.name!.trim());
    const declaredToolNameSet = new Set(declaredToolNames);

    const requestedAllowedFunctionNames = Array.from(
      new Set(
        (input.allowedFunctionNames || [])
          .map((name) => name.trim())
          .filter((name) => name.length > 0),
      ),
    );

    const matchedAllowedFunctionNames = requestedAllowedFunctionNames.filter(
      (name) => declaredToolNameSet.has(name),
    );
    const droppedAllowedFunctionNames = requestedAllowedFunctionNames.filter(
      (name) => !declaredToolNameSet.has(name),
    );

    if (declaredToolNames.length === 0) {
      return {
        tools: undefined,
        toolConfig: undefined,
        declaredToolNames,
        droppedAllowedFunctionNames,
      };
    }

    if (requestedAllowedFunctionNames.length === 0) {
      return {
        tools: [{ functionDeclarations: uniqueTools }],
        toolConfig: {
          functionCallingConfig: {
            mode: FunctionCallingConfigMode.AUTO,
          },
        },
        declaredToolNames,
        droppedAllowedFunctionNames,
      };
    }

    const effectiveAllowedFunctionNames =
      matchedAllowedFunctionNames.length > 0
        ? matchedAllowedFunctionNames
        : declaredToolNames;

    return {
      tools: [{ functionDeclarations: uniqueTools }],
      toolConfig: {
        functionCallingConfig: {
          mode: FunctionCallingConfigMode.ANY,
          allowedFunctionNames: effectiveAllowedFunctionNames,
        },
      },
      declaredToolNames,
      droppedAllowedFunctionNames,
    };
  }

  private mapProviderError(error: unknown, model: string): never {
    const status = resolveErrorStatus(error);
    const message = resolveErrorMessage(error);
    const unsupportedMethodError =
      status === 404 &&
      /unsupported methods|not[_ ]found|not found/i.test(message);
    const invalidFunctionCallingConfigError =
      status === 400 &&
      /allowedFunctionNames|allowed_function_names|function.?calling|FunctionCallingConfig|mode\s*"?ANY"?/i.test(
        message,
      );
    const invalidToolSchemaError =
      status === 400 &&
      /reference to undefined schema|undefined schema at top-level|invalid top-level schema|tool schema|parametersJsonSchema|function declaration|responseJsonSchema|schema validation/i.test(
        message,
      );

    if (isTimeoutError(error)) {
      throw new AiRuntimeError(
        "AI_TIMEOUT",
        `La solicitud a Gemini (${model}) excedio el tiempo de espera`,
        408,
        error,
      );
    }

    if (unsupportedMethodError) {
      throw new AiRuntimeError(
        AI_MODEL_UNSUPPORTED_CODE,
        `El modelo "${model}" no soporta generateContent con la configuracion actual (gemini-api). Configura GEMINI_MODEL_MAIN=${RECOMMENDED_VERTEX_GEMINI_MODEL}.`,
        502,
        error,
      );
    }

    if (invalidFunctionCallingConfigError) {
      throw new AiRuntimeError(
        AI_INVALID_CONFIGURATION_CODE,
        "La configuracion de function/tool calling para Gemini es invalida. Verifica mode ANY y allowedFunctionNames.",
        400,
        error,
      );
    }

    if (invalidToolSchemaError) {
      throw new AiRuntimeError(
        AI_INVALID_CONFIGURATION_CODE,
        "La configuracion de schema/tool calling para Gemini es invalida. Verifica parametersJsonSchema y evita referencias top-level no soportadas.",
        400,
        error,
      );
    }

    throw error instanceof Error ? error : new Error(message);
  }

  private getClient(apiVersion: string): GoogleGenAI {
    assertAiConfig();

    const cacheKey = `gemini-api:${apiVersion}`;
    const existing = this.clients.get(cacheKey);
    if (existing) {
      return existing;
    }

    const apiKey = aiConfig.gemini.apiKey;
    if (!apiKey) {
      throw new AiRuntimeError(
        AI_INVALID_CONFIGURATION_CODE,
        "GEMINI_API_KEY es requerido para Gemini Developer API",
        500,
      );
    }

    const client = new GoogleGenAI({
      apiKey,
      apiVersion,
    });

    this.clients.set(cacheKey, client);
    return client;
  }

  private resolveRequestClient(needsThinking: boolean): {
    client: GoogleGenAI;
    apiVersion: string;
  } {
    const apiVersion = needsThinking
      ? GEMINI_API_VERSION_WITH_THINKING
      : aiConfig.gemini.apiVersion || GEMINI_API_VERSION_WITH_THINKING;

    return {
      client: this.getClient(apiVersion),
      apiVersion,
    };
  }

  async generate(
    input: GeminiGenerationInput,
  ): Promise<GeminiGenerationResult> {
    const requestStartedAt = Date.now();
    const model = input.model || aiConfig.gemini.primaryModel;
    const purpose = this.resolvePurpose(input, model);
    const thinkingLevel = this.resolveThinkingLevel(
      purpose,
      input.thinkingLevel,
    );
    const needsThinking = Boolean(
      usesThinkingLevel(model) && thinkingLevel,
    );
    const requestClient = this.resolveRequestClient(needsThinking);
    const preparedToolConfig = this.prepareToolCallingConfig(input);
    const contents = input.contents ?? input.prompt;

    if (!contents) {
      throw new Error("Gemini generation requiere prompt o contents");
    }

    if (preparedToolConfig.droppedAllowedFunctionNames.length > 0) {
      this.baseLogger.warn("gemini_tool_config_sanitized", {
        model,
        purpose,
        droppedAllowedFunctionNames:
          preparedToolConfig.droppedAllowedFunctionNames,
        declaredToolNames: preparedToolConfig.declaredToolNames,
      });
    }

    const config: GenerateContentConfig = {
      systemInstruction: input.systemInstruction,
      maxOutputTokens: usesThinkingLevel(model) ? 8192 : 2048,
      responseMimeType: input.responseMimeType,
      responseJsonSchema: input.responseJsonSchema,
      tools: preparedToolConfig.tools,
      toolConfig: preparedToolConfig.toolConfig,
    };

    if (needsThinking && thinkingLevel) {
      config.thinkingConfig = {
        thinkingLevel: THINKING_LEVEL_MAP[thinkingLevel],
      };
    } else if (!isGemini3Model(model)) {
      config.temperature = aiConfig.gemini.temperature;
    }

    const maxAttempts = Math.max(1, aiConfig.gemini.maxRetries + 1);
    let response: GenerateContentResponse | undefined;
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        aiConfig.gemini.timeoutMs,
      );

      try {
        response = await requestClient.client.models.generateContent({
          model,
          contents,
          config: {
            ...config,
            abortSignal: controller.signal,
          },
        });
        lastError = undefined;
        break;
      } catch (error) {
        lastError = error;
        const retryable =
          attempt < maxAttempts && isRetryableGeminiError(error);

        this.baseLogger.error("gemini_generate_failed", {
          provider: "gemini-api",
          model,
          purpose,
          thinking: thinkingLevel,
          attempt,
          retryable,
          apiVersion: requestClient.apiVersion,
          errorMessage: resolveErrorMessage(error),
          functionCallingMode:
            preparedToolConfig.toolConfig?.functionCallingConfig.mode,
          declaredToolNames: preparedToolConfig.declaredToolNames,
          allowedFunctionNames:
            preparedToolConfig.toolConfig?.functionCallingConfig
              .allowedFunctionNames,
          status: resolveErrorStatus(error),
        });

        if (!retryable) {
          this.mapProviderError(error, model);
        }

        await sleep(400 * 2 ** (attempt - 1));
      } finally {
        clearTimeout(timeout);
      }
    }

    if (!response) {
      this.mapProviderError(lastError, model);
    }

    const latencyMs = Date.now() - requestStartedAt;
    const text = response.text || "";
    this.baseLogger.info("gemini_generate_completed", {
      provider: "gemini-api",
      model,
      purpose,
      thinking: thinkingLevel,
      apiVersion: requestClient.apiVersion,
      durationMs: latencyMs,
      success: Boolean(text.trim() || response.functionCalls?.length),
      functionCallCount: response.functionCalls?.length || 0,
    });

    return {
      text,
      functionCalls: response.functionCalls || [],
      response,
      model,
      purpose,
      thinkingLevel,
    };
  }

  async generateStructured<T>(input: GeminiGenerationInput): Promise<T> {
    const result = await this.generate({
      ...input,
      responseMimeType: "application/json",
    });

    return JSON.parse(result.text) as T;
  }
}

export const geminiAdapter = new GeminiAdapter();
export default geminiAdapter;
