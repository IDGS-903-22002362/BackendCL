import productService, {
  AssistantProductSearchFilters,
  AssistantProductSearchResult,
} from "../../../services/product.service";
import carritoService from "../../../services/carrito.service";
import categoryService from "../../../services/category.service";
import lineService from "../../../services/line.service";
import { getAllSizes, getSizeById } from "../../../services/size.service";
import inventoryService from "../../../services/inventory.service";
import pagoService from "../../../services/pago.service";
import storeConfigService from "./store-config.service";
import faqService from "./faq.service";
import policyService from "./policy.service";
import productLinkService from "./product-link.service";
import promotionService from "./promotion.service";
import storeInfoService from "./store-info.service";
import orderSupportService from "./order-support.service";
import knowledgeRetrievalService from "./knowledge-retrieval.service";
import tryOnAssetService from "../jobs/tryon-asset.service";
import aiSessionService from "../memory/session.service";
import { RolUsuario } from "../../../models/usuario.model";

class StoreAiBusinessService {
  async searchProducts(
    term: string,
    filters: AssistantProductSearchFilters = {},
  ): Promise<Array<Record<string, unknown>>> {
    const results = await productService.searchProductsForAssistant(term, filters);
    return results.map((product) => this.mapSearchResult(product));
  }

  async getProductDetail(productId: string): Promise<Record<string, unknown> | null> {
    const product = await productService.getProductById(productId);
    if (!product) {
      return null;
    }

    const [category, line, variants] = await Promise.all([
      categoryService.getCategoryById(product.categoriaId),
      lineService.getLineById(product.lineaId),
      this.getProductVariants(productId),
    ]);

    return {
      ...product,
      category,
      line,
      variants,
      canonicalLink: productLinkService.buildProductLink({
        ...product,
        id: product.id,
      }),
      inStock: product.existencias > 0,
    };
  }

  async getProductPrice(productId: string): Promise<{ productId: string; price: number; currency: string } | null> {
    const product = await productService.getProductById(productId);
    if (!product) {
      return null;
    }

    return {
      productId,
      price: product.precioPublico,
      currency: "MXN",
    };
  }

  async getProductStock(
    productId: string,
    sizeId?: string,
  ): Promise<Record<string, unknown> | null> {
    const stock = await productService.getStockBySize(productId);
    if (!stock) {
      return null;
    }

    const selectedSize = sizeId
      ? stock.inventarioPorTalla.find((item) => item.tallaId === sizeId)
      : undefined;

    return {
      ...stock,
      requestedSizeId: sizeId || null,
      requestedSizeStock: selectedSize?.cantidad ?? null,
      inStock: sizeId ? (selectedSize?.cantidad ?? 0) > 0 : stock.existencias > 0,
    };
  }

  async getProductVariants(productId: string): Promise<Array<Record<string, unknown>>> {
    const product = await productService.getProductById(productId);
    if (!product) {
      return [];
    }

    return Promise.all(
      product.tallaIds.map(async (sizeId) => {
        const size = await getSizeById(sizeId);
        const inventory = product.inventarioPorTalla.find((item) => item.tallaId === sizeId);
        return {
          sizeId,
          sizeCode: size?.codigo || sizeId,
          sizeDescription: size?.descripcion || sizeId,
          stock: inventory?.cantidad ?? 0,
          inStock: (inventory?.cantidad ?? 0) > 0,
        };
      }),
    );
  }

  async listCategories(): Promise<Array<Record<string, unknown>>> {
    const categories = await categoryService.getAllCategories();
    return categories.map((category) => ({
      id: category.id,
      nombre: category.nombre,
      lineaId: category.lineaId || null,
    }));
  }

  async listLines(): Promise<Array<Record<string, unknown>>> {
    const lines = await lineService.getAllLines();
    return lines.map((line) => ({
      id: line.id,
      nombre: line.nombre,
      codigo: line.codigo,
    }));
  }

  async listCollections(): Promise<Array<Record<string, unknown>>> {
    const docs = await knowledgeRetrievalService.searchKnowledgeDocuments("catalog aliases");
    return docs.map((doc) => ({
      id: doc.id,
      title: doc.title,
      metadata: doc.metadata || {},
    }));
  }

  async getRelatedProducts(input: {
    productId?: string;
    query?: string;
  }): Promise<Array<Record<string, unknown>>> {
    if (input.productId) {
      const current = await productService.getProductById(input.productId);
      if (!current) {
        return [];
      }

      const related = await productService.getProductsByCategory(current.categoriaId);
      return related
        .filter((product) => product.id !== input.productId)
        .slice(0, 5)
        .map((product) => this.mapSearchResult({ ...product, score: 0, matchReasons: [], inStock: product.existencias > 0 }));
    }

    if (!input.query) {
      return [];
    }

    const found = await this.searchProducts(input.query, {});
    return found.slice(0, 5);
  }

  async getProductLink(productId: string): Promise<string | null> {
    const product = await productService.getProductById(productId);
    if (!product) {
      return null;
    }

    return productLinkService.buildProductLink({ ...product, id: product.id });
  }

  async searchFaq(term: string) {
    return faqService.search(term);
  }

  async getShippingInfo() {
    const [storeConfig, policy] = await Promise.all([
      storeConfigService.getStoreConfig(),
      policyService.getShippingPolicy(),
    ]);

    return {
      storeConfig,
      policy,
    };
  }

  async getReturnPolicy() {
    const [storeConfig, policy] = await Promise.all([
      storeConfigService.getStoreConfig(),
      policyService.getReturnPolicy(),
    ]);

    return {
      storeConfig,
      policy,
    };
  }

  async getPromotions(activeOnly = true) {
    const promotions = await promotionService.listActivePromotions();
    return activeOnly ? promotions : promotions;
  }

  async getStoreInfo() {
    return storeInfoService.getStoreInfo();
  }

  async getPaymentMethods() {
    return pagoService.getSupportedPaymentMethods();
  }

  async getOrderStatus(input: {
    orderId: string;
    userId?: string;
    role?: RolUsuario;
    phone?: string;
  }) {
    return orderSupportService.getOrderStatus({
      orderId: input.orderId,
      userId: input.userId,
      role: input.role,
      phone: input.phone,
    });
  }

  async detectImageReferencedProduct(input: {
    sessionId?: string;
    attachments?: Array<{ assetId: string }>;
  }): Promise<Record<string, unknown> | null> {
    if (input.attachments?.length) {
      const asset = await tryOnAssetService.getAssetById(input.attachments[0].assetId);
      return asset
        ? {
            assetId: asset.id,
            productId: asset.productId || null,
            variantId: asset.variantId || null,
            kind: asset.kind,
          }
        : null;
    }

    if (!input.sessionId) {
      return null;
    }

    const session = await aiSessionService.getSessionById(input.sessionId);
    if (!session?.conversationState?.recentAttachments?.length) {
      return null;
    }

    const attachment = session.conversationState.recentAttachments[0];
    if (!attachment?.assetId) {
      return null;
    }

    const asset = await tryOnAssetService.getAssetById(attachment.assetId);
    return asset
      ? {
          assetId: asset.id,
          productId: asset.productId || null,
          variantId: asset.variantId || null,
          kind: asset.kind,
        }
      : null;
  }

  async getKnowledgeBundle(query: string) {
    return knowledgeRetrievalService.findRelevantKnowledge(query);
  }

  async listSizes() {
    const sizes = await getAllSizes();
    return sizes.map((size) => ({
      id: size.id,
      code: size.codigo,
      description: size.descripcion,
    }));
  }

  async createCart(userId: string) {
    return carritoService.getOrCreateCart(userId);
  }

  async addToCart(userId: string, input: { productId: string; quantity: number; sizeId?: string }) {
    const cart = await carritoService.getOrCreateCart(userId);
    return carritoService.addItem(cart.id!, {
      productoId: input.productId,
      cantidad: input.quantity,
      tallaId: input.sizeId,
    });
  }

  async removeFromCart(userId: string, input: { productId: string; sizeId?: string }) {
    const cart = await carritoService.getOrCreateCart(userId);
    return carritoService.removeItem(cart.id!, input.productId, input.sizeId);
  }

  async adminUpdateStock(input: { productId: string; cantidadNueva: number; tallaId?: string; motivo?: string; referencia?: string; usuarioId?: string }) {
    return productService.updateStock(input.productId, {
      cantidadNueva: input.cantidadNueva,
      tallaId: input.tallaId,
      motivo: input.motivo,
      referencia: input.referencia,
      usuarioId: input.usuarioId,
      tipo: "ajuste",
    });
  }

  async adminViewPrivateInventory(productId: string) {
    const [stock, lowStockAlert] = await Promise.all([
      productService.getStockBySize(productId),
      productService.getLowStockAlertByProductId(productId),
    ]);

    return {
      stock,
      lowStockAlert,
    };
  }

  async adminUpdatePrice(input: { productId: string; precioPublico: number }) {
    return productService.updateProduct(input.productId, {
      precioPublico: input.precioPublico,
    });
  }

  async adminPublishProduct(productId: string) {
    return productService.updateProduct(productId, { activo: true });
  }

  async adminHideProduct(productId: string) {
    return productService.updateProduct(productId, { activo: false });
  }

  async getInventoryDashboard(filters: { productoId?: string }) {
    return inventoryService.listLowStockAlerts({
      productoId: filters.productoId,
      limit: 20,
    });
  }

  async handoffToHuman(reason: string) {
    return {
      status: "queued",
      reason,
      message:
        "Puedo pasarte con atencion humana. Comparte tu pedido o medio de contacto y te damos seguimiento.",
    };
  }

  private mapSearchResult(product: AssistantProductSearchResult): Record<string, unknown> {
    return {
      id: product.id,
      productId: product.id,
      clave: product.clave,
      descripcion: product.descripcion,
      lineaId: product.lineaId,
      categoriaId: product.categoriaId,
      precioPublico: product.precioPublico,
      existencias: product.existencias,
      tallaIds: product.tallaIds,
      inStock: product.inStock,
      score: product.score,
      reasons: product.matchReasons,
      canonicalLink: productLinkService.buildProductLink({
        ...product,
        id: product.id,
      }),
    };
  }
}

export const storeAiBusinessService = new StoreAiBusinessService();
export default storeAiBusinessService;
