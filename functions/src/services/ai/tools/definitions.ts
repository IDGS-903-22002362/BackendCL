import { z } from "zod";
import { RolUsuario } from "../../../models/usuario.model";
import { RuntimeAiToolDefinition, defineTool } from "./types";
import storeAiBusinessService from "../knowledge/store-business.service";
import tryOnWorkflowService from "../jobs/tryon-workflow.service";

const searchProductsInput = z.object({ query: z.string().trim().min(1).max(120) }).strict();
const productIdInput = z.object({ productId: z.string().trim().min(1) }).strict();
const relatedProductsInput = productIdInput;
const searchFaqInput = z.object({ query: z.string().trim().min(1).max(120) }).strict();
const addToCartInput = z.object({ productId: z.string().trim().min(1), quantity: z.number().int().positive().max(10), sizeId: z.string().trim().min(1).optional() }).strict();
const removeFromCartInput = z.object({ productId: z.string().trim().min(1), sizeId: z.string().trim().min(1).optional() }).strict();
const createTryOnJobInput = z.object({ sessionId: z.string().trim().min(1), productId: z.string().trim().min(1), variantId: z.string().trim().min(1).optional(), sku: z.string().trim().min(1).optional(), userImageAssetId: z.string().trim().min(1), consentAccepted: z.literal(true) }).strict();
const getTryOnStatusInput = z.object({ jobId: z.string().trim().min(1) }).strict();
const getTryOnLinkInput = z.object({ jobId: z.string().trim().min(1) }).strict();
const adminUpdateStockInput = z.object({ productId: z.string().trim().min(1), cantidadNueva: z.number().int().nonnegative(), tallaId: z.string().trim().min(1).optional(), motivo: z.string().trim().min(1).max(250).optional(), referencia: z.string().trim().min(1).max(120).optional() }).strict();
const adminUpdatePriceInput = z.object({ productId: z.string().trim().min(1), precioPublico: z.number().nonnegative() }).strict();

const tools: RuntimeAiToolDefinition[] = [
  defineTool({
    name: "search_products",
    description: "Busca productos reales del catalogo por texto libre.",
    schema: searchProductsInput,
    roles: [RolUsuario.CLIENTE, RolUsuario.EMPLEADO, RolUsuario.ADMIN],
    execute: async (input) => ({ products: await storeAiBusinessService.searchProducts(input.query) }),
  }),
  defineTool({
    name: "get_product_detail",
    description: "Obtiene detalle completo de un producto real.",
    schema: productIdInput,
    roles: [RolUsuario.CLIENTE, RolUsuario.EMPLEADO, RolUsuario.ADMIN],
    execute: async (input) => ({ product: await storeAiBusinessService.getProductDetail(input.productId) }),
  }),
  defineTool({
    name: "get_product_price",
    description: "Obtiene el precio publico actual de un producto.",
    schema: productIdInput,
    roles: [RolUsuario.CLIENTE, RolUsuario.EMPLEADO, RolUsuario.ADMIN],
    execute: async (input) => ({ price: await storeAiBusinessService.getProductPrice(input.productId) }),
  }),
  defineTool({
    name: "get_product_stock",
    description: "Consulta existencias reales y stock por talla de un producto.",
    schema: productIdInput,
    roles: [RolUsuario.CLIENTE, RolUsuario.EMPLEADO, RolUsuario.ADMIN],
    execute: async (input) => ({ stock: await storeAiBusinessService.getProductStock(input.productId) }),
  }),
  defineTool({
    name: "get_product_variants",
    description: "Obtiene variantes y tallas reales de un producto.",
    schema: productIdInput,
    roles: [RolUsuario.CLIENTE, RolUsuario.EMPLEADO, RolUsuario.ADMIN],
    execute: async (input) => ({ variants: await storeAiBusinessService.getProductVariants(input.productId) }),
  }),
  defineTool({
    name: "get_related_products",
    description: "Obtiene productos relacionados existentes dentro de la tienda.",
    schema: relatedProductsInput,
    roles: [RolUsuario.CLIENTE, RolUsuario.EMPLEADO, RolUsuario.ADMIN],
    execute: async (input) => ({ products: await storeAiBusinessService.getRelatedProducts(input.productId) }),
  }),
  defineTool({
    name: "get_product_link",
    description: "Devuelve el link canonico de un producto si la tienda publica esta configurada.",
    schema: productIdInput,
    roles: [RolUsuario.CLIENTE, RolUsuario.EMPLEADO, RolUsuario.ADMIN],
    execute: async (input) => ({ url: await storeAiBusinessService.getProductLink(input.productId) }),
  }),
  defineTool({
    name: "search_faq",
    description: "Busca preguntas frecuentes y respuestas oficiales de la tienda.",
    schema: searchFaqInput,
    roles: [RolUsuario.CLIENTE, RolUsuario.EMPLEADO, RolUsuario.ADMIN],
    execute: async (input) => ({ results: await storeAiBusinessService.searchFaq(input.query) }),
  }),
  defineTool({
    name: "get_shipping_info",
    description: "Obtiene la politica de envios y configuracion publica de envio.",
    schema: z.object({}).strict(),
    roles: [RolUsuario.CLIENTE, RolUsuario.EMPLEADO, RolUsuario.ADMIN],
    execute: async () => ({ shipping: await storeAiBusinessService.getShippingInfo() }),
  }),
  defineTool({
    name: "get_return_policy",
    description: "Obtiene la politica de cambios y devoluciones.",
    schema: z.object({}).strict(),
    roles: [RolUsuario.CLIENTE, RolUsuario.EMPLEADO, RolUsuario.ADMIN],
    execute: async () => ({ policy: await storeAiBusinessService.getReturnPolicy() }),
  }),
  defineTool({
    name: "create_cart",
    description: "Obtiene o crea el carrito del usuario autenticado.",
    schema: z.object({}).strict(),
    roles: [RolUsuario.CLIENTE, RolUsuario.EMPLEADO, RolUsuario.ADMIN],
    execute: async (_input, context) => ({ cart: await storeAiBusinessService.createCart(context.userId) }),
  }),
  defineTool({
    name: "add_to_cart",
    description: "Agrega un producto real al carrito del usuario autenticado.",
    schema: addToCartInput,
    roles: [RolUsuario.CLIENTE, RolUsuario.EMPLEADO, RolUsuario.ADMIN],
    execute: async (input, context) => ({ cart: await storeAiBusinessService.addToCart(context.userId, input) }),
  }),
  defineTool({
    name: "remove_from_cart",
    description: "Elimina un producto real del carrito del usuario autenticado.",
    schema: removeFromCartInput,
    roles: [RolUsuario.CLIENTE, RolUsuario.EMPLEADO, RolUsuario.ADMIN],
    execute: async (input, context) => ({ cart: await storeAiBusinessService.removeFromCart(context.userId, input) }),
  }),
  defineTool({
    name: "create_tryon_job",
    description: "Solicita la creacion de una vista previa visual del producto para el usuario autenticado. El backend decide si sera try-on corporal o mockup segun el tipo de producto.",
    schema: createTryOnJobInput,
    roles: [RolUsuario.CLIENTE, RolUsuario.EMPLEADO, RolUsuario.ADMIN],
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
    roles: [RolUsuario.CLIENTE, RolUsuario.EMPLEADO, RolUsuario.ADMIN],
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
    roles: [RolUsuario.CLIENTE, RolUsuario.EMPLEADO, RolUsuario.ADMIN],
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
    execute: async (input, context) => ({ result: await storeAiBusinessService.adminUpdateStock({ ...input, usuarioId: context.userId }) }),
  }),
  defineTool({
    name: "admin_view_private_inventory",
    description: "Consulta inventario interno y alertas privadas de un producto.",
    schema: productIdInput,
    roles: [RolUsuario.EMPLEADO, RolUsuario.ADMIN],
    capabilities: ["inventory", "admin"],
    execute: async (input) => ({ inventory: await storeAiBusinessService.adminViewPrivateInventory(input.productId) }),
  }),
  defineTool({
    name: "admin_update_price",
    description: "Actualiza el precio publico de un producto.",
    schema: adminUpdatePriceInput,
    roles: [RolUsuario.ADMIN],
    capabilities: ["admin"],
    execute: async (input) => ({ product: await storeAiBusinessService.adminUpdatePrice(input) }),
  }),
  defineTool({
    name: "admin_publish_product",
    description: "Publica un producto en el catalogo activo.",
    schema: productIdInput,
    roles: [RolUsuario.ADMIN],
    capabilities: ["admin"],
    execute: async (input) => ({ product: await storeAiBusinessService.adminPublishProduct(input.productId) }),
  }),
  defineTool({
    name: "admin_hide_product",
    description: "Oculta un producto del catalogo activo.",
    schema: productIdInput,
    roles: [RolUsuario.ADMIN],
    capabilities: ["admin"],
    execute: async (input) => ({ product: await storeAiBusinessService.adminHideProduct(input.productId) }),
  }),
];

export const aiToolDefinitions = tools;
export default aiToolDefinitions;
