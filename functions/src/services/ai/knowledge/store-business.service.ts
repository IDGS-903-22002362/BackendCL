import productService from "../../../services/product.service";
import carritoService from "../../../services/carrito.service";
import categoryService from "../../../services/category.service";
import lineService from "../../../services/line.service";
import { getSizeById } from "../../../services/size.service";
import inventoryService from "../../../services/inventory.service";
import storeConfigService from "./store-config.service";
import faqService from "./faq.service";
import policyService from "./policy.service";
import productLinkService from "./product-link.service";
import { Producto } from "../../../models/producto.model";

class StoreAiBusinessService {
  async searchProducts(term: string): Promise<Producto[]> {
    return productService.searchProducts(term);
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
      canonicalLink: productLinkService.buildProductLink(product as unknown as Record<string, unknown>),
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

  async getProductStock(productId: string): Promise<Record<string, unknown> | null> {
    return productService.getStockBySize(productId);
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
        };
      }),
    );
  }

  async getRelatedProducts(productId: string): Promise<Producto[]> {
    const current = await productService.getProductById(productId);
    if (!current) {
      return [];
    }

    const related = await productService.getProductsByCategory(current.categoriaId);
    return related.filter((product) => product.id !== productId).slice(0, 5);
  }

  async getProductLink(productId: string): Promise<string | null> {
    const product = await productService.getProductById(productId);
    if (!product) {
      return null;
    }

    return productLinkService.buildProductLink(product as unknown as Record<string, unknown>);
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
}

export const storeAiBusinessService = new StoreAiBusinessService();
export default storeAiBusinessService;
