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
import { normalizeTallaIds } from "../../utils/size-inventory.util";
import { ofertasService, OfertasService } from "../ofertas.service";
import {
  ProductoOfertaBase,
  seleccionarMejorOferta,
} from "../../utils/ofertas-pricing.util";
import { Oferta } from "../../models/ofertas.model";
import { codigosPromocionService } from "../codigos-promocion.service";
import { getAvailableForVariant, getPhysicalForVariant } from "../../utils/inventory-stock.util";
import type { CheckoutUnavailableItemDetail } from "../../models/checkout-unavailable-item.model";

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
    private readonly offersService: OfertasService = ofertasService,
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

    // Aplicar código promocional en backend, replicando EXACTAMENTE la lógica de
    // orden.service.createOrden (PASO 1.5): ofertas primero (ya aplicadas en
    // buildItemSnapshots) y luego el código sobre el subtotal con ofertas. Esto
    // garantiza que el monto cobrado por Stripe == total de la orden creada en el
    // webhook y evita discrepancias entre pricing y createOrden.
    const codigoPromocion =
      typeof input.codigoPromocion === "string"
        ? input.codigoPromocion.trim().toUpperCase()
        : undefined;

    let subtotalConCodigo = subtotalFinal;
    let codigoDescuento = 0;
    let codigoPromocionId: string | null = null;
    let codigoPromocionTitulo: string | null = null;

    if (codigoPromocion) {
      // Mismo criterio que createOrden: el código no se combina con ofertas.
      const tieneItemsConOferta = items.some(
        (item) => item.ofertaAplicadaId != null && item.discountTotal > 0,
      );

      if (tieneItemsConOferta) {
        throw new CheckoutFlowError(
          "CHECKOUT_CODE_NOT_APPLICABLE",
          "No se puede aplicar un código promocional cuando hay productos con oferta en el carrito.",
          409,
        );
      }

      const resultadoCodigo = await codigosPromocionService.validar({
        codigo: codigoPromocion,
        items: items.map((item) => ({
          productoId: item.productId,
          cantidad: item.quantity,
          // Precio con ofertas aplicadas (igual que itemsParaCodigoPromocion en createOrden).
          precioUnitario: item.unitPriceFinal,
          ...(item.tallaId ? { tallaId: item.tallaId } : {}),
        })),
      });

      const codigoValido =
        resultadoCodigo.valido !== false &&
        Number(resultadoCodigo.descuentoTotal || 0) > 0 &&
        Number(resultadoCodigo.subtotalFinal || 0) > 0 &&
        Number(resultadoCodigo.subtotalFinal || 0) < subtotalFinal;

      if (!codigoValido) {
        throw new CheckoutFlowError(
          "CHECKOUT_CODE_NOT_APPLICABLE",
          resultadoCodigo.mensaje ||
            "El código promocional no aplica para esta orden.",
          409,
        );
      }

      subtotalConCodigo = roundMoney(Number(resultadoCodigo.subtotalFinal));
      codigoDescuento = roundMoney(Number(resultadoCodigo.descuentoTotal || 0));
      codigoPromocionId = resultadoCodigo.codigoPromocionId ?? null;
      codigoPromocionTitulo = resultadoCodigo.codigoTitulo ?? null;
    }

    const total = roundMoney(subtotalConCodigo + shippingTotal);

    if (
      total <= 0 ||
      subtotalFinal < 0 ||
      subtotalConCodigo < 0 ||
      discountTotal < 0 ||
      codigoDescuento < 0 ||
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
      // `discountTotal` se mantiene SOLO con ofertas para no romper el contrato con
      // createOrden, que suma aparte el descuento del código (data.discountTotal +
      // descuentoCodigoPromocion). El descuento del código se expone en `codigoDescuento`.
      discountTotal,
      shippingTotal,
      total,
      subtotalConCodigo,
      codigoDescuento,
      ...(codigoPromocion ? { codigoPromocion } : {}),
      ...(codigoPromocionId ? { codigoPromocionId } : {}),
      ...(codigoPromocionTitulo ? { codigoPromocionTitulo } : {}),
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

  private collectUnavailableCartItems(
    cartItems: ItemCarrito[],
    productsById: Map<string, Producto>,
  ): CheckoutUnavailableItemDetail[] {
    const requestedByVariant = new Map<
      string,
      {
        productId: string;
        productName: string;
        tallaId?: string;
        available: number;
        requested: number;
        stockFisico: number;
        inactive: boolean;
      }
    >();

    for (const item of cartItems) {
      const product = productsById.get(item.productoId);
      if (!product) {
        const variantKey = `${item.productoId}::__GLOBAL__`;
        const current = requestedByVariant.get(variantKey);
        requestedByVariant.set(variantKey, {
          productId: item.productoId,
          productName: "Producto no disponible",
          available: 0,
          requested: (current?.requested ?? 0) + item.cantidad,
          stockFisico: 0,
          inactive: true,
        });
        continue;
      }

      if (!product.activo) {
        const variantKey = `${item.productoId}::${item.tallaId?.trim() || "__GLOBAL__"}`;
        const current = requestedByVariant.get(variantKey);
        requestedByVariant.set(variantKey, {
          productId: item.productoId,
          productName: product.descripcion || "Producto",
          tallaId: item.tallaId?.trim() || undefined,
          available: 0,
          requested: (current?.requested ?? 0) + item.cantidad,
          stockFisico: 0,
          inactive: true,
        });
        continue;
      }

      const stockContext = this.resolveStockContext(product, item);
      const variantKey = `${item.productoId}::${stockContext.tallaId || "__GLOBAL__"}`;
      const productData = product as unknown as Record<string, unknown>;
      const current = requestedByVariant.get(variantKey);
      requestedByVariant.set(variantKey, {
        productId: item.productoId,
        productName: product.descripcion || "Producto",
        tallaId: stockContext.tallaId,
        available: stockContext.available,
        requested: (current?.requested ?? 0) + item.cantidad,
        stockFisico: getPhysicalForVariant(productData, stockContext.tallaId),
        inactive: false,
      });
    }

    const unavailable: CheckoutUnavailableItemDetail[] = [];
    for (const entry of requestedByVariant.values()) {
      if (entry.inactive) {
        unavailable.push({
          productId: entry.productId,
          productName: entry.productName,
          tallaId: entry.tallaId,
          available: entry.available,
          requested: entry.requested,
          reason: "inactive",
        });
        continue;
      }

      if (entry.available < entry.requested) {
        unavailable.push({
          productId: entry.productId,
          productName: entry.productName,
          tallaId: entry.tallaId,
          available: entry.available,
          requested: entry.requested,
          reason:
            entry.available === 0 && entry.stockFisico > 0
              ? "reserved_by_other"
              : "out_of_stock",
        });
      }
    }

    return unavailable;
  }

  private async buildItemSnapshots(
    cartItems: ItemCarrito[],
  ): Promise<CheckoutItemPricingSnapshot[]> {
    const productsById = await this.loadProducts(cartItems);
    const unavailableItems = this.collectUnavailableCartItems(
      cartItems,
      productsById,
    );

    if (unavailableItems.length > 0) {
      const message =
        unavailableItems.length === 1
          ? `Stock insuficiente para "${unavailableItems[0].productName}".`
          : `No puedes continuar: ${unavailableItems.length} productos sin stock suficiente.`;
      throw new CheckoutFlowError(
        "CHECKOUT_STOCK_UNAVAILABLE",
        message,
        409,
        { unavailableItems },
      );
    }

    const activeOffers = await this.loadActiveOffers();
    const requestedByVariant = new Map<string, number>();

    return cartItems.map((item) => {
      const product = productsById.get(item.productoId)!;
      const stockContext = this.resolveStockContext(product, item);
      const variantKey = `${item.productoId}::${stockContext.tallaId || "__GLOBAL__"}`;
      const requestedTotal =
        (requestedByVariant.get(variantKey) || 0) + item.cantidad;
      requestedByVariant.set(variantKey, requestedTotal);

      const unitPriceOriginal = roundMoney(product.precioPublico);
      const bestOffer = seleccionarMejorOferta(
        activeOffers,
        this.toOfertaBase(item.productoId, product),
        stockContext.tallaId,
      );
      const unitPriceFinal = roundMoney(
        bestOffer?.precioFinal ?? unitPriceOriginal,
      );
      const subtotalOriginal = roundMoney(unitPriceOriginal * item.cantidad);
      const subtotalFinal = roundMoney(unitPriceFinal * item.cantidad);
      const discountTotal = roundMoney(subtotalOriginal - subtotalFinal);
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
        discountTotal: discountTotal > 0 ? discountTotal : 0,
        ofertaAplicadaId: bestOffer?.oferta.id ?? null,
        ofertaTitulo: bestOffer?.oferta.titulo ?? null,
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

  private async loadActiveOffers(): Promise<Oferta[]> {
    try {
      return await this.offersService.listarOfertasActivas();
    } catch (error) {
      console.error(
        "[checkout-pricing] No se pudieron cargar las ofertas activas:",
        error,
      );
      return [];
    }
  }

  private toOfertaBase(
    productId: string,
    product: Producto,
  ): ProductoOfertaBase {
    const record = product as unknown as Record<string, unknown>;
    const toStringArray = (value: unknown): string[] | undefined =>
      Array.isArray(value)
        ? value.filter((item): item is string => typeof item === "string")
        : undefined;

    return {
      id: productId,
      precioPublico: product.precioPublico,
      categoriaId: product.categoriaId ?? null,
      categoriaIds: toStringArray(record.categoriaIds),
      lineaId: product.lineaId ?? null,
      lineaIds: toStringArray(record.lineaIds),
      tallaIds: toStringArray(record.tallaIds) ?? product.tallaIds ?? [],
    };
  }

  private resolveStockContext(
    product: Producto,
    item: ItemCarrito,
  ): { available: number; tallaId?: string } {
    const productData = product as unknown as Record<string, unknown>;
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
        available: getAvailableForVariant(productData, null),
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

    return {
      available: getAvailableForVariant(productData, tallaId),
      tallaId,
    };
  }

  private normalizeShippingSelection(
    selection: CheckoutShippingSelection,
  ): CheckoutShippingSelection {
    if (selection.method === "PICKUP") {
      return { method: "PICKUP" };
    }

    return { method: "MANUAL", provider: "MANUAL" };
  }
}

export const checkoutPricingService = new CheckoutPricingService();
export default checkoutPricingService;
