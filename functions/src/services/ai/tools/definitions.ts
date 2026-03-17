import { z } from "zod";
import { RolUsuario } from "../../../models/usuario.model";
import { RuntimeAiToolDefinition, defineTool } from "./types";
import storeAiBusinessService from "../knowledge/store-business.service";
import tryOnWorkflowService from "../jobs/tryon-workflow.service";

const searchFiltersSchema = z
  .object({
    normalizedQuery: z.string().trim().min(1).optional(),
    categoryIds: z.array(z.string().trim().min(1)).max(6).optional(),
    lineIds: z.array(z.string().trim().min(1)).max(6).optional(),
    colors: z.array(z.string().trim().min(1)).max(6).optional(),
    sizeIds: z.array(z.string().trim().min(1)).max(6).optional(),
    audience: z.array(z.string().trim().min(1)).max(6).optional(),
    pricePreference: z.enum(["lowest", "premium", "standard"]).optional(),
    availability: z.enum(["in_stock", "all"]).optional(),
  })
  .strict();

const searchProductsInput = z
  .object({
    query: z.string().trim().min(1).max(160),
    filters: searchFiltersSchema.optional(),
  })
  .strict();
const productIdInput = z.object({ productId: z.string().trim().min(1) }).strict();
const stockInput = z
  .object({
    productId: z.string().trim().min(1),
    sizeId: z.string().trim().min(1).optional(),
  })
  .strict();
const relatedProductsInput = z
  .object({
    productId: z.string().trim().min(1).optional(),
    query: z.string().trim().min(1).max(160).optional(),
  })
  .strict()
  .refine((value) => Boolean(value.productId || value.query), {
    message: "Se requiere productId o query",
  });
const searchFaqInput = z.object({ query: z.string().trim().min(1).max(160) }).strict();
const getFaqAnswerInput = z.object({ topic: z.string().trim().min(1).max(120) }).strict();
const addToCartInput = z.object({ productId: z.string().trim().min(1), quantity: z.number().int().positive().max(10), sizeId: z.string().trim().min(1).optional() }).strict();
const removeFromCartInput = z.object({ productId: z.string().trim().min(1), sizeId: z.string().trim().min(1).optional() }).strict();
const createTryOnJobInput = z.object({ sessionId: z.string().trim().min(1), productId: z.string().trim().min(1), variantId: z.string().trim().min(1).optional(), sku: z.string().trim().min(1).optional(), userImageAssetId: z.string().trim().min(1), consentAccepted: z.literal(true) }).strict();
const getTryOnStatusInput = z.object({ jobId: z.string().trim().min(1) }).strict();
const getTryOnLinkInput = z.object({ jobId: z.string().trim().min(1) }).strict();
const promotionsInput = z.object({ activeOnly: z.boolean().default(true).optional() }).strict();
const orderStatusInput = z
  .object({
    orderId: z.string().trim().min(1),
    phone: z.string().trim().min(8).max(30).optional(),
  })
  .strict();
const handoffInput = z.object({ reason: z.string().trim().min(1).max(200) }).strict();
const adminUpdateStockInput = z.object({ productId: z.string().trim().min(1), cantidadNueva: z.number().int().nonnegative(), tallaId: z.string().trim().min(1).optional(), motivo: z.string().trim().min(1).max(250).optional(), referencia: z.string().trim().min(1).max(120).optional() }).strict();
const adminUpdatePriceInput = z.object({ productId: z.string().trim().min(1), precioPublico: z.number().nonnegative() }).strict();

const customerRoles = [RolUsuario.CLIENTE, RolUsuario.EMPLEADO, RolUsuario.ADMIN];

const tools: RuntimeAiToolDefinition[] = [
  defineTool({
    name: "search_products",
    description: "Busca productos reales del catalogo por texto libre y filtros semanticos.",
    schema: searchProductsInput,
    roles: customerRoles,
    public: true,
    execute: async (input) => ({
      products: await storeAiBusinessService.searchProducts(input.query, input.filters),
    }),
  }),
  defineTool({
    name: "get_product_detail",
    description: "Obtiene detalle completo de un producto real.",
    schema: productIdInput,
    roles: customerRoles,
    public: true,
    execute: async (input) => ({ product: await storeAiBusinessService.getProductDetail(input.productId) }),
  }),
  defineTool({
    name: "get_product_price",
    description: "Obtiene el precio publico actual de un producto.",
    schema: productIdInput,
    roles: customerRoles,
    public: true,
    execute: async (input) => ({ price: await storeAiBusinessService.getProductPrice(input.productId) }),
  }),
  defineTool({
    name: "get_product_stock",
    description: "Consulta existencias reales y stock por talla de un producto.",
    schema: stockInput,
    roles: customerRoles,
    public: true,
    execute: async (input) => ({
      stock: await storeAiBusinessService.getProductStock(input.productId, input.sizeId),
    }),
  }),
  defineTool({
    name: "check_inventory",
    description: "Consulta stock real de una talla especifica o del producto completo.",
    schema: stockInput,
    roles: customerRoles,
    public: true,
    execute: async (input) => ({
      stock: await storeAiBusinessService.getProductStock(input.productId, input.sizeId),
    }),
  }),
  defineTool({
    name: "get_product_variants",
    description: "Obtiene variantes y tallas reales de un producto.",
    schema: productIdInput,
    roles: customerRoles,
    public: true,
    execute: async (input) => ({ variants: await storeAiBusinessService.getProductVariants(input.productId) }),
  }),
  defineTool({
    name: "list_categories",
    description: "Lista categorias reales del catalogo.",
    schema: z.object({}).strict(),
    roles: customerRoles,
    public: true,
    execute: async () => ({ categories: await storeAiBusinessService.listCategories() }),
  }),
  defineTool({
    name: "list_lines",
    description: "Lista lineas o audiencias del catalogo.",
    schema: z.object({}).strict(),
    roles: customerRoles,
    public: true,
    execute: async () => ({ lines: await storeAiBusinessService.listLines() }),
  }),
  defineTool({
    name: "list_collections",
    description: "Lista colecciones o documentos de catalogo resumido configurados en conocimiento.",
    schema: z.object({}).strict(),
    roles: customerRoles,
    public: true,
    execute: async () => ({ collections: await storeAiBusinessService.listCollections() }),
  }),
  defineTool({
    name: "get_related_products",
    description: "Obtiene productos relacionados existentes dentro de la tienda.",
    schema: relatedProductsInput,
    roles: customerRoles,
    public: true,
    execute: async (input) => ({ products: await storeAiBusinessService.getRelatedProducts(input) }),
  }),
  defineTool({
    name: "get_product_link",
    description: "Devuelve el link canonico de un producto si la tienda publica esta configurada.",
    schema: productIdInput,
    roles: customerRoles,
    public: true,
    execute: async (input) => ({ url: await storeAiBusinessService.getProductLink(input.productId) }),
  }),
  defineTool({
    name: "search_faq",
    description: "Busca preguntas frecuentes y respuestas oficiales de la tienda.",
    schema: searchFaqInput,
    roles: customerRoles,
    public: true,
    execute: async (input) => ({ results: await storeAiBusinessService.searchFaq(input.query) }),
  }),
  defineTool({
    name: "get_faq_answer",
    description: "Obtiene respuesta FAQ o bundle de conocimiento por tema.",
    schema: getFaqAnswerInput,
    roles: customerRoles,
    public: true,
    execute: async (input) => ({ knowledge: await storeAiBusinessService.getKnowledgeBundle(input.topic) }),
  }),
  defineTool({
    name: "get_shipping_info",
    description: "Obtiene la politica de envios y configuracion publica de envio.",
    schema: z.object({}).strict(),
    roles: customerRoles,
    public: true,
    execute: async () => ({ shipping: await storeAiBusinessService.getShippingInfo() }),
  }),
  defineTool({
    name: "get_return_policy",
    description: "Obtiene la politica de cambios y devoluciones.",
    schema: z.object({}).strict(),
    roles: customerRoles,
    public: true,
    execute: async () => ({ policy: await storeAiBusinessService.getReturnPolicy() }),
  }),
  defineTool({
    name: "get_promotions",
    description: "Obtiene promociones activas configuradas para la tienda.",
    schema: promotionsInput,
    roles: customerRoles,
    public: true,
    execute: async (input) => ({ promotions: await storeAiBusinessService.getPromotions(input.activeOnly ?? true) }),
  }),
  defineTool({
    name: "get_store_info",
    description: "Obtiene informacion de tienda, contacto, horarios y ubicacion fisica.",
    schema: z.object({}).strict(),
    roles: customerRoles,
    public: true,
    execute: async () => ({ store: await storeAiBusinessService.getStoreInfo() }),
  }),
  defineTool({
    name: "get_payment_methods",
    description: "Lista los metodos de pago soportados por la tienda.",
    schema: z.object({}).strict(),
    roles: customerRoles,
    public: true,
    execute: async () => ({ paymentMethods: await storeAiBusinessService.getPaymentMethods() }),
  }),
  defineTool({
    name: "get_order_status",
    description: "Consulta el estado de un pedido con autorizacion valida.",
    schema: orderStatusInput,
    roles: customerRoles,
    public: false,
    execute: async (input, context) => ({
      order: await storeAiBusinessService.getOrderStatus({
        orderId: input.orderId,
        phone: input.phone,
        userId: context.sessionMode === "authenticated" ? context.userId : undefined,
        role: context.sessionMode === "authenticated" ? context.role : undefined,
      }),
    }),
  }),
  defineTool({
    name: "detect_image_referenced_product",
    description: "Intenta resolver el producto referido por imagen o adjunto reciente.",
    schema: z.object({}).strict(),
    roles: customerRoles,
    public: true,
    execute: async (_input, context) => ({
      reference: await storeAiBusinessService.detectImageReferencedProduct({
        sessionId: context.sessionId,
        attachments: context.attachments?.map((attachment) => ({
          assetId: attachment.assetId,
        })),
      }),
    }),
  }),
  defineTool({
    name: "handoff_to_human",
    description: "Escala la conversacion a soporte humano cuando el caso lo amerita.",
    schema: handoffInput,
    roles: customerRoles,
    public: true,
    execute: async (input) => ({
      handoff: await storeAiBusinessService.handoffToHuman(input.reason),
    }),
  }),
  defineTool({
    name: "create_cart",
    description: "Obtiene o crea el carrito del usuario autenticado.",
    schema: z.object({}).strict(),
    roles: customerRoles,
    public: false,
    execute: async (_input, context) => ({ cart: await storeAiBusinessService.createCart(context.userId) }),
  }),
  defineTool({
    name: "add_to_cart",
    description: "Agrega un producto real al carrito del usuario autenticado.",
    schema: addToCartInput,
    roles: customerRoles,
    public: false,
    execute: async (input, context) => ({ cart: await storeAiBusinessService.addToCart(context.userId, input) }),
  }),
  defineTool({
    name: "remove_from_cart",
    description: "Elimina un producto real del carrito del usuario autenticado.",
    schema: removeFromCartInput,
    roles: customerRoles,
    public: false,
    execute: async (input, context) => ({ cart: await storeAiBusinessService.removeFromCart(context.userId, input) }),
  }),
  defineTool({
    name: "create_tryon_job",
    description: "Solicita la creacion de una vista previa visual del producto para el usuario autenticado.",
    schema: createTryOnJobInput,
    roles: customerRoles,
    public: false,
    execute: async (input, context) => ({
      job: await tryOnWorkflowService.createJob({
        userId: context.userId,
        sessionId: input.sessionId,
        productId: input.productId,
        variantId: input.variantId,
        sku: input.sku,
        userImageAssetId: input.userImageAssetId,
        consentAccepted: input.consentAccepted,
        requestedByRole: context.role,
      }),
    }),
  }),
  defineTool({
    name: "get_tryon_status",
    description: "Consulta el estado actual de un job de try-on propio.",
    schema: getTryOnStatusInput,
    roles: customerRoles,
    public: false,
    execute: async (input, context) => {
      const job = await tryOnWorkflowService.getJobStatus(input.jobId);
      if (job && job.userId !== context.userId && context.role !== RolUsuario.ADMIN) {
        throw new Error("No tienes permisos para ver este job de try-on");
      }
      return { job };
    },
  }),
  defineTool({
    name: "get_tryon_download_link",
    description: "Obtiene el link de descarga seguro de un try-on propio si ya termino.",
    schema: getTryOnLinkInput,
    roles: customerRoles,
    public: false,
    execute: async (input, context) => {
      const job = await tryOnWorkflowService.getJobStatus(input.jobId);
      if (job && job.userId !== context.userId && context.role !== RolUsuario.ADMIN) {
        throw new Error("No tienes permisos para descargar este try-on");
      }
      const downloadUrl = await tryOnWorkflowService.getDownloadUrl(input.jobId);
      return { jobId: input.jobId, status: job?.status, downloadUrl };
    },
  }),
  defineTool({
    name: "admin_update_stock",
    description: "Actualiza stock real de un producto para operaciones internas.",
    schema: adminUpdateStockInput,
    roles: [RolUsuario.EMPLEADO, RolUsuario.ADMIN],
    capabilities: ["inventory", "admin"],
    public: false,
    execute: async (input, context) => ({ result: await storeAiBusinessService.adminUpdateStock({ ...input, usuarioId: context.userId }) }),
  }),
  defineTool({
    name: "admin_view_private_inventory",
    description: "Consulta inventario interno y alertas privadas de un producto.",
    schema: productIdInput,
    roles: [RolUsuario.EMPLEADO, RolUsuario.ADMIN],
    capabilities: ["inventory", "admin"],
    public: false,
    execute: async (input) => ({ inventory: await storeAiBusinessService.adminViewPrivateInventory(input.productId) }),
  }),
  defineTool({
    name: "admin_update_price",
    description: "Actualiza el precio publico de un producto.",
    schema: adminUpdatePriceInput,
    roles: [RolUsuario.ADMIN],
    capabilities: ["admin"],
    public: false,
    execute: async (input) => ({ product: await storeAiBusinessService.adminUpdatePrice(input) }),
  }),
  defineTool({
    name: "admin_publish_product",
    description: "Publica un producto en el catalogo activo.",
    schema: productIdInput,
    roles: [RolUsuario.ADMIN],
    capabilities: ["admin"],
    public: false,
    execute: async (input) => ({ product: await storeAiBusinessService.adminPublishProduct(input.productId) }),
  }),
  defineTool({
    name: "admin_hide_product",
    description: "Oculta un producto del catalogo activo.",
    schema: productIdInput,
    roles: [RolUsuario.ADMIN],
    capabilities: ["admin"],
    public: false,
    execute: async (input) => ({ product: await storeAiBusinessService.adminHideProduct(input.productId) }),
  }),
];

export const aiToolDefinitions = tools;
export default aiToolDefinitions;
