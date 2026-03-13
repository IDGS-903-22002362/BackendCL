import {
  Content,
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

class GeminiAdapter {
  private readonly baseLogger = logger.child({ component: "gemini-adapter" });
  private client?: GoogleGenAI;

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
      /allowedFunctionNames|allowed_function_names|function.?calling|FunctionCallingConfig|mode\s*"?ANY"?/i.test(
        message,
      );
    const invalidToolSchemaError =
      status === 400 &&
      /reference to undefined schema|undefined schema at top-level|invalid top-level schema|tool schema|parametersJsonSchema|function declaration|responseJsonSchema|schema validation/i.test(
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
    const preparedToolConfig = this.prepareToolCallingConfig(input);
    const contents = input.contents ?? input.prompt;

    if (!contents) {
      throw new Error("Gemini generation requiere prompt o contents");
    }

    if (preparedToolConfig.droppedAllowedFunctionNames.length > 0) {
      this.baseLogger.warn("gemini_tool_config_sanitized", {
        model,
        droppedAllowedFunctionNames:
          preparedToolConfig.droppedAllowedFunctionNames,
        declaredToolNames: preparedToolConfig.declaredToolNames,
      });
    }

    let response: GenerateContentResponse;
    try {
      response = await client.models.generateContent({
        model,
        contents,
        config: {
          systemInstruction: input.systemInstruction,
          temperature: aiConfig.gemini.temperature,
          maxOutputTokens: 2048,
          responseMimeType: input.responseMimeType,
          responseJsonSchema: input.responseJsonSchema,
          tools: preparedToolConfig.tools,
          toolConfig: preparedToolConfig.toolConfig,
        },
      });
    } catch (error) {
      this.baseLogger.error("gemini_generate_failed", {
        model,
        mode: aiConfig.gemini.mode,
        message: error instanceof Error ? error.message : String(error),
        functionCallingMode:
          preparedToolConfig.toolConfig?.functionCallingConfig.mode,
        declaredToolNames: preparedToolConfig.declaredToolNames,
        allowedFunctionNames:
          preparedToolConfig.toolConfig?.functionCallingConfig
            .allowedFunctionNames,
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
