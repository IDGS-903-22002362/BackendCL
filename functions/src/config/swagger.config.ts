import swaggerJsdoc from "swagger-jsdoc";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  createProductSchema,
  updateProductSchema,
  deleteImageSchema,
} from "../middleware/validators/product.validator";
import {
  createCategorySchema,
  updateCategorySchema,
} from "../middleware/validators/category.validator";
import {
  createLineSchema,
  updateLineSchema,
} from "../middleware/validators/line.validator";
import {
  createProviderSchema,
  updateProviderSchema,
} from "../middleware/validators/provider.validator";
import {
  createSizeSchema,
  updateSizeSchema,
} from "../middleware/validators/size.validator";

/**
 * Configuración de Swagger/OpenAPI 3.0.3
 * Genera documentación interactiva de la API con integración automática de schemas Zod
 */
const swaggerDefinition = {
  openapi: "3.0.3",
  info: {
    title: "Tienda Digital Club León - API",
    version: "1.0.0",
    description:
      "API REST para la tienda digital oficial del Club León. Gestión completa de catálogo de productos, usuarios, órdenes y más.",
    contact: {
      name: "Equipo de Desarrollo",
      email: "dev@clubleon.mx",
    },
    license: {
      name: "Propietario",
      url: "https://clubleon.mx",
    },
  },
  servers: [
    {
      url: "http://localhost:3000",
      description: "Servidor de desarrollo local",
    },
    {
      url: "{protocol}://{host}",
      description: "Servidor dinámico (producción/staging)",
      variables: {
        protocol: {
          default: "https",
          enum: ["http", "https"],
        },
        host: {
          default: "us-central1-e-comerce-leon.cloudfunctions.net/api",
          description: "Host de Firebase Functions",
        },
      },
    },
  ],
  tags: [
    {
      name: "Products",
      description: "Gestión de productos del catálogo",
    },
    {
      name: "Lines",
      description: "Gestión de líneas de productos",
    },
    {
      name: "Categories",
      description: "Gestión de categorías de productos",
    },
    {
      name: "Providers",
      description: "Gestión de proveedores",
    },
    {
      name: "Sizes",
      description: "Gestión de tallas",
    },
    {
      name: "Users",
      description: "Gestión de usuarios de la aplicación",
    },
    {
      name: "Authentication",
      description: "Autenticación y autorización de usuarios",
    },
    {
      name: "Debug",
      description:
        "Endpoints de diagnóstico (solo desarrollo) - DEPRECATED en producción",
    },
  ],
  components: {
    securitySchemes: {
      BearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
        description:
          "Token JWT de Firebase Auth. Obtener mediante login o autenticación social. Formato: 'Bearer {token}'",
      },
    },
    schemas: {
      // Schemas de respuesta estándar
      SuccessResponse: {
        type: "object",
        properties: {
          success: {
            type: "boolean",
            example: true,
            description: "Indica si la operación fue exitosa",
          },
          data: {
            type: "object",
            description: "Datos de la respuesta (variable según endpoint)",
          },
          count: {
            type: "integer",
            description: "Cantidad de elementos (solo en listas)",
            example: 10,
          },
          message: {
            type: "string",
            description: "Mensaje descriptivo de la operación",
            example: "Recurso creado exitosamente",
          },
        },
        required: ["success"],
      },
      ErrorResponse: {
        type: "object",
        properties: {
          success: {
            type: "boolean",
            example: false,
            description: "Siempre false para errores",
          },
          message: {
            type: "string",
            description: "Mensaje de error legible",
            example: "Recurso no encontrado",
          },
          error: {
            type: "string",
            description: "Detalles técnicos del error (solo en desarrollo)",
            example: "Firebase error: Document not found",
          },
        },
        required: ["success", "message"],
      },
      ValidationErrorResponse: {
        type: "object",
        properties: {
          success: {
            type: "boolean",
            example: false,
          },
          message: {
            type: "string",
            example: "Validación fallida",
          },
          errors: {
            type: "array",
            items: {
              type: "object",
              properties: {
                campo: {
                  type: "string",
                  example: "email",
                },
                mensaje: {
                  type: "string",
                  example: "El email debe ser válido",
                },
                codigo: {
                  type: "string",
                  example: "invalid_string",
                },
              },
            },
          },
        },
      },

      // Schemas de modelos de datos (generados desde Zod)
      CreateProduct: zodToJsonSchema(createProductSchema),
      UpdateProduct: zodToJsonSchema(updateProductSchema),
      DeleteImage: zodToJsonSchema(deleteImageSchema),

      CreateCategory: zodToJsonSchema(createCategorySchema),
      UpdateCategory: zodToJsonSchema(updateCategorySchema),

      CreateLine: zodToJsonSchema(createLineSchema),
      UpdateLine: zodToJsonSchema(updateLineSchema),

      CreateProvider: zodToJsonSchema(createProviderSchema),
      UpdateProvider: zodToJsonSchema(updateProviderSchema),

      CreateSize: zodToJsonSchema(createSizeSchema),
      UpdateSize: zodToJsonSchema(updateSizeSchema),

      // Modelos completos de entidades
      Product: {
        type: "object",
        properties: {
          id: { type: "string", example: "prod_12345" },
          clave: {
            type: "string",
            example: "JER-001",
            description: "SKU/Código único del producto",
          },
          descripcion: {
            type: "string",
            example: "Jersey Oficial Local 2024",
          },
          lineaId: { type: "string", example: "jersey" },
          categoriaId: { type: "string", example: "jersey_hombre" },
          precioPublico: { type: "number", example: 1299.99 },
          precioCompra: { type: "number", example: 650.0 },
          existencias: { type: "integer", example: 50 },
          proveedorId: { type: "string", example: "proveedor_01" },
          tallaIds: {
            type: "array",
            items: { type: "string" },
            example: ["s", "m", "l", "xl"],
          },
          imagenes: {
            type: "array",
            items: { type: "string", format: "uri" },
            example: ["https://storage.googleapis.com/.../jersey-001.jpg"],
          },
          activo: { type: "boolean", example: true },
          createdAt: {
            type: "string",
            format: "date-time",
            example: "2024-01-15T10:30:00Z",
          },
          updatedAt: {
            type: "string",
            format: "date-time",
            example: "2024-01-20T14:20:00Z",
          },
        },
      },
      Line: {
        type: "object",
        properties: {
          id: { type: "string", example: "jersey" },
          codigo: { type: "integer", example: 1 },
          nombre: { type: "string", example: "Jersey Oficial" },
          activo: { type: "boolean", example: true },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
        },
      },
      Category: {
        type: "object",
        properties: {
          id: { type: "string", example: "jersey_hombre" },
          nombre: { type: "string", example: "Jersey Hombre" },
          lineaId: { type: "string", example: "jersey" },
          orden: { type: "integer", example: 1 },
        },
      },
      Provider: {
        type: "object",
        properties: {
          id: { type: "string", example: "prov_001" },
          nombre: { type: "string", example: "Proveedor XYZ" },
          contacto: { type: "string", example: "Juan Pérez" },
          telefono: { type: "string", example: "4771234567" },
          email: { type: "string", example: "contacto@proveedor.com" },
          direccion: { type: "string", example: "Calle Principal 123" },
          activo: { type: "boolean", example: true },
          notas: { type: "string" },
        },
      },
      Size: {
        type: "object",
        properties: {
          id: { type: "string", example: "m" },
          codigo: { type: "string", example: "M" },
          descripcion: { type: "string", example: "Mediano" },
          orden: { type: "integer", example: 2 },
        },
      },
      User: {
        type: "object",
        properties: {
          id: { type: "string", example: "user_12345" },
          uid: { type: "string", example: "firebase_uid_xyz" },
          provider: {
            type: "string",
            enum: ["google", "apple", "email"],
            example: "google",
          },
          nombre: { type: "string", example: "Juan Pérez" },
          email: { type: "string", example: "juan@example.com" },
          telefono: { type: "string", example: "4771234567" },
          puntosActuales: { type: "integer", example: 150 },
          nivel: { type: "string", example: "Oro" },
          fechaNacimiento: { type: "string", format: "date" },
          perfilCompleto: { type: "boolean", example: true },
          activo: { type: "boolean", example: true },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
        },
      },
    },
    responses: {
      "200Success": {
        description: "Operación exitosa",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/SuccessResponse" },
          },
        },
      },
      "201Created": {
        description: "Recurso creado exitosamente",
        content: {
          "application/json": {
            schema: {
              allOf: [
                { $ref: "#/components/schemas/SuccessResponse" },
                {
                  properties: {
                    message: {
                      type: "string",
                      example: "Recurso creado exitosamente",
                    },
                  },
                },
              ],
            },
          },
        },
      },
      "400BadRequest": {
        description: "Petición inválida - Error de validación o duplicados",
        content: {
          "application/json": {
            schema: {
              $ref: "#/components/schemas/ValidationErrorResponse",
            },
          },
        },
      },
      "401Unauthorized": {
        description: "No autorizado - Token inválido o ausente",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ErrorResponse" },
            example: {
              success: false,
              message: "No autorizado",
            },
          },
        },
      },
      "403Forbidden": {
        description: "Prohibido - Usuario sin permisos suficientes",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ErrorResponse" },
            example: {
              success: false,
              message: "No tienes permisos para esta operación",
            },
          },
        },
      },
      "404NotFound": {
        description: "Recurso no encontrado",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ErrorResponse" },
            example: {
              success: false,
              message: 'Recurso con ID "xyz" no encontrado',
            },
          },
        },
      },
      "500ServerError": {
        description: "Error interno del servidor",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ErrorResponse" },
            example: {
              success: false,
              message: "Error al procesar la solicitud",
              error: "Detalles técnicos (solo en desarrollo)",
            },
          },
        },
      },
    },
  },
};

const swaggerOptions: swaggerJsdoc.Options = {
  definition: swaggerDefinition,
  // Escanear archivos de rutas para extraer anotaciones JSDoc
  apis: [
    "./src/routes/*.routes.ts", // Para desarrollo local
    "./lib/routes/*.routes.js", // Para producción (archivos compilados)
  ],
};

/**
 * Genera el spec de OpenAPI completo
 * @returns Objeto con la especificación completa de OpenAPI
 */
export const getSwaggerSpec = (): object => {
  return swaggerJsdoc(swaggerOptions);
};

export default swaggerDefinition;
