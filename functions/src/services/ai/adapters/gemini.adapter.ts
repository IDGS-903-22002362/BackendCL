import {
  FunctionCall,
  FunctionCallingConfigMode,
  FunctionDeclaration,
  GenerateContentResponse,
  GoogleGenAI,
} from "@google/genai";
import aiConfig, { assertAiConfig } from "../../../config/ai.config";
import logger from "../../../utils/logger";

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

  private getClient(): GoogleGenAI {
    if (this.client) {
      return this.client;
    }

    assertAiConfig();

    this.client = aiConfig.gemini.mode === "vertexai"
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

  async generate(input: GeminiGenerationInput): Promise<GeminiGenerationResult> {
    const requestStartedAt = Date.now();
    const client = this.getClient();
    const functionDeclarations = input.tools && input.tools.length > 0
      ? [{ functionDeclarations: input.tools }]
      : undefined;

    const response = await client.models.generateContent({
      model: input.model || aiConfig.gemini.primaryModel,
      contents: input.prompt,
      config: {
        systemInstruction: input.systemInstruction,
        temperature: aiConfig.gemini.temperature,
        maxOutputTokens: 2048,
        responseMimeType: input.responseMimeType,
        responseJsonSchema: input.responseJsonSchema,
        tools: functionDeclarations,
        toolConfig:
          input.allowedFunctionNames && input.allowedFunctionNames.length > 0
            ? {
                functionCallingConfig: {
                  mode: FunctionCallingConfigMode.AUTO,
                  allowedFunctionNames: input.allowedFunctionNames,
                },
              }
            : undefined,
      },
    });

    const latencyMs = Date.now() - requestStartedAt;
    this.baseLogger.info("gemini_generate_completed", {
      model: input.model || aiConfig.gemini.primaryModel,
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
