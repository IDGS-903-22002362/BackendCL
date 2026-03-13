import {
  FunctionCall,
  FunctionCallingConfigMode,
  FunctionDeclaration,
  GenerateContentResponse,
  GoogleGenAI,
} from "@google/genai";
import aiConfig, { assertAiConfig } from "../../../config/ai.config";
import logger from "../../../utils/logger";
import {
  AI_INVALID_CONFIGURATION_CODE,
  AI_MODEL_UNSUPPORTED_CODE,
  AiRuntimeError,
  RECOMMENDED_VERTEX_GEMINI_MODEL,
} from "../ai.error";

export interface GeminiGenerationInput {
  model?: string;
  prompt: string;
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
}

class GeminiAdapter {
  private readonly baseLogger = logger.child({ component: "gemini-adapter" });
  private client?: GoogleGenAI;

  private mapProviderError(error: unknown, model: string): never {
    const status =
      typeof error === "object" && error !== null
        ? Reflect.get(error, "status")
        : undefined;
    const message = error instanceof Error ? error.message : String(error);
    const unsupportedMethodError =
      status === 404 &&
      /unsupported methods|not[_ ]found|not found/i.test(message);
    const invalidFunctionCallingConfigError =
      status === 400 &&
      /INVALID_ARGUMENT|allowedFunctionNames|function.?calling|FunctionCallingConfig|mode\s*"?ANY"?/i.test(
        message,
      );

    if (unsupportedMethodError) {
      throw new AiRuntimeError(
        AI_MODEL_UNSUPPORTED_CODE,
        `El modelo "${model}" no soporta generateContent con la configuracion actual (${aiConfig.gemini.mode}). Configura GEMINI_MODEL_PRIMARY=${RECOMMENDED_VERTEX_GEMINI_MODEL}.`,
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

    throw error instanceof Error ? error : new Error(message);
  }

  private getClient(): GoogleGenAI {
    if (this.client) {
      return this.client;
    }

    assertAiConfig();

    this.client =
      aiConfig.gemini.mode === "vertexai"
        ? new GoogleGenAI({
            vertexai: true,
            project: aiConfig.gemini.project,
            location: aiConfig.gemini.region,
            apiVersion: "v1",
          })
        : new GoogleGenAI({
            apiKey: aiConfig.gemini.apiKey,
          });

    return this.client;
  }

  async generate(
    input: GeminiGenerationInput,
  ): Promise<GeminiGenerationResult> {
    const requestStartedAt = Date.now();
    const client = this.getClient();
    const model = input.model || aiConfig.gemini.primaryModel;
    const functionDeclarations =
      input.tools && input.tools.length > 0
        ? [{ functionDeclarations: input.tools }]
        : undefined;
    const hasFunctionDeclarations = Boolean(functionDeclarations);
    const hasAllowedFunctionNames = Boolean(
      input.allowedFunctionNames && input.allowedFunctionNames.length > 0,
    );

    let response: GenerateContentResponse;
    try {
      response = await client.models.generateContent({
        model,
        contents: input.prompt,
        config: {
          systemInstruction: input.systemInstruction,
          temperature: aiConfig.gemini.temperature,
          maxOutputTokens: 2048,
          responseMimeType: input.responseMimeType,
          responseJsonSchema: input.responseJsonSchema,
          tools: functionDeclarations,
          toolConfig: hasFunctionDeclarations
            ? {
                functionCallingConfig: {
                  mode: FunctionCallingConfigMode.ANY,
                  ...(hasAllowedFunctionNames
                    ? { allowedFunctionNames: input.allowedFunctionNames }
                    : {}),
                },
              }
            : undefined,
        },
      });
    } catch (error) {
      this.baseLogger.error("gemini_generate_failed", {
        model,
        mode: aiConfig.gemini.mode,
        message: error instanceof Error ? error.message : String(error),
        status:
          typeof error === "object" && error !== null
            ? Reflect.get(error, "status")
            : undefined,
      });
      this.mapProviderError(error, model);
    }

    const latencyMs = Date.now() - requestStartedAt;
    this.baseLogger.info("gemini_generate_completed", {
      model,
      latencyMs,
      functionCallCount: response.functionCalls?.length || 0,
    });

    return {
      text: response.text || "",
      functionCalls: response.functionCalls || [],
      response,
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
