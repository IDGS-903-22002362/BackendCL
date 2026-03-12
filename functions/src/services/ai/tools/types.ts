import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { FunctionDeclaration } from "@google/genai";
import { RolUsuario } from "../../../models/usuario.model";

export interface AiToolExecutionContext {
  userId: string;
  role: RolUsuario;
  requestId?: string;
  capabilities: string[];
}

export interface AiToolDefinition<TInput extends Record<string, unknown> = Record<string, unknown>, TOutput extends Record<string, unknown> = Record<string, unknown>> {
  name: string;
  description: string;
  schema: z.ZodType<TInput>;
  roles: RolUsuario[];
  capabilities?: string[];
  execute: (input: TInput, context: AiToolExecutionContext) => Promise<TOutput>;
}

export interface RuntimeAiToolDefinition {
  name: string;
  description: string;
  schema: z.ZodTypeAny;
  roles: RolUsuario[];
  capabilities?: string[];
  execute: (
    input: Record<string, unknown>,
    context: AiToolExecutionContext,
  ) => Promise<Record<string, unknown>>;
}

export const defineTool = <
  TInput extends Record<string, unknown>,
  TOutput extends Record<string, unknown>,
>(
  tool: AiToolDefinition<TInput, TOutput>,
): RuntimeAiToolDefinition => ({
  ...tool,
  execute: async (input, context) => tool.execute(tool.schema.parse(input), context),
});

export const buildFunctionDeclaration = (
  tool: RuntimeAiToolDefinition,
): FunctionDeclaration => ({
  name: tool.name,
  description: tool.description,
  parametersJsonSchema: zodToJsonSchema(tool.schema, tool.name),
});
