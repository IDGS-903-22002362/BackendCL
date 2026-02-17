import swaggerJsdoc from "swagger-jsdoc";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  createProductSchema,
  updateProductSchema,
  deleteImageSchema,
  updateProductStockSchema,
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
import {
  createOrdenSchema,
  updateOrdenSchema,
  updateEstadoOrdenSchema,
  listOrdenesQuerySchema,
  historialOrdenesQuerySchema,
} from "../middleware/validators/orden.validator";
import {
  addItemCarritoSchema,
  updateItemCarritoSchema,
  mergeCarritoSchema,
  checkoutCarritoSchema,
} from "../middleware/validators/carrito.validator";
import {
  iniciarPagoSchema,
  updateEstadoPagoSchema,
  refundPagoSchema,
} from "../middleware/validators/pago.validator";
import {
  listLowStockAlertsQuerySchema,
  registerInventoryAdjustmentSchema,
  registerInventoryMovementSchema,
  listInventoryMovementsQuerySchema,
} from "../middleware/validators/inventory.validator";

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
      name: "Orders",
      description: "Gestión de órdenes de compra",
    },
    {
      name: "Cart",
      description: "Carrito de compras (usuarios autenticados y anónimos)",
    },
    {
      name: "Payments",
      description:
        "Sistema de pagos con Stripe (PaymentIntent / Checkout Session)",
    },
    {
      name: "Inventory",
      description: "Gestión de movimientos de inventario y trazabilidad",
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
      UpdateProductStock: zodToJsonSchema(updateProductStockSchema),

      CreateCategory: zodToJsonSchema(createCategorySchema),
      UpdateCategory: zodToJsonSchema(updateCategorySchema),

      CreateLine: zodToJsonSchema(createLineSchema),
      UpdateLine: zodToJsonSchema(updateLineSchema),

      CreateProvider: zodToJsonSchema(createProviderSchema),
      UpdateProvider: zodToJsonSchema(updateProviderSchema),

      CreateSize: zodToJsonSchema(createSizeSchema),
      UpdateSize: zodToJsonSchema(updateSizeSchema),

      AddItemCarrito: zodToJsonSchema(addItemCarritoSchema),
      UpdateItemCarrito: zodToJsonSchema(updateItemCarritoSchema),
      MergeCarrito: zodToJsonSchema(mergeCarritoSchema),
      CheckoutCarrito: zodToJsonSchema(checkoutCarritoSchema),

      CreateOrden: zodToJsonSchema(createOrdenSchema),
      UpdateOrden: zodToJsonSchema(updateOrdenSchema),
      UpdateEstadoOrden: zodToJsonSchema(updateEstadoOrdenSchema),
      ListOrdenesQuery: zodToJsonSchema(listOrdenesQuerySchema),
      HistorialOrdenesQuery: zodToJsonSchema(historialOrdenesQuerySchema),

      IniciarPago: zodToJsonSchema(iniciarPagoSchema),
      UpdateEstadoPago: zodToJsonSchema(updateEstadoPagoSchema),
      RefundPago: zodToJsonSchema(refundPagoSchema),

      RegisterInventoryMovement: zodToJsonSchema(
        registerInventoryMovementSchema,
      ),
      RegisterInventoryAdjustment: zodToJsonSchema(
        registerInventoryAdjustmentSchema,
      ),
      ListInventoryMovementsQuery: zodToJsonSchema(
        listInventoryMovementsQuerySchema,
      ),
      ListLowStockAlertsQuery: zodToJsonSchema(listLowStockAlertsQuerySchema),

      // Modelos completos de entidades
      InventoryBySizeItem: {
        type: "object",
        properties: {
          tallaId: { type: "string", example: "m" },
          cantidad: { type: "integer", example: 8 },
        },
      },
      ProductStockBySize: {
        type: "object",
        properties: {
          productoId: { type: "string", example: "prod_12345" },
          existencias: { type: "integer", example: 18 },
          inventarioPorTalla: {
            type: "array",
            items: { $ref: "#/components/schemas/InventoryBySizeItem" },
          },
        },
      },
      ProductStockUpdateResult: {
        type: "object",
        properties: {
          productoId: { type: "string", example: "prod_12345" },
          tallaId: { type: "string", nullable: true, example: "m" },
          cantidadAnterior: { type: "integer", example: 8 },
          cantidadNueva: { type: "integer", example: 12 },
          diferencia: { type: "integer", example: 4 },
          existencias: { type: "integer", example: 30 },
          inventarioPorTalla: {
            type: "array",
            items: { $ref: "#/components/schemas/InventoryBySizeItem" },
          },
          stockMinimoGlobal: { type: "integer", example: 10 },
          stockMinimoPorTalla: {
            type: "array",
            items: {
              type: "object",
              properties: {
                tallaId: { type: "string", example: "m" },
                minimo: { type: "integer", example: 8 },
              },
            },
          },
          alertaStockBajo: {
            type: "object",
            properties: {
              activo: { type: "boolean", example: true },
              totalAlertas: { type: "integer", example: 2 },
              maxDeficit: { type: "integer", example: 6 },
            },
          },
          movimientoId: { type: "string", example: "mov_abc123" },
          createdAt: {
            type: "string",
            format: "date-time",
            example: "2026-02-16T15:00:00Z",
          },
        },
      },
      InventoryMovement: {
        type: "object",
        properties: {
          id: { type: "string", example: "mov_abc123" },
          tipo: {
            type: "string",
            enum: ["entrada", "salida", "ajuste", "venta", "devolucion"],
            example: "venta",
          },
          productoId: { type: "string", example: "prod_123" },
          tallaId: { type: "string", nullable: true, example: "m" },
          cantidadAnterior: { type: "integer", example: 10 },
          cantidadNueva: { type: "integer", example: 8 },
          diferencia: { type: "integer", example: -2 },
          motivo: {
            type: "string",
            example: "Venta asociada a creación de orden",
          },
          referencia: { type: "string", example: "orden_abc123" },
          ordenId: { type: "string", example: "orden_abc123" },
          usuarioId: { type: "string", example: "user_123" },
          createdAt: {
            type: "string",
            format: "date-time",
            example: "2026-02-16T15:00:00Z",
          },
        },
      },
      LowStockAlertBySize: {
        type: "object",
        properties: {
          tallaId: { type: "string", example: "m" },
          cantidadActual: { type: "integer", example: 2 },
          minimo: { type: "integer", example: 8 },
          deficit: { type: "integer", example: 6 },
        },
      },
      LowStockAlertProduct: {
        type: "object",
        properties: {
          productoId: { type: "string", example: "prod_123" },
          clave: { type: "string", example: "JER-001" },
          descripcion: { type: "string", example: "Jersey Oficial" },
          lineaId: { type: "string", example: "jersey" },
          categoriaId: { type: "string", example: "hombre" },
          existencias: { type: "integer", example: 4 },
          stockMinimoGlobal: { type: "integer", example: 10 },
          globalBajoStock: { type: "boolean", example: true },
          tallasBajoStock: {
            type: "array",
            items: { $ref: "#/components/schemas/LowStockAlertBySize" },
          },
          totalAlertas: { type: "integer", example: 3 },
          maxDeficit: { type: "integer", example: 7 },
        },
      },
      LowStockDashboard: {
        type: "object",
        properties: {
          resumen: {
            type: "object",
            properties: {
              totalProductosBajoStock: { type: "integer", example: 4 },
              totalAlertas: { type: "integer", example: 9 },
              alertasCriticas: { type: "integer", example: 2 },
              alertasModeradas: { type: "integer", example: 2 },
              fechaCorte: {
                type: "string",
                format: "date-time",
                example: "2026-02-16T15:00:00Z",
              },
            },
          },
          alertas: {
            type: "array",
            items: { $ref: "#/components/schemas/LowStockAlertProduct" },
          },
        },
      },
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
          inventarioPorTalla: {
            type: "array",
            items: { $ref: "#/components/schemas/InventoryBySizeItem" },
            example: [
              { tallaId: "s", cantidad: 5 },
              { tallaId: "m", cantidad: 8 },
              { tallaId: "l", cantidad: 5 },
            ],
          },
          stockMinimoGlobal: { type: "integer", example: 10 },
          stockMinimoPorTalla: {
            type: "array",
            items: {
              type: "object",
              properties: {
                tallaId: { type: "string", example: "m" },
                minimo: { type: "integer", example: 8 },
              },
            },
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
      Orden: {
        type: "object",
        properties: {
          id: { type: "string", example: "orden_12345" },
          usuarioId: { type: "string", example: "firebase_uid_xyz" },
          items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                productoId: { type: "string", example: "prod_001" },
                cantidad: { type: "integer", example: 2 },
                precioUnitario: { type: "number", example: 1299.99 },
                subtotal: { type: "number", example: 2599.98 },
                tallaId: { type: "string", example: "m" },
              },
            },
          },
          subtotal: { type: "number", example: 2599.98 },
          impuestos: { type: "number", example: 415.99 },
          total: { type: "number", example: 3015.97 },
          estado: {
            type: "string",
            enum: [
              "PENDIENTE",
              "CONFIRMADA",
              "EN_PROCESO",
              "ENVIADA",
              "ENTREGADA",
              "CANCELADA",
            ],
            example: "PENDIENTE",
          },
          direccionEnvio: {
            type: "object",
            properties: {
              nombre: { type: "string", example: "Juan Pérez" },
              telefono: { type: "string", example: "4771234567" },
              calle: { type: "string", example: "Blvd. Adolfo López Mateos" },
              numero: { type: "string", example: "2771" },
              numeroInterior: { type: "string", example: "A" },
              colonia: { type: "string", example: "Jardines del Moral" },
              ciudad: { type: "string", example: "León" },
              estado: { type: "string", example: "Guanajuato" },
              codigoPostal: { type: "string", example: "37160" },
              referencias: {
                type: "string",
                example: "Entre calle X y calle Y",
              },
            },
          },
          metodoPago: {
            type: "string",
            enum: [
              "TARJETA",
              "TRANSFERENCIA",
              "EFECTIVO",
              "PAYPAL",
              "MERCADOPAGO",
            ],
            example: "TARJETA",
          },
          transaccionId: { type: "string", example: "tx_abc123" },
          referenciaPago: { type: "string", example: "REF-2024-001" },
          numeroGuia: { type: "string", example: "FEDEX-123456789" },
          transportista: { type: "string", example: "FedEx" },
          costoEnvio: { type: "number", example: 150.0 },
          notas: { type: "string", example: "Entregar en horario laboral" },
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
      Pago: {
        type: "object",
        properties: {
          id: { type: "string", example: "pago_abc123" },
          ordenId: { type: "string", example: "orden_12345" },
          userId: { type: "string", example: "firebase_uid_xyz" },
          provider: {
            type: "string",
            enum: ["STRIPE"],
            example: "STRIPE",
            description: "Proveedor de pago",
          },
          metodoPago: {
            type: "string",
            enum: [
              "TARJETA",
              "TRANSFERENCIA",
              "EFECTIVO",
              "PAYPAL",
              "MERCADOPAGO",
            ],
            example: "TARJETA",
          },
          monto: {
            type: "number",
            example: 3015.97,
            description: "Monto total en la moneda especificada",
          },
          currency: {
            type: "string",
            example: "mxn",
            description: "Código de moneda ISO 4217",
          },
          estado: {
            type: "string",
            enum: [
              "PENDIENTE",
              "REQUIERE_ACCION",
              "PROCESANDO",
              "COMPLETADO",
              "FALLIDO",
              "REEMBOLSADO",
            ],
            example: "PENDIENTE",
          },
          providerStatus: {
            type: "string",
            example: "requires_payment_method",
            description: "Status crudo de Stripe",
          },
          paymentIntentId: {
            type: "string",
            example: "pi_3ABC123DEF456",
            description: "ID del PaymentIntent en Stripe",
          },
          checkoutSessionId: {
            type: "string",
            example: "cs_test_abc123",
            description: "ID del Checkout Session en Stripe",
          },
          transaccionId: {
            type: "string",
            example: "TXN-2024-00001",
            description: "Referencia interna legible",
          },
          idempotencyKey: {
            type: "string",
            example: "orden_12345_1_firebase_uid_xyz",
            description: "Clave para evitar cobros duplicados",
          },
          fechaPago: {
            type: "string",
            format: "date-time",
            example: "2024-01-15T10:30:00Z",
            description: "Fecha de confirmación del pago",
          },
          failureCode: {
            type: "string",
            example: "card_declined",
            description: "Código de error de Stripe",
          },
          failureMessage: {
            type: "string",
            example: "Tu tarjeta fue rechazada",
            description: "Mensaje descriptivo del fallo",
          },
          refundId: {
            type: "string",
            example: "re_3ABC123DEF456",
            description: "ID del reembolso en Stripe",
          },
          refundAmount: {
            type: "number",
            example: 3015.97,
            description: "Monto reembolsado",
          },
          refundReason: {
            type: "string",
            example: "Producto defectuoso",
            description: "Motivo del reembolso",
          },
          webhookEventIdsProcesados: {
            type: "array",
            items: { type: "string" },
            example: ["evt_1ABC123", "evt_2DEF456"],
            description: "IDs de eventos de Stripe procesados (deduplicación)",
          },
          metadata: {
            type: "object",
            example: { source: "web", campaign: "promo_verano" },
            description: "Datos adicionales",
          },
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
      Carrito: {
        type: "object",
        properties: {
          id: { type: "string", example: "cart_abc123" },
          usuarioId: {
            type: "string",
            example: "firebase_uid_xyz",
            description: "UID de Firebase Auth (solo usuarios autenticados)",
          },
          sessionId: {
            type: "string",
            example: "550e8400-e29b-41d4-a716-446655440000",
            description:
              "UUID de sesión anónima (solo usuarios no autenticados)",
          },
          items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                productoId: { type: "string", example: "prod_001" },
                cantidad: { type: "integer", example: 2 },
                precioUnitario: { type: "number", example: 1299.99 },
                tallaId: { type: "string", example: "m" },
              },
            },
          },
          subtotal: { type: "number", example: 2599.98 },
          total: { type: "number", example: 2599.98 },
          itemsDetallados: {
            type: "array",
            description:
              "Items con información populada de productos (solo en respuestas GET)",
            items: {
              type: "object",
              properties: {
                productoId: { type: "string", example: "prod_001" },
                cantidad: { type: "integer", example: 2 },
                precioUnitario: { type: "number", example: 1299.99 },
                tallaId: { type: "string", example: "m" },
                producto: {
                  type: "object",
                  properties: {
                    clave: { type: "string", example: "JER-001" },
                    descripcion: {
                      type: "string",
                      example: "Jersey Oficial Local 2024",
                    },
                    imagenes: {
                      type: "array",
                      items: { type: "string", format: "uri" },
                    },
                    existencias: { type: "integer", example: 50 },
                    precioPublico: { type: "number", example: 1299.99 },
                    activo: { type: "boolean", example: true },
                  },
                },
              },
            },
          },
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
