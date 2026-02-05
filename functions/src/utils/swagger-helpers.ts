import { zodToJsonSchema as zToJson } from "zod-to-json-schema";
import { z } from "zod";

/**
 * Convierte un schema Zod a JSON Schema (OpenAPI 3.0.3 compatible)
 * @param schema Schema de Zod a convertir
 * @param options Opciones adicionales de conversión
 * @returns JSON Schema compatible con OpenAPI
 */
export const zodToJsonSchema = (
  schema: z.ZodSchema,
  options?: {
    name?: string;
    $refStrategy?: "root" | "relative" | "none";
  },
) => {
  return zToJson(schema, {
    target: "openApi3",
    $refStrategy: options?.$refStrategy || "none",
    name: options?.name,
  });
};

/**
 * Genera un schema de respuesta exitosa estándar
 * @param dataSchema Schema opcional de los datos retornados
 * @param includeCount Si se debe incluir el campo count (para listas)
 * @returns JSON Schema de respuesta exitosa
 */
export const generateSuccessResponseSchema = (
  dataSchema?: object,
  includeCount = false,
) => {
  const properties: any = {
    success: {
      type: "boolean",
      example: true,
      description: "Indica si la operación fue exitosa",
    },
  };

  if (dataSchema) {
    properties.data = dataSchema;
  }

  if (includeCount) {
    properties.count = {
      type: "integer",
      description: "Número total de elementos",
      example: 10,
    };
  }

  return {
    type: "object",
    properties,
    required: ["success"],
  };
};

/**
 * Genera un schema de respuesta exitosa con lista de elementos
 * @param itemSchema Schema de cada elemento de la lista
 * @returns JSON Schema de respuesta con array de datos
 */
export const generateListResponseSchema = (itemSchema: object) => {
  return {
    type: "object",
    properties: {
      success: {
        type: "boolean",
        example: true,
      },
      count: {
        type: "integer",
        description: "Número de elementos en la lista",
        example: 5,
      },
      data: {
        type: "array",
        items: itemSchema,
      },
    },
    required: ["success", "count", "data"],
  };
};

/**
 * Genera un schema de respuesta de error estándar
 * @param includeValidationErrors Si se deben incluir detalles de errores de validación
 * @returns JSON Schema de respuesta de error
 */
export const generateErrorResponseSchema = (
  includeValidationErrors = false,
) => {
  const properties: any = {
    success: {
      type: "boolean",
      example: false,
      description: "Siempre false para errores",
    },
    message: {
      type: "string",
      description: "Mensaje de error legible",
      example: "Error al procesar la solicitud",
    },
  };

  if (includeValidationErrors) {
    properties.errors = {
      type: "array",
      description: "Lista de errores de validación",
      items: {
        type: "object",
        properties: {
          campo: {
            type: "string",
            example: "email",
          },
          mensaje: {
            type: "string",
            example: "El email no es válido",
          },
          codigo: {
            type: "string",
            example: "invalid_string",
          },
        },
      },
    };
  }

  return {
    type: "object",
    properties,
    required: ["success", "message"],
  };
};

/**
 * Genera un schema de respuesta con paginación (para uso futuro)
 * @param itemSchema Schema de cada elemento
 * @returns JSON Schema con soporte de paginación
 */
export const generatePaginatedResponseSchema = (itemSchema: object) => {
  return {
    type: "object",
    properties: {
      success: {
        type: "boolean",
        example: true,
      },
      data: {
        type: "array",
        items: itemSchema,
      },
      pagination: {
        type: "object",
        properties: {
          total: {
            type: "integer",
            description: "Total de elementos disponibles",
            example: 100,
          },
          page: {
            type: "integer",
            description: "Página actual",
            example: 1,
          },
          pageSize: {
            type: "integer",
            description: "Elementos por página",
            example: 10,
          },
          totalPages: {
            type: "integer",
            description: "Total de páginas",
            example: 10,
          },
          hasNextPage: {
            type: "boolean",
            description: "Si existe página siguiente",
            example: true,
          },
          hasPrevPage: {
            type: "boolean",
            description: "Si existe página anterior",
            example: false,
          },
        },
      },
    },
    required: ["success", "data", "pagination"],
  };
};

/**
 * Genera documentación de parámetro de ruta
 * @param name Nombre del parámetro
 * @param description Descripción del parámetro
 * @param schema Schema del parámetro (opcional, por defecto string)
 * @returns Objeto de parámetro OpenAPI
 */
export const pathParameter = (
  name: string,
  description: string,
  schema: object = { type: "string" },
) => {
  return {
    in: "path",
    name,
    required: true,
    description,
    schema,
  };
};

/**
 * Genera documentación de parámetro de query
 * @param name Nombre del parámetro
 * @param description Descripción del parámetro
 * @param required Si es requerido
 * @param schema Schema del parámetro
 * @returns Objeto de parámetro OpenAPI
 */
export const queryParameter = (
  name: string,
  description: string,
  required = false,
  schema: object = { type: "string" },
) => {
  return {
    in: "query",
    name,
    required,
    description,
    schema,
  };
};
