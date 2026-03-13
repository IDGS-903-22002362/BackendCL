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

type JsonSchemaObject = Record<string, unknown>;

const isJsonSchemaObject = (value: unknown): value is JsonSchemaObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasEmptyObjectShape = (schema: JsonSchemaObject): boolean => {
  if (schema.type !== "object") {
    return false;
  }

  const properties = schema.properties;
  if (!isJsonSchemaObject(properties) || Object.keys(properties).length > 0) {
    return false;
  }

  const required = schema.required;
  return !Array.isArray(required) || required.length === 0;
};

export const buildToolParametersJsonSchema = (
  schema: z.ZodTypeAny,
): JsonSchemaObject | undefined => {
  const rawSchema = zodToJsonSchema(schema, {
    target: "jsonSchema7",
    $refStrategy: "none",
  });

  if (!isJsonSchemaObject(rawSchema)) {
    return undefined;
  }

  const sanitizedSchema: JsonSchemaObject = { ...rawSchema };
  delete sanitizedSchema.$schema;
  delete sanitizedSchema.$defs;
  delete sanitizedSchema.definitions;

  if (hasEmptyObjectShape(sanitizedSchema)) {
    return undefined;
  }

  return sanitizedSchema;
};

export const buildFunctionDeclaration = (
  tool: RuntimeAiToolDefinition,
): FunctionDeclaration => {
  const parametersJsonSchema = buildToolParametersJsonSchema(tool.schema);

  return {
    name: tool.name,
    description: tool.description,
    ...(parametersJsonSchema ? { parametersJsonSchema } : {}),
  };
};
