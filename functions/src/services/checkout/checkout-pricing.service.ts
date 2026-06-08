import { firestoreTienda } from "../../config/firebase";
import {
  Carrito,
  ItemCarrito,
} from "../../models/carrito.model";
import {
  CheckoutFlowError,
  CheckoutItemPricingSnapshot,
  CheckoutPricingInput,
  CheckoutPricingSnapshot,
  CheckoutShippingSelection,
} from "../../models/checkout-pricing.model";
import { Producto } from "../../models/producto.model";
import { checkoutShippingService, CheckoutShippingService } from "./checkout-shipping.service";
import { normalizeTallaIds, completeInventarioPorTalla } from "../../utils/size-inventory.util";

const CARRITOS_COLLECTION = "carritos";
const PRODUCTOS_COLLECTION = "productos";
const DEFAULT_CURRENCY = "MXN";

type FirestoreLike = FirebaseFirestore.Firestore;

const roundMoney = (value: number): number => Math.round(value * 100) / 100;

const toPositiveNumber = (...values: unknown[]): number | undefined => {
  for (const value of values) {
    const parsed =
      typeof value === "number"
        ? value
        : typeof value === "string"
          ? Number(value)
          : Number.NaN;

    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return undefined;
};

const resolveRequiresShipping = (product: Producto): boolean =>
  product.shipping?.requiresShipping !== false;

const resolveLogistics = (product: Producto) => {
  const fedexShipping = product.fedexShipping || {};
  const shipping = product.shipping || {};
  const productRecord = product as unknown as Record<string, unknown>;
  return {
    weightKg: toPositiveNumber(
      fedexShipping.weightKg,
      shipping.weightKg,
      productRecord.weightKg,
    ),
    lengthCm: toPositiveNumber(
      fedexShipping.lengthCm,
      shipping.lengthCm,
      productRecord.lengthCm,
    ),
    widthCm: toPositiveNumber(
      fedexShipping.widthCm,
      shipping.widthCm,
      productRecord.widthCm,
    ),
    heightCm: toPositiveNumber(
      fedexShipping.heightCm,
      shipping.heightCm,
      productRecord.heightCm,
    ),
  };
};

export class CheckoutPricingService {
  constructor(
    private readonly db: FirestoreLike = firestoreTienda as FirestoreLike,
    private readonly shippingService: CheckoutShippingService = checkoutShippingService,
  ) {}

  async calculateCheckoutPricing(
    input: CheckoutPricingInput,
  ): Promise<CheckoutPricingSnapshot> {
    const cart = await this.resolveCart(input);

    if (!Array.isArray(cart.items) || cart.items.length === 0) {
      throw new CheckoutFlowError(
        "CHECKOUT_CART_EMPTY",
        "El carrito esta vacio. Agrega productos antes de hacer checkout.",
        400,
      );
    }

    const items = await this.buildItemSnapshots(cart.items);
    const subtotalOriginal = roundMoney(
      items.reduce((total, item) => total + item.subtotalOriginal, 0),
    );
    const subtotalFinal = roundMoney(
      items.reduce((total, item) => total + item.subtotalFinal, 0),
    );
    const discountTotal = roundMoney(
      items.reduce((total, item) => total + item.discountTotal, 0),
    );

    const currency = DEFAULT_CURRENCY;
    const shippingSelection = this.normalizeShippingSelection(
      input.shippingSelection,
    );
    const shippingAddress = input.shippingAddress;
    const shipping = await this.shippingService.calculateShipping({
      userId: input.userId,
      cart,
      items,
      shippingSelection,
      shippingAddress,
      currency,
      shippingQuoteId: input.shippingQuoteId,
      selectedShippingOptionId: input.selectedShippingOptionId,
      selectedServiceType: input.selectedServiceType,
    });

    const shippingTotal = roundMoney(shipping.amount);
    const total = roundMoney(subtotalFinal + shippingTotal);

    if (
      total <= 0 ||
      subtotalFinal < 0 ||
      discountTotal < 0 ||
      shippingTotal < 0
    ) {
      throw new CheckoutFlowError(
        "CHECKOUT_TOTAL_INVALID",
        "El total de checkout calculado en backend no es valido.",
        422,
      );
    }

    return {
      currency,
      subtotalOriginal,
      subtotalFinal,
      discountTotal,
      shippingTotal,
      total,
      items,
      shipping,
      warnings: shipping.warnings || [],
      calculatedAt: new Date().toISOString(),
    };
  }

  private async resolveCart(input: CheckoutPricingInput): Promise<Carrito> {
    if (input.cartId) {
      const snapshot = await this.db.collection(CARRITOS_COLLECTION).doc(input.cartId).get();
      if (!snapshot.exists) {
        throw new CheckoutFlowError(
          "CHECKOUT_CART_EMPTY",
          `Carrito ${input.cartId} no encontrado.`,
          404,
        );
      }
      return { id: snapshot.id, ...(snapshot.data() as Carrito) };
    }

    if (!input.userId) {
      throw new CheckoutFlowError(
        "CHECKOUT_CART_EMPTY",
        "No fue posible resolver el carrito del checkout.",
        400,
      );
    }

    const snapshot = await this.db
      .collection(CARRITOS_COLLECTION)
      .where("usuarioId", "==", input.userId)
      .limit(1)
      .get();

    if (snapshot.empty) {
      throw new CheckoutFlowError(
        "CHECKOUT_CART_EMPTY",
        "No se encontro carrito activo para el usuario.",
        404,
      );
    }

    const doc = snapshot.docs[0];
    return { id: doc.id, ...(doc.data() as Carrito) };
  }

  private async buildItemSnapshots(
    cartItems: ItemCarrito[],
  ): Promise<CheckoutItemPricingSnapshot[]> {
    const productsById = await this.loadProducts(cartItems);
    const requestedByVariant = new Map<string, number>();

    return cartItems.map((item) => {
      const product = productsById.get(item.productoId);
      if (!product) {
        throw new CheckoutFlowError(
          "CHECKOUT_PRODUCT_NOT_FOUND",
          `El producto con ID "${item.productoId}" no existe en el catalogo.`,
          404,
        );
      }

      if (!product.activo) {
        throw new CheckoutFlowError(
          "CHECKOUT_PRODUCT_INACTIVE",
          `El producto "${product.descripcion}" no esta disponible.`,
          400,
        );
      }

      const stockContext = this.resolveStockContext(product, item);
      const variantKey = `${item.productoId}::${stockContext.tallaId || "__GLOBAL__"}`;
      const requestedTotal = (requestedByVariant.get(variantKey) || 0) + item.cantidad;

      if (stockContext.available < requestedTotal) {
        throw new CheckoutFlowError(
          "CHECKOUT_STOCK_UNAVAILABLE",
          `Stock insuficiente para "${product.descripcion}".`,
          409,
          {
            productId: item.productoId,
            tallaId: stockContext.tallaId,
            available: stockContext.available,
            requested: requestedTotal,
          },
        );
      }

      requestedByVariant.set(variantKey, requestedTotal);

      const unitPriceOriginal = roundMoney(product.precioPublico);
      const unitPriceFinal = unitPriceOriginal;
      const subtotalOriginal = roundMoney(unitPriceOriginal * item.cantidad);
      const subtotalFinal = subtotalOriginal;
      const logistics = resolveLogistics(product);

      return {
        productId: item.productoId,
        tallaId: stockContext.tallaId,
        quantity: item.cantidad,
        productName: product.descripcion,
        sku: product.clave,
        unitPriceOriginal,
        unitPriceFinal,
        subtotalOriginal,
        subtotalFinal,
        discountTotal: 0,
        ofertaAplicadaId: null,
        ofertaTitulo: null,
        weightKg: logistics.weightKg,
        lengthCm: logistics.lengthCm,
        widthCm: logistics.widthCm,
        heightCm: logistics.heightCm,
        requiereEnvio: resolveRequiresShipping(product),
      };
    });
  }

  private async loadProducts(cartItems: ItemCarrito[]): Promise<Map<string, Producto>> {
    const uniqueIds = [...new Set(cartItems.map((item) => item.productoId))];
    const snapshots = await Promise.all(
      uniqueIds.map((id) => this.db.collection(PRODUCTOS_COLLECTION).doc(id).get()),
    );

    return new Map(
      snapshots
        .filter((snapshot) => snapshot.exists)
        .map((snapshot) => [snapshot.id, snapshot.data() as Producto]),
    );
  }

  private resolveStockContext(
    product: Producto,
    item: ItemCarrito,
  ): { available: number; tallaId?: string } {
    const tallaIds = normalizeTallaIds(product.tallaIds);

    if (tallaIds.length === 0) {
      if (item.tallaId?.trim()) {
        throw new CheckoutFlowError(
          "CHECKOUT_STOCK_UNAVAILABLE",
          `El producto "${product.descripcion}" no maneja inventario por talla.`,
          400,
        );
      }

      return {
        available: Math.max(0, Math.floor(Number(product.existencias ?? 0))),
      };
    }

    const tallaId = item.tallaId?.trim();
    if (!tallaId) {
      throw new CheckoutFlowError(
        "CHECKOUT_STOCK_UNAVAILABLE",
        `Se requiere talla para "${product.descripcion}" en checkout.`,
        400,
      );
    }

    if (!tallaIds.includes(tallaId)) {
      throw new CheckoutFlowError(
        "CHECKOUT_STOCK_UNAVAILABLE",
        `La talla "${tallaId}" no es valida para "${product.descripcion}".`,
        400,
      );
    }

    const inventarioPorTalla = completeInventarioPorTalla(
      tallaIds,
      product.inventarioPorTalla,
    );
    const available =
      inventarioPorTalla.find((entry) => entry.tallaId === tallaId)?.cantidad ?? 0;

    return {
      available,
      tallaId,
    };
  }

  private normalizeShippingSelection(
    selection: CheckoutShippingSelection,
  ): CheckoutShippingSelection {
    if (selection.method === "PICKUP") {
      return { method: "PICKUP" };
    }

    if (selection.method === "MANUAL") {
      return { method: "MANUAL" };
    }

    return {
      method: "FEDEX",
      provider: "FEDEX",
      serviceType: selection.serviceType,
      serviceName: selection.serviceName,
      carrierCode: selection.carrierCode,
      packagingType: selection.packagingType,
      quotedAmount:
        typeof selection.quotedAmount === "number"
          ? roundMoney(selection.quotedAmount)
          : undefined,
      quotedCurrency: selection.quotedCurrency || DEFAULT_CURRENCY,
      transitTime: selection.transitTime,
      deliveryTimestamp: selection.deliveryTimestamp,
    };
  }
}

export const checkoutPricingService = new CheckoutPricingService();
export default checkoutPricingService;
