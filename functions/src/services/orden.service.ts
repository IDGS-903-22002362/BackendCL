/**
 * Servicio de Órdenes
 * Maneja toda la lógica de negocio relacionada con órdenes de compra
 *
 * IMPORTANTE:
 * - Recalcula totales en servidor (ignora valores del cliente por seguridad)
 * - IVA = 0% (simplificación temporal, cambiar cuando se requiera)
 * - Reserva stock solo al confirmar pago (movimiento VENTA)
 * - RESTAURA STOCK al cancelar orden solo si el pago ya descontó inventario
 * - Usuario autenticado definido en controller (req.user.uid)
 */

import { Timestamp } from "firebase-admin/firestore";
import { firestoreTienda } from "../config/firebase";
import { admin } from "../config/firebase.admin";
import {
  Orden,
  CrearOrdenDTO,
  EstadoOrden,
  FulfillmentMethod,
  FulfillmentStatus,
  ItemOrden,
  ManualShippingStatus,
  PaymentState,
  PreparationStatus,
} from "../models/orden.model";
import { Producto } from "../models/producto.model";
import { COLECCION_PAGOS, EstadoPago, PaymentStatus } from "../models/pago.model";
import { RolUsuario } from "../models/usuario.model";
import { TipoMovimientoInventario } from "../models/inventario.model";
import inventoryService from "./inventory.service";
import adminNotificationService from "./admin-notification.service";
import inventoryReservationService from "./inventory-reservation.service";
import {
  normalizeTallaIds,
} from "../utils/size-inventory.util";
import pickupLocationService from "./pickup-location.service";
import { codigosPromocionService } from "./codigos-promocion.service";
import {
  shippingRefundGuardService,
  ShippingRefundGuardError,
} from "./shipping-refund-guard.service";
import {
  buildFedexTrackingUrl,
  calculateManualShippingCost,
  MANUAL_FEDEX_CARRIER,
  MANUAL_FEDEX_CURRENCY,
  MANUAL_FEDEX_METHOD,
  MANUAL_FEDEX_PROVIDER,
  MANUAL_FEDEX_STATUS,
  resolveManualShippingZone,
} from "../config/manual-shipping.config";
import { getAvailableForVariant } from "../utils/inventory-stock.util";

/**
 * Colección de órdenes en Firestore
 */
const ORDENES_COLLECTION = "ordenes";
const PRODUCTOS_COLLECTION = "productos";

/**
 * Constantes de negocio
 */
const TASA_IVA = 0; // 0% temporal (cambiar a 0.16 cuando se requiera 16%)

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  if (typeof value === "string" && value.trim()) {
    return [value.trim()];
  }

  return [];
}

function buildVariantKey(productoId: string, tallaId?: string) {
  return `${productoId}::${tallaId ?? "__GLOBAL__"}`;
}

function isUnpaidPendingOrder(orden: {
  estado?: EstadoOrden;
  paymentStatus?: PaymentState | string;
}): boolean {
  if (orden.estado !== EstadoOrden.PENDIENTE) {
    return false;
  }
  const paymentStatus = String(orden.paymentStatus || PaymentState.PENDIENTE)
    .trim()
    .toUpperCase();
  return paymentStatus !== PaymentState.PAGADO;
}

/**
 * Clase OrdenService
 * Encapsula las operaciones de creación y gestión de órdenes
 */
export class OrdenService {
  private async enqueueOrderNotificationEvent(
    eventType: "order_created" | "order_shipped" | "order_delivered",
    orden: Orden,
  ): Promise<void> {
    try {
      const { default: notificationEventService } =
        await import("./notifications/notification-event.service");
      await notificationEventService.enqueueEvent({
        eventType,
        userId: orden.usuarioId,
        orderId: orden.id,
        sourceData: {
          orderTotal: orden.total,
          metodoPago: orden.metodoPago,
          estado: orden.estado,
        },
        triggerSource: "orden_service",
      });
    } catch (error) {
      console.error("⚠️ No se pudo encolar evento de notificación de orden:", {
        eventType,
        orderId: orden.id,
        message: error instanceof Error ? error.message : error,
      });
    }
  }

  private resolveStockContextForItem(
    producto: Producto,
    item: { cantidad: number; tallaId?: string; productoId: string },
  ): { available: number; tallaId?: string } {
    const productData = producto as unknown as Record<string, unknown>;
    const tallaIds = normalizeTallaIds(producto.tallaIds);

    if (tallaIds.length === 0) {
      if (item.tallaId?.trim()) {
        throw new Error(
          `El producto "${producto.descripcion}" no maneja inventario por talla`,
        );
      }

      return {
        available: getAvailableForVariant(productData, null),
      };
    }

    const tallaId = item.tallaId?.trim();
    if (!tallaId) {
      throw new Error(
        `Se requiere tallaId para "${producto.descripcion}" al crear la orden`,
      );
    }

    if (!tallaIds.includes(tallaId)) {
      throw new Error(
        `La talla "${tallaId}" no es válida para "${producto.descripcion}"`,
      );
    }

    return {
      available: getAvailableForVariant(productData, tallaId),
      tallaId,
    };
  }

  private normalizeDireccionEnvio(
    address?: Orden["direccionEnvio"],
  ): Orden["direccionEnvio"] | undefined {
    if (!address) {
      return undefined;
    }

    const raw = address as NonNullable<Orden["direccionEnvio"]> & {
      nombreCompleto?: string;
      numeroExterior?: string;
      pais?: string;
    };

    return {
      ...raw,
      nombre: raw.nombre || raw.nombreCompleto || "",
      nombreCompleto: raw.nombreCompleto || raw.nombre,
      numero: raw.numero || raw.numeroExterior || "",
      numeroExterior: raw.numeroExterior || raw.numero,
      pais: raw.pais || "Mexico",
    };
  }

  private requireManualFedexAddress(
    address?: Orden["direccionEnvio"],
  ): NonNullable<Orden["direccionEnvio"]> {
    const normalized = this.normalizeDireccionEnvio(address);
    const missing: string[] = [];

    if (!normalized?.nombre) missing.push("nombreCompleto");
    if (!normalized?.telefono) missing.push("telefono");
    if (!normalized?.calle) missing.push("calle");
    if (!normalized?.numero) missing.push("numeroExterior");
    if (!normalized?.colonia) missing.push("colonia");
    if (!normalized?.ciudad) missing.push("ciudad");
    if (!normalized?.estado) missing.push("estado");
    if (!normalized?.codigoPostal) missing.push("codigoPostal");

    if (missing.length > 0 || !normalized) {
      throw new Error(
        `La direccion de envio esta incompleta. Faltan: ${missing.join(", ")}`,
      );
    }

    return normalized;
  }

  private buildManualFedexShippingSnapshot(
    address: NonNullable<Orden["direccionEnvio"]>,
    existing?: Record<string, any>,
  ): Record<string, any> {
    const shippingAmount = calculateManualShippingCost(address.codigoPostal);
    const shippingZone = resolveManualShippingZone(address.codigoPostal);

    return {
      ...(existing || {}),
      method: "MANUAL",
      provider: MANUAL_FEDEX_PROVIDER,
      carrier: MANUAL_FEDEX_CARRIER,
      shippingMethod: MANUAL_FEDEX_METHOD,
      serviceName: existing?.serviceName || "FedEx manual",
      amount: shippingAmount,
      currency: MANUAL_FEDEX_CURRENCY,
      status: existing?.status || MANUAL_FEDEX_STATUS,
      address,
      addressValidationStatus: "USER_CONFIRMED",
      createdManually: true,
      shippingZone,
      quotedAt: existing?.quotedAt || new Date().toISOString(),
    };
  }

  /**
   * Crea una nueva orden de compra
   * REGLAS DE NEGOCIO:
   * - Valida existencia de todos los productos
   * - Valida stock disponible para cada producto
   * - Recalcula precios desde Firestore (ignora precios del cliente)
   * - Calcula subtotal, impuestos (0%) y total
   * - REDUCE STOCK de productos automáticamente (transacciones Firestore)
   * - Establece estado PENDIENTE
   * - Genera timestamps automáticamente
   *
   * @param data - Datos de la orden (los totales y precios se recalculan)
   * @returns Promise con la orden creada incluyendo su ID de Firestore
   * @throws Error si:
   *   - Algún producto no existe
   *   - Algún producto no tiene stock suficiente
   *   - Error al reducir stock (rollback automático)
   *   - Error al guardar en Firestore
   */
  async createOrden(
    data: CrearOrdenDTO,
    options?: { skipStockRevalidation?: boolean },
  ): Promise<Orden> {
    try {
      console.log(
        `📝 Creando orden para usuario: ${data.usuarioId} con ${data.items.length} items`,
      );

      // PASO 1: Validar y obtener información de todos los productos
      const itemsValidados: ItemOrden[] = [];
let subtotalCalculado = 0;
let tieneItemsConOferta = false;
let descuentoCodigoPromocion = 0;
let codigoPromocionSnapshot:
  | {
      codigo: string;
      codigoPromocionId?: string;
      titulo?: string;
    }
  | undefined;

const codigoPromocion =
  typeof data.codigoPromocion === "string"
    ? data.codigoPromocion.trim().toUpperCase()
    : "";

const itemsParaCodigoPromocion: Array<{
  productoId: string;
  cantidad: number;
  precioUnitario: number;
  tallaId?: string | null;
  categoriaIds: string[];
  lineaIds: string[];
}> = [];

const requestedByVariant = new Map<string, number>();
      const pricingItemsByVariant = new Map(
        (data.pricingSnapshot?.items || []).map((item) => [
          `${item.productId}::${item.tallaId ?? "__GLOBAL__"}`,
          item,
        ]),
      );
      const fulfillmentMethod =
        data.fulfillmentMethod ?? FulfillmentMethod.DELIVERY;
      const direccionEnvio =
        fulfillmentMethod === FulfillmentMethod.DELIVERY
          ? this.requireManualFedexAddress(data.direccionEnvio)
          : this.normalizeDireccionEnvio(data.direccionEnvio);
      const shippingSnapshot =
        fulfillmentMethod === FulfillmentMethod.DELIVERY
          ? this.buildManualFedexShippingSnapshot(
              direccionEnvio!,
              data.shipping as Record<string, any> | undefined,
            )
          : undefined;

      let pickupLocationSnapshot: Orden["pickupLocation"] | undefined;
      if (fulfillmentMethod === FulfillmentMethod.PICKUP) {
        if (!data.pickupLocationId) {
          throw new Error("La sucursal de pickup es requerida para PICKUP");
        }
        if (!data.pickupContact) {
          throw new Error("El contacto de pickup es requerido para PICKUP");
        }
        if (typeof data.costoEnvio === "number" && data.costoEnvio > 0) {
          throw new Error("PICKUP no permite costo de envío");
        }
        const pickupLocation = await pickupLocationService.requireActivePickupLocation(
          data.pickupLocationId,
        );
        pickupLocationSnapshot = {
          id: pickupLocation.id!,
          name: pickupLocation.name,
          address: pickupLocation.address,
          city: pickupLocation.city,
          state: pickupLocation.state,
          postalCode: pickupLocation.postalCode,
          country: pickupLocation.country,
          phone: pickupLocation.phone,
          pickupInstructions: pickupLocation.pickupInstructions,
          businessHours: pickupLocation.businessHours,
          preparationCutoffTime: pickupLocation.preparationCutoffTime,
          estimatedPreparationMinutes:
            pickupLocation.estimatedPreparationMinutes,
        };
      }

      for (const item of data.items) {
        // Obtener producto desde Firestore
        const productoDoc = await firestoreTienda
          .collection(PRODUCTOS_COLLECTION)
          .doc(item.productoId)
          .get();

        // Validar existencia
        if (!productoDoc.exists) {
          throw new Error(
            `El producto con ID "${item.productoId}" no existe en el catálogo`,
          );
        }

        const producto = productoDoc.data() as Producto;

        // Validar que esté activo
        if (!producto.activo) {
          throw new Error(
            `El producto "${producto.descripcion}" no está disponible`,
          );
        }

        const stockContext = this.resolveStockContextForItem(producto, item);
        const variantKey = `${item.productoId}::${stockContext.tallaId ?? "__GLOBAL__"}`;
        const requestedSoFar = requestedByVariant.get(variantKey) ?? 0;
        const requestedTotal = requestedSoFar + item.cantidad;

        if (!options?.skipStockRevalidation) {
          // Validar stock disponible
          if (stockContext.available < requestedTotal) {
            throw new Error(
              `Stock insuficiente para "${producto.descripcion}". ` +
                `${stockContext.tallaId ? `Talla: ${stockContext.tallaId}. ` : ""}` +
                `Disponible: ${stockContext.available}, Solicitado: ${requestedTotal}`,
            );
          }
        }
        requestedByVariant.set(variantKey, requestedTotal);

        // Preferir snapshot server-side de checkout cuando exista.
        const pricingSnapshotItem = pricingItemsByVariant.get(
          `${item.productoId}::${stockContext.tallaId ?? "__GLOBAL__"}`,
        );
        const precioUnitario =
          typeof pricingSnapshotItem?.unitPriceFinal === "number"
            ? pricingSnapshotItem.unitPriceFinal
            : producto.precioPublico;
        const subtotalItem =
          typeof pricingSnapshotItem?.subtotalFinal === "number"
            ? pricingSnapshotItem.subtotalFinal
            : precioUnitario * item.cantidad;

        const itemValidado: ItemOrden = {
          productoId: item.productoId,
          cantidad: item.cantidad,
          precioUnitario: precioUnitario, // Precio del servidor
          subtotal: subtotalItem, // Cálculo del servidor
          ...(stockContext.tallaId ? { tallaId: stockContext.tallaId } : {}), // Opcional
        };

        itemsValidados.push(itemValidado);
subtotalCalculado += subtotalItem;

itemsParaCodigoPromocion.push({
  productoId: item.productoId,
  cantidad: item.cantidad,
  precioUnitario,
  tallaId: stockContext.tallaId ?? null,
  categoriaIds: [
    ...toStringArray((producto as any).categoriaIds),
    ...toStringArray((producto as any).categoriasIds),
    ...toStringArray((producto as any).categoryIds),
    ...toStringArray((producto as any).categoriaId),
  ],
  lineaIds: [
    ...toStringArray((producto as any).lineaIds),
    ...toStringArray((producto as any).lineasIds),
    ...toStringArray((producto as any).lineIds),
    ...toStringArray((producto as any).lineaId),
  ],
});

console.log(
  `  ✓ Item validado: ${producto.descripcion} x${item.cantidad} = $${subtotalItem.toFixed(2)}`,
);
      }

      // PASO 1.5: Aplicar ofertas activas en backend antes de código promocional.
      // No se mandan precios desde frontend; aquí se recalculan con datos reales.
      try {
        const ofertasModule = (await import("./ofertas.service")) as any;
        const ofertasService =
          ofertasModule.ofertasService ?? ofertasModule.default;

        if (ofertasService?.calcularPreciosCarrito) {
          const resultadoOfertas = await ofertasService.calcularPreciosCarrito(
            itemsValidados.map((item) => ({
              productoId: item.productoId,
              cantidad: item.cantidad,
              ...(item.tallaId ? { tallaId: item.tallaId } : {}),
            })),
          );

          const ofertasItemsRaw = Array.isArray(resultadoOfertas?.items)
            ? resultadoOfertas.items
            : Array.isArray(resultadoOfertas?.precios)
              ? resultadoOfertas.precios
              : Array.isArray(resultadoOfertas)
                ? resultadoOfertas
                : Object.entries(resultadoOfertas ?? {}).map(
                    ([productoId, value]) => ({
                      productoId,
                      ...(typeof value === "object" && value !== null
                        ? value
                        : {}),
                    }),
                  );

          const ofertasByVariant = new Map<string, any>();

          for (const ofertaItem of ofertasItemsRaw) {
            const productoId = String(
              ofertaItem.productoId ??
                ofertaItem.productId ??
                ofertaItem.id ??
                "",
            );

            if (!productoId) {
              continue;
            }

            ofertasByVariant.set(
              buildVariantKey(productoId, ofertaItem.tallaId ?? undefined),
              ofertaItem,
            );

            ofertasByVariant.set(buildVariantKey(productoId), ofertaItem);
          }

          let subtotalRecalculadoConOfertas = 0;

          for (let index = 0; index < itemsValidados.length; index++) {
            const itemValidado = itemsValidados[index];

            const ofertaItem =
              ofertasByVariant.get(
                buildVariantKey(itemValidado.productoId, itemValidado.tallaId),
              ) ?? ofertasByVariant.get(buildVariantKey(itemValidado.productoId));

            if (!ofertaItem) {
              subtotalRecalculadoConOfertas += itemValidado.subtotal;
              continue;
            }

            let subtotalFinalOferta = Number(
              ofertaItem.subtotalFinal ??
                ofertaItem.totalFinal ??
                ofertaItem.subtotalConOferta,
            );

            let precioFinalOferta = Number(
              ofertaItem.precioFinal ??
                ofertaItem.precioUnitarioFinal ??
                ofertaItem.unitPriceFinal,
            );

            if (
              !Number.isFinite(subtotalFinalOferta) &&
              Number.isFinite(precioFinalOferta)
            ) {
              subtotalFinalOferta = precioFinalOferta * itemValidado.cantidad;
            }

            if (
              !Number.isFinite(precioFinalOferta) &&
              Number.isFinite(subtotalFinalOferta)
            ) {
              precioFinalOferta = subtotalFinalOferta / itemValidado.cantidad;
            }

            const ofertaValida =
              Number.isFinite(subtotalFinalOferta) &&
              subtotalFinalOferta >= 0 &&
              subtotalFinalOferta < itemValidado.subtotal &&
              Number.isFinite(precioFinalOferta) &&
              precioFinalOferta >= 0;

            if (ofertaValida) {
              tieneItemsConOferta = true;
              itemValidado.precioUnitario = roundCurrency(precioFinalOferta);
              itemValidado.subtotal = roundCurrency(subtotalFinalOferta);

              if (itemsParaCodigoPromocion[index]) {
                itemsParaCodigoPromocion[index].precioUnitario =
                  itemValidado.precioUnitario;
              }
            }

            subtotalRecalculadoConOfertas += itemValidado.subtotal;
          }

          subtotalCalculado = roundCurrency(subtotalRecalculadoConOfertas);

          console.log(
            `Ofertas recalculadas en orden | Subtotal final: $${subtotalCalculado.toFixed(2)}`,
          );
        }
      } catch (ofertasError) {
        console.error("No se pudieron calcular ofertas en orden:", ofertasError);
      }

      if (codigoPromocion) {
  if (tieneItemsConOferta) {
    throw new Error(
      "No se puede aplicar un código promocional cuando hay productos con oferta en el carrito.",
    );
  }

  const resultadoCodigo = await codigosPromocionService.validar({
    codigo: codigoPromocion,
    items: itemsParaCodigoPromocion,
  });

  const codigoValido =
    resultadoCodigo.valido !== false &&
    Number(resultadoCodigo.descuentoTotal || 0) > 0 &&
    Number(resultadoCodigo.subtotalFinal || 0) > 0 &&
    Number(resultadoCodigo.subtotalFinal || 0) < subtotalCalculado;

  if (!codigoValido) {
    throw new Error(
      resultadoCodigo.mensaje ||
        "El código promocional no aplica para esta orden",
    );
  }

  descuentoCodigoPromocion = roundCurrency(
    Number(resultadoCodigo.descuentoTotal || 0),
  );

  const itemsCodigo = Array.isArray(resultadoCodigo.items)
    ? resultadoCodigo.items
    : [];

  const codigoItemsByVariant = new Map(
    itemsCodigo.map((item: any) => [
      buildVariantKey(
        String(item.productoId ?? item.productId ?? ""),
        item.tallaId ?? undefined,
      ),
      item,
    ]),
  );

  let subtotalRecalculadoConCodigo = 0;

  for (const itemValidado of itemsValidados) {
    const codigoItem = codigoItemsByVariant.get(
      buildVariantKey(itemValidado.productoId, itemValidado.tallaId),
    );

    if (!codigoItem) {
      subtotalRecalculadoConCodigo += itemValidado.subtotal;
      continue;
    }

    const subtotalFinalCodigo = Number(codigoItem.subtotalFinal);
    const precioFinalCodigo = Number(
      codigoItem.precioFinal ??
        codigoItem.precioUnitarioFinal ??
        (Number.isFinite(subtotalFinalCodigo)
          ? subtotalFinalCodigo / itemValidado.cantidad
          : NaN),
    );

    if (
      Number.isFinite(subtotalFinalCodigo) &&
      subtotalFinalCodigo >= 0 &&
      Number.isFinite(precioFinalCodigo) &&
      precioFinalCodigo >= 0
    ) {
      itemValidado.precioUnitario = roundCurrency(precioFinalCodigo);
      itemValidado.subtotal = roundCurrency(subtotalFinalCodigo);
    }

    subtotalRecalculadoConCodigo += itemValidado.subtotal;
  }

  subtotalCalculado = roundCurrency(
    Number(resultadoCodigo.subtotalFinal || subtotalRecalculadoConCodigo),
  );

  codigoPromocionSnapshot = {
  codigo: codigoPromocion,
  ...(resultadoCodigo.codigoPromocionId
    ? { codigoPromocionId: resultadoCodigo.codigoPromocionId }
    : {}),
  ...(resultadoCodigo.codigoTitulo
    ? { titulo: resultadoCodigo.codigoTitulo }
    : {}),
};

  console.log(
    `🏷️ Código promocional aplicado: ${codigoPromocion} | Descuento: $${descuentoCodigoPromocion.toFixed(2)} | Subtotal final: $${subtotalCalculado.toFixed(2)}`,
  );
}

      // PASO 2: Calcular totales
      const impuestosCalculados = subtotalCalculado * TASA_IVA; // 0% por ahora
      const costoEnvioCalculado =
        fulfillmentMethod === FulfillmentMethod.PICKUP
          ? 0
          : calculateManualShippingCost(direccionEnvio?.codigoPostal);
      const totalCalculado = roundCurrency(
  subtotalCalculado + impuestosCalculados + costoEnvioCalculado,
);
      const pricingSnapshot = data.pricingSnapshot
        ? {
            ...data.pricingSnapshot,
            shippingTotal: costoEnvioCalculado,
            total: totalCalculado,
            ...(shippingSnapshot ? { shipping: shippingSnapshot as any } : {}),
          }
        : undefined;

      console.log(`💰 Totales calculados:`);
      console.log(`   Subtotal: $${subtotalCalculado.toFixed(2)}`);
      console.log(
        `   Impuestos (${TASA_IVA * 100}%): $${impuestosCalculados.toFixed(2)}`,
      );
      console.log(`   Envío: $${costoEnvioCalculado.toFixed(2)}`);
      console.log(`   Total: $${totalCalculado.toFixed(2)}`);

      // PASO 3: Construir orden con datos validados y calculados
      const now = admin.firestore.Timestamp.now();
      const nuevaOrden: Omit<Orden, "id"> = {
        usuarioId: data.usuarioId,
        items: itemsValidados,
        subtotal: subtotalCalculado, // Calculado por servidor
        impuestos: impuestosCalculados, // Calculado por servidor
        total: totalCalculado, // Calculado por servidor
        estado: EstadoOrden.PENDIENTE, // Siempre PENDIENTE al crear
        ...(direccionEnvio ? { direccionEnvio } : {}),
        metodoPago: data.metodoPago,
        fulfillmentMethod,
        fulfillmentStatus: FulfillmentStatus.PENDING_PAYMENT,
        paymentStatus: PaymentState.PENDIENTE,
        preparationStatus: PreparationStatus.WAITING_PAYMENT,
        ...(fulfillmentMethod === FulfillmentMethod.PICKUP
          ? {
              pickupLocationId: data.pickupLocationId,
              pickupLocation: pickupLocationSnapshot,
              pickupInstructions: pickupLocationSnapshot?.pickupInstructions,
              pickupContact: data.pickupContact,
            }
          : {}),
        costoEnvio: costoEnvioCalculado,
        ...(shippingSnapshot ? { shipping: shippingSnapshot } : {}),
        ...(pricingSnapshot ? { pricingSnapshot } : {}),
        ...(data.paymentMetadata ? { paymentMetadata: data.paymentMetadata } : {}),
        ...(typeof data.discountTotal === "number" || descuentoCodigoPromocion > 0
  ? {
      discountTotal: roundCurrency(
        Number(data.discountTotal || 0) + descuentoCodigoPromocion,
      ),
    }
  : {}),
...(descuentoCodigoPromocion > 0
  ? { descuentoCodigoPromocion }
  : {}),
...(codigoPromocionSnapshot
  ? {
      codigoPromocion: codigoPromocionSnapshot.codigo,
      codigoPromocionId: codigoPromocionSnapshot.codigoPromocionId,
      codigoPromocionTitulo: codigoPromocionSnapshot.titulo,
    }
  : {}),
...(typeof data.subtotalOriginal === "number"
  ? { subtotalOriginal: data.subtotalOriginal }
  : {}),
subtotalFinal: subtotalCalculado,
        shippingTotal: costoEnvioCalculado,
        ...(data.currency ? { currency: data.currency } : {}),
        ...(data.clientOrigin ? { clientOrigin: data.clientOrigin } : {}),
        ...(typeof data.advertisingTrackingAllowed === "boolean"
          ? {
              advertisingTrackingAllowed: data.advertisingTrackingAllowed,
            }
          : {}),
        notas: data.notas,
        createdAt: now,
        updatedAt: now,
      };

      // PASO 4: Guardar en Firestore
      const docRef = await firestoreTienda
        .collection(ORDENES_COLLECTION)
        .add(nuevaOrden);

      // PASO 5: El stock se descuenta al confirmar el pago, no al crear la orden.

      // PASO 6: Obtener documento creado con ID
      const ordenCreada: Orden = {
        id: docRef.id,
        ...nuevaOrden,
      };

      console.log(
        `✅ Orden creada exitosamente con ID: ${docRef.id} | Total: $${totalCalculado.toFixed(2)}`,
      );

      // TODO: Notificaciones (ÉPICA 11 - TASK-079):
      // - Enviar email al usuario con detalles de la orden
      // - Registrar en logs de auditoría
      await this.enqueueOrderNotificationEvent("order_created", ordenCreada);
      void adminNotificationService.notifyOrderNew(docRef.id);

      return ordenCreada;
    } catch (error) {
      console.error("❌ Error al crear orden:", error);
      throw new Error(
        error instanceof Error ? error.message : "Error al crear la orden",
      );
    }
  }

  /**
   * Actualiza el estado de una orden existente
   * REGLAS DE NEGOCIO:
   * - Solo propietarios o admins pueden actualizar el estado
   * - Valida que la orden exista
   * - Valida ownership (BOLA prevention según AGENTS.MD)
   * - Admins/empleados pueden actualizar cualquier orden
   * - Clientes solo pueden actualizar sus propias órdenes
   * - Actualiza timestamp automáticamente
   * - Todas las transiciones de estado son permitidas (flexibilidad operativa)
   *
   * @param ordenId - ID de la orden a actualizar
   * @param nuevoEstado - Nuevo estado de la orden
   * @param usuarioActual - Usuario actual con uid y rol
   * @returns Promise con la orden actualizada
   * @throws Error si:
   *   - La orden no existe (404)
   *   - El usuario no tiene permisos (403 - BOLA prevention)
   *   - Error al actualizar en Firestore
   */
  async updateEstadoOrden(
    ordenId: string,
    nuevoEstado: EstadoOrden,
    usuarioActual: { uid: string; rol: RolUsuario },
  ): Promise<Orden> {
    try {
      console.log(
        `🔄 Actualizando estado de orden ${ordenId} a ${nuevoEstado} por usuario ${usuarioActual.uid}`,
      );

      // PASO 1: Obtener orden de Firestore
      const ordenDoc = await firestoreTienda
        .collection(ORDENES_COLLECTION)
        .doc(ordenId)
        .get();

      // PASO 2: Validar que la orden existe
      if (!ordenDoc.exists) {
        throw new Error(`La orden con ID "${ordenId}" no existe`);
      }

      const orden = ordenDoc.data() as Orden;

      // PASO 3: Validar OWNERSHIP (BOLA prevention)
      const esAdmin =
        usuarioActual.rol === RolUsuario.ADMIN ||
        usuarioActual.rol === RolUsuario.EMPLEADO;
      const esPropietario = orden.usuarioId === usuarioActual.uid;

      if (!esAdmin && !esPropietario) {
        throw new Error(
          "No tienes permisos para actualizar el estado de esta orden",
        );
      }

      console.log(
        `  ✓ Permisos validados: ${esAdmin ? "Admin" : "Propietario"}`,
      );

      // PASO 4: Actualizar estado en Firestore
      const now = admin.firestore.Timestamp.now();
      const deliveredAt =
        nuevoEstado === EstadoOrden.ENTREGADA
          ? orden.deliveredAt || now
          : orden.deliveredAt;
      await firestoreTienda.collection(ORDENES_COLLECTION).doc(ordenId).update({
        estado: nuevoEstado,
        ...(deliveredAt ? { deliveredAt } : {}),
        updatedAt: now,
      });

      // PASO 5: Retornar orden actualizada
      const ordenActualizada: Orden = {
        ...orden,
        id: ordenId,
        estado: nuevoEstado,
        deliveredAt,
        updatedAt: now,
      };

      console.log(
        `✅ Estado de orden ${ordenId} actualizado exitosamente a ${nuevoEstado}`,
      );

      if (
        nuevoEstado === EstadoOrden.ENVIADA ||
        nuevoEstado === EstadoOrden.ENTREGADA
      ) {
        await this.enqueueOrderNotificationEvent(
          nuevoEstado === EstadoOrden.ENVIADA
            ? "order_shipped"
            : "order_delivered",
          ordenActualizada,
        );
      }

      return ordenActualizada;
    } catch (error) {
      console.error("❌ Error al actualizar estado de orden:", error);
      throw new Error(
        error instanceof Error
          ? error.message
          : "Error al actualizar el estado de la orden",
      );
    }
  }

  /**
   * Obtiene todas las órdenes con filtros opcionales
   *
   * LÓGICA DE AUTORIZACIÓN (BOLA Prevention):
   * - Clientes: solo ven sus propias órdenes (filtros.usuarioId es obligatorio)
   * - Admins/Empleados: pueden ver todas las órdenes
   *
   * FILTROS SOPORTADOS:
   * - usuarioId: string (obligatorio para clientes, opcional para admins)
   * - estados: string[] (múltiples estados)
   * - fechaDesde: string ISO 8601
   * - fechaHasta: string ISO 8601
   *
   * ORDENAMIENTO:
   * - Siempre por createdAt descendente (más recientes primero)
   *
   * @param filtros - Objeto con filtros opcionales
   * @param usuarioActual - Usuario autenticado (req.user)
   * @returns Promise con array de órdenes que cumplen los filtros
   */
  private isManualFedexOrder(order: Orden): boolean {
    const shipping = order.shipping as Record<string, any> | undefined;
    return (
      order.fulfillmentMethod !== FulfillmentMethod.PICKUP &&
      (shipping?.provider === MANUAL_FEDEX_PROVIDER ||
        shipping?.shippingMethod === MANUAL_FEDEX_METHOD)
    );
  }

  private async assertOrderIsPaid(orderId: string): Promise<void> {
    const snapshot = await firestoreTienda
      .collection(COLECCION_PAGOS)
      .where("ordenId", "==", orderId)
      .get();

    const hasPaidPayment = snapshot.docs.some((doc) => {
      const pago = doc.data() as {
        estado?: EstadoPago;
        status?: PaymentStatus | string;
      };
      return (
        pago.estado === EstadoPago.COMPLETADO ||
        pago.status === PaymentStatus.PAID
      );
    });

    if (!hasPaidPayment) {
      throw new Error("Solo se puede actualizar envio de ordenes con pago confirmado");
    }
  }

  private async requireManualShippingOrder(
    orderId: string,
  ): Promise<{ ref: FirebaseFirestore.DocumentReference; order: Orden }> {
    const ref = firestoreTienda.collection(ORDENES_COLLECTION).doc(orderId);
    const snapshot = await ref.get();
    if (!snapshot.exists) {
      throw new Error(`La orden con ID "${orderId}" no existe`);
    }

    const order = { id: snapshot.id, ...(snapshot.data() as Orden) };
    if (order.estado === EstadoOrden.CANCELADA) {
      throw new Error("No se puede actualizar envio de una orden cancelada");
    }

    if (order.fulfillmentMethod === FulfillmentMethod.PICKUP) {
      throw new Error("Las ordenes pickup no permiten guia de envio");
    }

    if (!this.isManualFedexOrder(order)) {
      throw new Error("La orden no usa envio manual FedEx");
    }

    await this.assertOrderIsPaid(orderId);
    return { ref, order };
  }

  private buildHistoryEntry(input: {
    type: "shipping_status_change" | "fulfillment_status_change";
    from?: string;
    to: string;
    changedBy: string;
    note?: string;
  }) {
    return {
      type: input.type,
      from: input.from || "",
      to: input.to,
      changedBy: input.changedBy,
      changedAt: admin.firestore.Timestamp.now(),
      ...(input.note ? { note: input.note } : {}),
    };
  }

  async markManualShippingPreparing(
    orderId: string,
    adminId: string,
    note?: string,
  ): Promise<Orden> {
    const { ref, order } = await this.requireManualShippingOrder(orderId);
    const now = admin.firestore.Timestamp.now();
    const currentShipping = (order.shipping || {}) as Record<string, any>;
    const nextShipping = {
      ...currentShipping,
      status: ManualShippingStatus.PREPARING,
      updatedAt: now,
    };
    const historyEntry = this.buildHistoryEntry({
      type: "fulfillment_status_change",
      from: String(order.fulfillmentStatus || ""),
      to: FulfillmentStatus.PREPARING,
      changedBy: adminId,
      note,
    });

    await ref.update({
      estado: EstadoOrden.EN_PROCESO,
      fulfillmentStatus: FulfillmentStatus.PREPARING,
      preparationStatus: PreparationStatus.PREPARING,
      shipping: nextShipping,
      updatedByAdminId: adminId,
      updatedAt: now,
      shippingHistory: admin.firestore.FieldValue.arrayUnion(historyEntry),
    });

    return {
      ...order,
      estado: EstadoOrden.EN_PROCESO,
      fulfillmentStatus: FulfillmentStatus.PREPARING,
      preparationStatus: PreparationStatus.PREPARING,
      shipping: nextShipping,
      updatedByAdminId: adminId,
      updatedAt: now,
      shippingHistory: [...(order.shippingHistory || []), historyEntry],
    };
  }

  async markManualShippingReadyToShip(
    orderId: string,
    adminId: string,
    note?: string,
  ): Promise<Orden> {
    const { ref, order } = await this.requireManualShippingOrder(orderId);
    const now = admin.firestore.Timestamp.now();
    const currentShipping = (order.shipping || {}) as Record<string, any>;
    const nextShipping = {
      ...currentShipping,
      status: ManualShippingStatus.READY_TO_SHIP,
      updatedAt: now,
    };
    const historyEntry = this.buildHistoryEntry({
      type: "shipping_status_change",
      from: String(currentShipping.status || ""),
      to: ManualShippingStatus.READY_TO_SHIP,
      changedBy: adminId,
      note,
    });

    await ref.update({
      shipping: nextShipping,
      preparationStatus: PreparationStatus.READY_TO_SHIP,
      updatedByAdminId: adminId,
      updatedAt: now,
      shippingHistory: admin.firestore.FieldValue.arrayUnion(historyEntry),
    });

    return {
      ...order,
      shipping: nextShipping,
      preparationStatus: PreparationStatus.READY_TO_SHIP,
      updatedByAdminId: adminId,
      updatedAt: now,
      shippingHistory: [...(order.shippingHistory || []), historyEntry],
    };
  }

  async captureManualFedexTracking(
    orderId: string,
    adminId: string,
    input: {
      trackingNumber: string;
      serviceName?: string;
      realShippingCost?: number;
      receiptUrl?: string;
      guidePdfUrl?: string;
      notes?: string;
    },
  ): Promise<Orden> {
    const trackingNumber = input.trackingNumber.trim();
    if (!trackingNumber) {
      throw new Error("trackingNumber es obligatorio");
    }

    const { ref, order } = await this.requireManualShippingOrder(orderId);
    const now = admin.firestore.Timestamp.now();
    const currentShipping = (order.shipping || {}) as Record<string, any>;
    const trackingUrl = buildFedexTrackingUrl(trackingNumber);
    const nextShipping = {
      ...currentShipping,
      status: ManualShippingStatus.DELIVERED_TO_CARRIER,
      trackingNumber,
      trackingUrl,
      serviceName: input.serviceName || currentShipping.serviceName,
      shippedAt: currentShipping.shippedAt || now,
      updatedAt: now,
      manualEvidence: {
        ...(currentShipping.manualEvidence || {}),
        ...(typeof input.realShippingCost === "number"
          ? { realShippingCost: input.realShippingCost }
          : {}),
        ...(input.receiptUrl ? { receiptUrl: input.receiptUrl } : {}),
        ...(input.guidePdfUrl ? { guidePdfUrl: input.guidePdfUrl } : {}),
        ...(input.notes ? { notes: input.notes } : {}),
      },
    };
    const historyEntry = this.buildHistoryEntry({
      type: "shipping_status_change",
      from: String(currentShipping.status || ""),
      to: ManualShippingStatus.DELIVERED_TO_CARRIER,
      changedBy: adminId,
      note: input.notes,
    });

    await ref.update({
      estado: EstadoOrden.ENVIADA,
      preparationStatus: PreparationStatus.SHIPPED,
      shipping: nextShipping,
      numeroGuia: trackingNumber,
      transportista: "FEDEX",
      updatedByAdminId: adminId,
      updatedAt: now,
      shippingHistory: admin.firestore.FieldValue.arrayUnion(historyEntry),
    });

    await this.enqueueOrderNotificationEvent("order_shipped", {
      ...order,
      id: orderId,
      estado: EstadoOrden.ENVIADA,
      shipping: nextShipping,
      numeroGuia: trackingNumber,
      transportista: "FEDEX",
      updatedAt: now,
    });

    return {
      ...order,
      estado: EstadoOrden.ENVIADA,
      preparationStatus: PreparationStatus.SHIPPED,
      shipping: nextShipping,
      numeroGuia: trackingNumber,
      transportista: "FEDEX",
      updatedByAdminId: adminId,
      updatedAt: now,
      shippingHistory: [...(order.shippingHistory || []), historyEntry],
    };
  }

  async updateManualShippingStatus(
    orderId: string,
    adminId: string,
    input: { status: ManualShippingStatus; note?: string },
  ): Promise<Orden> {
    const { ref, order } = await this.requireManualShippingOrder(orderId);
    const now = admin.firestore.Timestamp.now();
    const currentShipping = (order.shipping || {}) as Record<string, any>;
    const nextShipping = {
      ...currentShipping,
      status: input.status,
      ...(input.status === "DELIVERED" && !currentShipping.deliveredAt
        ? { deliveredAt: now }
        : {}),
      updatedAt: now,
    };
    const historyEntry = this.buildHistoryEntry({
      type: "shipping_status_change",
      from: String(currentShipping.status || ""),
      to: input.status,
      changedBy: adminId,
      note: input.note,
    });
    const nextEstado =
      input.status === ManualShippingStatus.DELIVERED
        ? EstadoOrden.ENTREGADA
        : input.status === ManualShippingStatus.IN_TRANSIT
          ? EstadoOrden.ENVIADA
          : order.estado;
    const nextPreparationStatus =
      input.status === ManualShippingStatus.DELIVERED
        ? PreparationStatus.DELIVERED
        : input.status === ManualShippingStatus.INCIDENT
          ? PreparationStatus.INCIDENT
          : input.status === ManualShippingStatus.RETURNED
            ? PreparationStatus.RETURNED
            : order.preparationStatus ?? PreparationStatus.SHIPPED;

    await ref.update({
      estado: nextEstado,
      preparationStatus: nextPreparationStatus,
      shipping: nextShipping,
      ...(input.status === ManualShippingStatus.DELIVERED ? { deliveredAt: now } : {}),
      updatedByAdminId: adminId,
      updatedAt: now,
      shippingHistory: admin.firestore.FieldValue.arrayUnion(historyEntry),
    });

    const updatedOrder = {
      ...order,
      estado: nextEstado,
      preparationStatus: nextPreparationStatus,
      shipping: nextShipping,
      ...(input.status === ManualShippingStatus.DELIVERED ? { deliveredAt: now } : {}),
      updatedByAdminId: adminId,
      updatedAt: now,
      shippingHistory: [...(order.shippingHistory || []), historyEntry],
    };

    if (input.status === "DELIVERED") {
      await this.enqueueOrderNotificationEvent("order_delivered", updatedOrder);
    }

    return updatedOrder;
  }

  async getAllOrdenes(filtros: any, usuarioActual: any): Promise<Orden[]> {
    try {
      console.log("📋 Obteniendo órdenes con filtros:", filtros);

      // Construir query base
      let query: FirebaseFirestore.Query =
        firestoreTienda.collection(ORDENES_COLLECTION);

      // FILTRO 1: Por usuario (ownership)
      if (filtros.usuarioId) {
        query = query.where("usuarioId", "==", filtros.usuarioId);
      }

      // FILTRO 2: Por múltiples estados (usando 'in' operator)
      if (filtros.estados && Array.isArray(filtros.estados)) {
        // Firestore 'in' query soporta hasta 10 valores
        if (filtros.estados.length > 0 && filtros.estados.length <= 10) {
          query = query.where("estado", "in", filtros.estados);
        } else if (filtros.estados.length > 10) {
          console.warn(
            "⚠️ Firestore 'in' query limitado a 10 valores. Ignorando filtro de estados.",
          );
        }
      }

      // FILTRO 3: Por rango de fechas
      if (filtros.fechaDesde) {
        // Convertir ISO 8601 string a Firestore Timestamp
        const fechaDesdeDate = new Date(filtros.fechaDesde);
        const timestampDesde =
          admin.firestore.Timestamp.fromDate(fechaDesdeDate);
        query = query.where("createdAt", ">=", timestampDesde);
      }

      if (filtros.fechaHasta) {
        const fechaHastaDate = new Date(filtros.fechaHasta);
        const timestampHasta =
          admin.firestore.Timestamp.fromDate(fechaHastaDate);
        query = query.where("createdAt", "<=", timestampHasta);
      }

      // ORDENAMIENTO: Siempre por fecha descendente
      query = query.orderBy("createdAt", "desc");

      // Ejecutar query
      const snapshot = await query.get();

      // Mapear documentos a objetos Orden
      const ordenes: Orden[] = snapshot.docs.map((doc) => {
        const data = doc.data();
        return {
          id: doc.id,
          usuarioId: data.usuarioId,
          items: data.items,
          subtotal: data.subtotal,
          impuestos: data.impuestos,
          total: data.total,
          estado: data.estado as EstadoOrden,
          direccionEnvio: data.direccionEnvio,
          metodoPago: data.metodoPago,
          transaccionId: data.transaccionId,
          referenciaPago: data.referenciaPago,
          numeroGuia: data.numeroGuia,
          transportista: data.transportista,
          costoEnvio: data.costoEnvio,
          shipping: data.shipping,
          pricingSnapshot: data.pricingSnapshot,
          discountTotal: data.discountTotal,
          subtotalOriginal: data.subtotalOriginal,
          subtotalFinal: data.subtotalFinal,
          shippingTotal: data.shippingTotal,
          currency: data.currency,
          shippingHistory: data.shippingHistory,
          updatedByAdminId: data.updatedByAdminId,
          notas: data.notas,
          deliveredAt: data.deliveredAt,
          fulfillmentMethod: data.fulfillmentMethod,
          fulfillmentStatus: data.fulfillmentStatus,
          paymentStatus: data.paymentStatus,
          preparationStatus: data.preparationStatus,
          pickupLocationId: data.pickupLocationId,
          pickupLocation: data.pickupLocation,
          pickupInstructions: data.pickupInstructions,
          pickupContact: data.pickupContact,
          pickupCodeLast4: data.pickupCodeLast4,
          pickupQrPayload: data.pickupQrPayload,
          readyForPickupAt: data.readyForPickupAt,
          pickedUpAt: data.pickedUpAt,
          pickedUpBy: data.pickedUpBy,
          deliveredByStaffUid: data.deliveredByStaffUid,
          pickupExpiresAt: data.pickupExpiresAt,
          createdAt: data.createdAt,
          updatedAt: data.updatedAt,
        };
      });

      const userRole = usuarioActual?.rol as RolUsuario | undefined;
      const esAdmin =
        userRole === RolUsuario.ADMIN || userRole === RolUsuario.EMPLEADO;

      const visibleOrdenes = esAdmin
        ? ordenes
        : ordenes.filter((orden) => !isUnpaidPendingOrder(orden));

      console.log(`✅ Se encontraron ${visibleOrdenes.length} órdenes`);
      return visibleOrdenes;
    } catch (error) {
      console.error("❌ Error al obtener órdenes:", error);

      // Detectar errores de índices faltantes de Firestore
      if (error instanceof Error && error.message.includes("index")) {
        console.error(
          "⚠️ ÍNDICE DE FIRESTORE FALTANTE. Ejecutar: firebase deploy --only firestore:indexes",
        );
        console.error(
          "   O crear índice desde la consola Firebase (el error incluye link)",
        );
      }

      throw new Error(
        error instanceof Error ? error.message : "Error al obtener las órdenes",
      );
    }
  }

  /**
   * Obtiene una orden específica por ID
   *
   * LÓGICA DE AUTORIZACIÓN (BOLA Prevention):
   * - Valida que la orden exista
   * - Valida ownership: solo el propietario o admins pueden ver la orden
   *
   * @param ordenId - ID de la orden
   * @param usuarioActual - Usuario autenticado (req.user)
   * @returns Promise con la orden o null si no existe
   * @throws Error si el usuario no tiene permisos para ver la orden
   */
  async getOrdenById(
    ordenId: string,
    usuarioActual: any,
  ): Promise<Orden | null> {
    try {
      console.log(
        `📋 Obteniendo orden ${ordenId} para usuario ${usuarioActual.uid}`,
      );

      // Obtener documento de Firestore
      const ordenDoc = await firestoreTienda
        .collection(ORDENES_COLLECTION)
        .doc(ordenId)
        .get();

      // Validar existencia
      if (!ordenDoc.exists) {
        return null;
      }

      const data = ordenDoc.data();
      if (!data) {
        return null;
      }

      // VALIDACIÓN DE OWNERSHIP (BOLA Prevention)
      const userRole = usuarioActual.rol as RolUsuario;
      const esAdmin =
        userRole === RolUsuario.ADMIN || userRole === RolUsuario.EMPLEADO;
      const esPropietario = data.usuarioId === usuarioActual.uid;

      if (!esAdmin && !esPropietario) {
        throw new Error(
          "No tienes permisos para acceder a esta orden. Solo puedes ver tus propias órdenes.",
        );
      }

      if (
        !esAdmin &&
        isUnpaidPendingOrder({
          estado: data.estado as EstadoOrden,
          paymentStatus: data.paymentStatus as PaymentState | string,
        })
      ) {
        return null;
      }

      // Mapear a objeto Orden
      const orden: Orden = {
        id: ordenDoc.id,
        usuarioId: data.usuarioId,
        items: data.items,
        subtotal: data.subtotal,
        impuestos: data.impuestos,
        total: data.total,
        estado: data.estado as EstadoOrden,
        direccionEnvio: data.direccionEnvio,
        metodoPago: data.metodoPago,
        transaccionId: data.transaccionId,
        referenciaPago: data.referenciaPago,
        numeroGuia: data.numeroGuia,
        transportista: data.transportista,
        costoEnvio: data.costoEnvio,
        shipping: data.shipping,
        pricingSnapshot: data.pricingSnapshot,
        discountTotal: data.discountTotal,
        subtotalOriginal: data.subtotalOriginal,
        subtotalFinal: data.subtotalFinal,
        shippingTotal: data.shippingTotal,
        currency: data.currency,
        shippingHistory: data.shippingHistory,
        updatedByAdminId: data.updatedByAdminId,
        notas: data.notas,
        deliveredAt: data.deliveredAt,
        fulfillmentMethod: data.fulfillmentMethod,
        fulfillmentStatus: data.fulfillmentStatus,
        paymentStatus: data.paymentStatus,
        preparationStatus: data.preparationStatus,
        pickupLocationId: data.pickupLocationId,
        pickupLocation: data.pickupLocation,
        pickupInstructions: data.pickupInstructions,
        pickupContact: data.pickupContact,
        pickupCodeLast4: data.pickupCodeLast4,
        pickupQrPayload: data.pickupQrPayload,
        readyForPickupAt: data.readyForPickupAt,
        pickedUpAt: data.pickedUpAt,
        pickedUpBy: data.pickedUpBy,
        deliveredByStaffUid: data.deliveredByStaffUid,
        pickupExpiresAt: data.pickupExpiresAt,
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
      };

      console.log(`✅ Orden ${ordenId} obtenida exitosamente`);
      return orden;
    } catch (error) {
      console.error(`❌ Error al obtener orden ${ordenId}:`, error);
      throw new Error(
        error instanceof Error ? error.message : "Error al obtener la orden",
      );
    }
  }

  /**
   * Obtiene una orden específica por ID con información populada
   * (productos y usuario)
   *
   * POPULATE:
   * - Información de productos: clave, descripción, imágenes
   * - Información de usuario: nombre, email, telefono
   *
   * LÓGICA DE AUTORIZACIÓN (BOLA Prevention):
   * - Valida que la orden exista
   * - Valida ownership: solo el propietario o admins pueden ver la orden
   *
   * @param ordenId - ID de la orden
   * @param usuarioActual - Usuario autenticado (req.user)
   * @returns Promise con OrdenDetallada o null si no existe
   * @throws Error si el usuario no tiene permisos para ver la orden
   */
  async getOrdenByIdConPopulate(
    ordenId: string,
    usuarioActual: any,
  ): Promise<any> {
    try {
      console.log(
        `📋 Obteniendo orden ${ordenId} con populate para usuario ${usuarioActual.uid}`,
      );

      // PASO 1: Obtener orden base (incluye validación de ownership)
      const orden = await this.getOrdenById(ordenId, usuarioActual);

      if (!orden) {
        return null;
      }

      // PASO 2: Populate información de productos
      const itemsDetallados = await Promise.all(
        orden.items.map(async (item) => {
          try {
            const productoDoc = await firestoreTienda
              .collection(PRODUCTOS_COLLECTION)
              .doc(item.productoId)
              .get();

            if (productoDoc.exists) {
              const productoData = productoDoc.data();
              return {
                ...item,
                producto: {
                  clave: productoData?.clave || "N/A",
                  descripcion:
                    productoData?.descripcion || "Producto no disponible",
                  imagenes: productoData?.imagenes || [],
                },
              };
            } else {
              // Producto eliminado o no encontrado
              return {
                ...item,
                producto: {
                  clave: "N/A",
                  descripcion: "Producto no disponible",
                  imagenes: [],
                },
              };
            }
          } catch (error) {
            console.error(
              `Error al obtener producto ${item.productoId}:`,
              error,
            );
            return {
              ...item,
              producto: {
                clave: "ERROR",
                descripcion: "Error al cargar producto",
                imagenes: [],
              },
            };
          }
        }),
      );

      // PASO 3: Populate información de usuario
      let usuarioInfo = {
        nombre: "Usuario no disponible",
        email: "N/A",
        telefono: undefined,
      };

      try {
        const usuarioDoc = await firestoreTienda
          .collection("usuarios")
          .doc(orden.usuarioId)
          .get();

        if (usuarioDoc.exists) {
          const usuarioData = usuarioDoc.data();
          usuarioInfo = {
            nombre: usuarioData?.nombre || "Usuario",
            email: usuarioData?.email || "N/A",
            telefono: usuarioData?.telefono,
          };
        }
      } catch (error) {
        console.error(`Error al obtener usuario ${orden.usuarioId}:`, error);
        // Continuar con valores por defecto
      }

      // PASO 4: Construir respuesta con información populada
      const ordenDetallada = {
        ...orden,
        usuario: usuarioInfo,
        itemsDetallados: itemsDetallados,
      };

      console.log(`✅ Orden ${ordenId} obtenida con populate exitosamente`);
      return ordenDetallada;
    } catch (error) {
      console.error(
        `❌ Error al obtener orden ${ordenId} con populate:`,
        error,
      );
      throw new Error(
        error instanceof Error ? error.message : "Error al obtener la orden",
      );
    }
  }

  /**
   * Cancela una orden existente y restaura el stock de productos
   * REGLAS DE NEGOCIO (TASK-049):
   * - Solo se pueden cancelar órdenes en estado PENDIENTE o CONFIRMADA
   * - Valida ownership: admins/empleados pueden cancelar cualquier orden
   * - Clientes pueden cancelar sus propias órdenes
   * - Cambia el estado a CANCELADA
   * - Restaura stock de todos los productos automáticamente
   * - Actualiza timestamp automáticamente
   *
   * SEGURIDAD (BOLA prevention - AGENTS.MD):
   * - Valida que el usuario sea admin/empleado O propietario de la orden
   * - Evita cancelación de órdenes ajenas sin permisos
   *
   * @param ordenId - ID de la orden a cancelar
   * @param usuarioActual - Usuario actual con uid y rol
   * @returns Promise con la orden cancelada
   * @throws Error si:
   *   - La orden no existe (404)
   *   - El usuario no tiene permisos (403 - BOLA prevention)
   *   - La orden no está en estado PENDIENTE o CONFIRMADA (400)
   *   - Error al restaurar stock
   *   - Error al actualizar en Firestore
   */
  async cancelarOrden(
    ordenId: string,
    usuarioActual: { uid: string; rol: RolUsuario },
  ): Promise<Orden> {
    try {
      console.log(
        `🚫 Cancelando orden ${ordenId} por usuario ${usuarioActual.uid}`,
      );

      // PASO 1: Obtener orden de Firestore
      const ordenDoc = await firestoreTienda
        .collection(ORDENES_COLLECTION)
        .doc(ordenId)
        .get();

      // PASO 2: Validar que la orden existe
      if (!ordenDoc.exists) {
        throw new Error(`La orden con ID "${ordenId}" no existe`);
      }

      const orden = ordenDoc.data() as Orden;

      // PASO 3: Validar OWNERSHIP (BOLA prevention)
      const esAdmin =
        usuarioActual.rol === RolUsuario.ADMIN ||
        usuarioActual.rol === RolUsuario.EMPLEADO;
      const esPropietario = orden.usuarioId === usuarioActual.uid;

      if (!esAdmin && !esPropietario) {
        throw new Error(
          "No tienes permisos para cancelar esta orden. Solo puedes cancelar tus propias órdenes.",
        );
      }

      console.log(
        `  ✓ Permisos validados: ${esAdmin ? "Admin/Empleado" : "Propietario"}`,
      );

      // PASO 4: Validar que el estado permite cancelación (solo PENDIENTE o CONFIRMADA)
      const estadosCancelables = [
        EstadoOrden.PENDIENTE,
        EstadoOrden.CONFIRMADA,
      ];
      if (!estadosCancelables.includes(orden.estado)) {
        throw new Error(
          `No se puede cancelar una orden en estado "${orden.estado}". ` +
            `Solo se pueden cancelar órdenes en estado PENDIENTE o CONFIRMADA.`,
        );
      }

      console.log(`  ✓ Estado validado: ${orden.estado} (puede cancelarse)`);

      try {
        await shippingRefundGuardService.ensureShipmentCanProceedToRefund({
          orderId: ordenId,
          order: orden,
          reason: "Cancelación de orden",
          requestedByUid: usuarioActual.uid,
        });
      } catch (error) {
        if (error instanceof ShippingRefundGuardError) {
          throw new Error(error.message);
        }
        throw error;
      }

      const stockWasCommitted =
        await inventoryService.orderHasSaleMovements(ordenId);

      if (stockWasCommitted) {
        console.log(`📦 Restaurando stock de ${orden.items.length} productos...`);
        try {
          for (const item of orden.items) {
            await inventoryService.registerMovement({
              tipo: TipoMovimientoInventario.DEVOLUCION,
              productoId: item.productoId,
              tallaId: item.tallaId,
              cantidad: item.cantidad,
              ordenId,
              referencia: ordenId,
              motivo: "Devolución por cancelación de orden",
              usuarioId: orden.usuarioId,
              idempotencyKey: `cancel:${ordenId}:${item.productoId}:${item.tallaId ?? "_"}`,
            });
          }
          console.log(`✅ Stock restaurado exitosamente`);
        } catch (stockError) {
          console.error(
            `⚠️ Error al restaurar stock (orden se cancelará de todas formas):`,
            stockError,
          );
        }
      } else {
        const hasActiveReservations =
          await inventoryReservationService.orderHasActiveReservations(ordenId);
        if (hasActiveReservations) {
          await inventoryReservationService.releaseOrderReservations({
            ordenId,
            motivo: "Liberación por cancelación de orden sin venta confirmada",
            usuarioId: orden.usuarioId,
          });
          console.log(`✅ Reservas de inventario liberadas para orden ${ordenId}`);
        } else {
          console.log(
            `ℹ️ Orden ${ordenId} sin movimiento de venta ni reservas activas`,
          );
        }
      }

      // PASO 6: Actualizar estado a CANCELADA en Firestore
      const now = admin.firestore.Timestamp.now();
      await firestoreTienda.collection(ORDENES_COLLECTION).doc(ordenId).update({
        estado: EstadoOrden.CANCELADA,
        updatedAt: now,
      });

      // PASO 7: Retornar orden cancelada
      const ordenCancelada: Orden = {
        ...orden,
        id: ordenId,
        estado: EstadoOrden.CANCELADA,
        updatedAt: now,
      };

      console.log(`✅ Orden ${ordenId} cancelada exitosamente`);

      // TODO: Enviar notificación al usuario de cancelación (ÉPICA 11 - TASK-080)

      return ordenCancelada;
    } catch (error) {
      console.error("❌ Error al cancelar orden:", error);
      throw new Error(
        error instanceof Error ? error.message : "Error al cancelar la orden",
      );
    }
  }

  /**
   * Obtiene el historial de órdenes de un usuario específico con paginación cursor-based
   *
   * FILTROS DISPONIBLES:
   * - estados: array de EstadoOrden (filtro 'in', max 10 valores)
   * - fechaDesde: string ISO 8601
   * - fechaHasta: string ISO 8601
   *
   * PAGINACIÓN:
   * - limit: cantidad de resultados por página (default 10)
   * - cursor: ID del último documento de la página anterior (Firestore startAfter)
   *
   * ORDENAMIENTO:
   * - Siempre por createdAt descendente (más recientes primero)
   *
   * @param usuarioId - UID del usuario (Firebase Auth UID)
   * @param filtros - Objeto con filtros opcionales (estados, fechaDesde, fechaHasta)
   * @param paginacion - Objeto con limit y cursor opcional
   * @returns Promise con objeto { ordenes, nextCursor }
   */
  async getOrdenesByUsuario(
    usuarioId: string,
    filtros: {
      estados?: string[];
      fechaDesde?: string;
      fechaHasta?: string;
    },
    paginacion: { limit: number; cursor?: string },
  ): Promise<{ ordenes: Orden[]; nextCursor: string | null }> {
    try {
      console.log(
        `📋 Obteniendo historial de órdenes para usuario: ${usuarioId}`,
      );

      // Construir query base: siempre filtrar por usuario
      let query: FirebaseFirestore.Query = firestoreTienda
        .collection(ORDENES_COLLECTION)
        .where("usuarioId", "==", usuarioId);

      // FILTRO: Por múltiples estados (usando 'in' operator)
      if (filtros.estados && filtros.estados.length > 0) {
        if (filtros.estados.length <= 10) {
          query = query.where("estado", "in", filtros.estados);
        } else {
          console.warn(
            "⚠️ Firestore 'in' query limitado a 10 valores. Ignorando filtro de estados.",
          );
        }
      }

      // FILTRO: Por rango de fechas
      if (filtros.fechaDesde) {
        const fechaDesdeDate = new Date(filtros.fechaDesde);
        const timestampDesde =
          admin.firestore.Timestamp.fromDate(fechaDesdeDate);
        query = query.where("createdAt", ">=", timestampDesde);
      }

      if (filtros.fechaHasta) {
        const fechaHastaDate = new Date(filtros.fechaHasta);
        const timestampHasta =
          admin.firestore.Timestamp.fromDate(fechaHastaDate);
        query = query.where("createdAt", "<=", timestampHasta);
      }

      // ORDENAMIENTO: Siempre por fecha descendente
      query = query.orderBy("createdAt", "desc");

      // PAGINACIÓN: Cursor-based con startAfter
      if (paginacion.cursor) {
        const cursorDoc = await firestoreTienda
          .collection(ORDENES_COLLECTION)
          .doc(paginacion.cursor)
          .get();

        if (!cursorDoc.exists) {
          throw new Error(
            `Cursor inválido: la orden con ID "${paginacion.cursor}" no existe`,
          );
        }

        query = query.startAfter(cursorDoc);
      }

      // Pedir limit + 1 para saber si hay más páginas
      query = query.limit(paginacion.limit + 1);

      // Ejecutar query
      const snapshot = await query.get();

      // Determinar si hay siguiente página
      const hasNextPage = snapshot.docs.length > paginacion.limit;
      const docs = hasNextPage
        ? snapshot.docs.slice(0, paginacion.limit)
        : snapshot.docs;

      // Mapear documentos a objetos Orden
      const ordenes: Orden[] = docs.map((doc) => {
        const data = doc.data();
        return {
          id: doc.id,
          usuarioId: data.usuarioId,
          items: data.items,
          subtotal: data.subtotal,
          impuestos: data.impuestos,
          total: data.total,
          estado: data.estado as EstadoOrden,
          direccionEnvio: data.direccionEnvio,
          metodoPago: data.metodoPago,
          transaccionId: data.transaccionId,
          referenciaPago: data.referenciaPago,
          numeroGuia: data.numeroGuia,
          transportista: data.transportista,
          costoEnvio: data.costoEnvio,
          shipping: data.shipping,
          pricingSnapshot: data.pricingSnapshot,
          discountTotal: data.discountTotal,
          subtotalOriginal: data.subtotalOriginal,
          subtotalFinal: data.subtotalFinal,
          shippingTotal: data.shippingTotal,
          currency: data.currency,
          shippingHistory: data.shippingHistory,
          updatedByAdminId: data.updatedByAdminId,
          notas: data.notas,
          deliveredAt: data.deliveredAt,
          fulfillmentMethod: data.fulfillmentMethod,
          fulfillmentStatus: data.fulfillmentStatus,
          paymentStatus: data.paymentStatus,
          preparationStatus: data.preparationStatus,
          pickupLocationId: data.pickupLocationId,
          pickupLocation: data.pickupLocation,
          pickupInstructions: data.pickupInstructions,
          pickupContact: data.pickupContact,
          pickupCodeLast4: data.pickupCodeLast4,
          pickupQrPayload: data.pickupQrPayload,
          readyForPickupAt: data.readyForPickupAt,
          pickedUpAt: data.pickedUpAt,
          pickedUpBy: data.pickedUpBy,
          deliveredByStaffUid: data.deliveredByStaffUid,
          pickupExpiresAt: data.pickupExpiresAt,
          createdAt: data.createdAt,
          updatedAt: data.updatedAt,
        };
      });

      // Calcular nextCursor (ID del último documento de esta página)
      const nextCursor = hasNextPage ? docs[docs.length - 1].id : null;

      console.log(
        `✅ Se encontraron ${ordenes.length} órdenes para usuario ${usuarioId} (hasNextPage: ${hasNextPage})`,
      );

      return { ordenes, nextCursor };
    } catch (error) {
      console.error("❌ Error al obtener historial de órdenes:", error);

      if (error instanceof Error && error.message.includes("index")) {
        console.error(
          "⚠️ ÍNDICE DE FIRESTORE FALTANTE. Ejecutar: firebase deploy --only firestore:indexes",
        );
      }

      throw new Error(
        error instanceof Error
          ? error.message
          : "Error al obtener el historial de órdenes",
      );
    }
  }

  async getOrderStatusForAssistant(input: {
    orderId: string;
    authUser?: { uid: string; rol: RolUsuario };
    phone?: string;
  }): Promise<{
    orderId: string;
    estado: EstadoOrden;
    total: number;
    metodoPago: string;
    numeroGuia?: string;
    transportista?: string;
    createdAt: Timestamp;
    updatedAt: Timestamp;
  } | null> {
    const ordenDoc = await firestoreTienda
      .collection(ORDENES_COLLECTION)
      .doc(input.orderId)
      .get();

    if (!ordenDoc.exists) {
      return null;
    }

    const orden = ordenDoc.data() as Orden;
    const isPrivileged =
      input.authUser?.rol === RolUsuario.ADMIN ||
      input.authUser?.rol === RolUsuario.EMPLEADO;
    const isOwner =
      Boolean(input.authUser?.uid) && orden.usuarioId === input.authUser?.uid;
    const normalizedPhone = (input.phone || "").replace(/\D/g, "");
    const matchesPhone =
      normalizedPhone.length >= 8 &&
      String(orden.direccionEnvio?.telefono || "").replace(/\D/g, "") ===
        normalizedPhone;

    if (!isPrivileged && !isOwner && !matchesPhone) {
      throw new Error(
        "No hay autorizacion suficiente para consultar el estado de este pedido",
      );
    }

    return {
      orderId: ordenDoc.id,
      estado: orden.estado,
      total: orden.total,
      metodoPago: orden.metodoPago,
      numeroGuia: orden.numeroGuia,
      transportista: orden.transportista,
      createdAt: orden.createdAt,
      updatedAt: orden.updatedAt,
    };
  }

  /**
   * Descuenta inventario cuando el pago queda confirmado.
   * Es idempotente: si ya existen movimientos VENTA para la orden, no duplica.
   */
  async commitStockForOrder(ordenId: string): Promise<void> {
    if (!ordenId) {
      return;
    }

    if (await inventoryService.orderHasSaleMovements(ordenId)) {
      return;
    }

    if (await inventoryReservationService.orderHasActiveReservations(ordenId)) {
      const ordenDoc = await firestoreTienda
        .collection(ORDENES_COLLECTION)
        .doc(ordenId)
        .get();
      const orden = ordenDoc.exists ? (ordenDoc.data() as Orden) : undefined;
      await inventoryReservationService.confirmOrderReservations(
        ordenId,
        orden?.usuarioId,
      );
      return;
    }

    const ordenDoc = await firestoreTienda
      .collection(ORDENES_COLLECTION)
      .doc(ordenId)
      .get();

    if (!ordenDoc.exists) {
      throw new Error(`La orden con ID "${ordenId}" no existe`);
    }

    const orden = ordenDoc.data() as Orden;

    for (const item of orden.items) {
      await inventoryService.registerMovement({
        tipo: TipoMovimientoInventario.VENTA,
        productoId: item.productoId,
        tallaId: item.tallaId,
        cantidad: item.cantidad,
        ordenId,
        referencia: ordenId,
        motivo: "Venta confirmada por pago",
        usuarioId: orden.usuarioId,
        idempotencyKey: `paid:${ordenId}:${item.productoId}:${item.tallaId ?? "_"}`,
      });
    }
  }

  /**
   * Libera reservas pendientes y cancela una orden cuyo pago no se completó.
   */
  async releaseUnpaidOrder(ordenId: string): Promise<void> {
    if (!ordenId) {
      return;
    }

    const ordenDoc = await firestoreTienda
      .collection(ORDENES_COLLECTION)
      .doc(ordenId)
      .get();

    if (!ordenDoc.exists) {
      return;
    }

    const orden = ordenDoc.data() as Orden;
    if (orden.estado === EstadoOrden.CANCELADA) {
      return;
    }

    if (
      orden.estado !== EstadoOrden.PENDIENTE &&
      orden.estado !== EstadoOrden.CONFIRMADA
    ) {
      return;
    }

    await this.cancelarOrden(ordenId, {
      uid: "system-payment-failure",
      rol: RolUsuario.ADMIN,
    });
  }
}

// Exportar instancia singleton
const ordenService = new OrdenService();
export default ordenService;
