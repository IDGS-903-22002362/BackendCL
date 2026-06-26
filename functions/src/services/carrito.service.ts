/**
 * Servicio de Carrito de Compras
 * Maneja toda la lógica de negocio del carrito para usuarios autenticados y anónimos
 *
 * RESPONSABILIDADES:
 * - CRUD de items en el carrito
 * - Validación de stock y existencia de productos
 * - Cálculo de totales (subtotal, total)
 * - Populate de información de productos
 * - Merge de carritos (sesión → usuario al autenticarse)
 *
 * SEGURIDAD:
 * - precioUnitario SIEMPRE se lee del producto (precioPublico), nunca del cliente
 * - Cantidades se validan contra stock real (existencias)
 * - Totales se recalculan en cada operación de escritura
 */

import { firestoreTienda } from "../config/firebase";
import { Timestamp } from "firebase-admin/firestore";
import {
  Carrito,
  ItemCarrito,
  CarritoPopulado,
  AgregarItemCarritoDTO,
  MAX_CANTIDAD_POR_ITEM,
} from "../models/carrito.model";
import {
  Orden,
  CrearOrdenDTO,
  DireccionEnvio,
  MetodoPago,
  FulfillmentMethod,
  PickupContact,
} from "../models/orden.model";
import {
  CheckoutShippingAddress,
  CheckoutShippingSelection,
} from "../models/checkout-pricing.model";
import ordenService from "./orden.service";
import {
  completeInventarioPorTalla,
  normalizeTallaIds,
} from "../utils/size-inventory.util";
import { checkoutPricingService } from "./checkout/checkout-pricing.service";
import {
  getAvailableForVariant,
  getPhysicalForVariant,
} from "../utils/inventory-stock.util";
import type { CartItemStockStatus } from "../models/checkout-unavailable-item.model";

/**
 * Nombre de la colección en Firestore
 */
const CARRITOS_COLLECTION = "carritos";
const PRODUCTOS_COLLECTION = "productos";

/**
 * Clase CarritoService
 * Encapsula las operaciones de carrito de compras
 */
export class CarritoService {
  private resolveStockContext(
    prodData: Record<string, any>,
    tallaId?: string,
  ): {
    available: number;
    tallaId?: string;
    usesInventoryBySize: boolean;
  } {
    const tallaIds = normalizeTallaIds(prodData.tallaIds);
    const usesInventoryBySize = tallaIds.length > 0;

    if (!usesInventoryBySize) {
      if (tallaId?.trim()) {
        throw new Error(
          `El producto "${prodData.descripcion || "seleccionado"}" no maneja inventario por talla`,
        );
      }

      return {
        available: Math.max(0, Math.floor(Number(prodData.existencias ?? 0))),
        usesInventoryBySize: false,
      };
    }

    const tallaIdNormalizada = tallaId?.trim();
    if (!tallaIdNormalizada) {
      throw new Error(
        `Se requiere seleccionar una talla para "${prodData.descripcion || "el producto"}"`,
      );
    }

    if (!tallaIds.includes(tallaIdNormalizada)) {
      throw new Error(
        `La talla "${tallaIdNormalizada}" no es válida para "${prodData.descripcion || "el producto"}"`,
      );
    }

    const inventarioPorTalla = completeInventarioPorTalla(
      tallaIds,
      prodData.inventarioPorTalla,
    );
    const inventarioTalla = inventarioPorTalla.find(
      (item) => item.tallaId === tallaIdNormalizada,
    );

    return {
      available: inventarioTalla?.cantidad ?? 0,
      tallaId: tallaIdNormalizada,
      usesInventoryBySize: true,
    };
  }

  private resolveCartItemAvailability(
    prodData: Record<string, unknown> | undefined,
    item: ItemCarrito,
  ): {
    disponible: number;
    stockFisico: number;
    stockStatus: CartItemStockStatus;
    purchasable: boolean;
  } {
    if (!prodData) {
      return {
        disponible: 0,
        stockFisico: 0,
        stockStatus: "out_of_stock",
        purchasable: false,
      };
    }

    const activo = prodData.activo !== false;
    let disponible = 0;
    let tallaForPhysical: string | null | undefined = item.tallaId;

    try {
      const stock = this.resolveStockContext(
        prodData as Record<string, any>,
        item.tallaId,
      );
      disponible = getAvailableForVariant(prodData, stock.tallaId ?? null);
      tallaForPhysical = stock.tallaId;
    } catch {
      disponible = 0;
    }

    const stockFisico = getPhysicalForVariant(prodData, tallaForPhysical ?? null);
    let stockStatus: CartItemStockStatus = "available";

    if (!activo) {
      stockStatus = "out_of_stock";
    } else if (disponible < item.cantidad) {
      stockStatus =
        disponible === 0 && stockFisico > 0
          ? "temporarily_unavailable"
          : "out_of_stock";
    }

    return {
      disponible,
      stockFisico,
      stockStatus,
      purchasable: activo && disponible >= item.cantidad,
    };
  }

  // ===================================
  // Métodos de Lectura
  // ===================================

  /**
   * Obtiene o crea un carrito para el usuario/sesión actual
   * Busca primero por usuarioId (autenticado), luego por sessionId (anónimo)
   * Si no existe, crea un carrito vacío
   *
   * @param usuarioId - UID de Firebase Auth (opcional)
   * @param sessionId - UUID de sesión anónima (opcional)
   * @returns Promise con el carrito encontrado o creado
   * @throws Error si no se proporciona ni usuarioId ni sessionId
   */
  async getOrCreateCart(
    usuarioId?: string,
    sessionId?: string,
  ): Promise<Carrito> {
    if (!usuarioId && !sessionId) {
      throw new Error(
        "Se requiere usuarioId o sessionId para identificar el carrito",
      );
    }

    try {
      // Buscar carrito existente
      let carrito = await this.findCart(usuarioId, sessionId);

      if (carrito) {
        return carrito;
      }

      // Crear carrito vacío
      const now = Timestamp.now();
      const nuevoCarrito: Omit<Carrito, "id"> = {
        ...(usuarioId ? { usuarioId } : {}),
        ...(sessionId && !usuarioId ? { sessionId } : {}),
        items: [],
        subtotal: 0,
        total: 0,
        createdAt: now,
        updatedAt: now,
      };

      const docRef = await firestoreTienda
        .collection(CARRITOS_COLLECTION)
        .add(nuevoCarrito);

      console.log(
        `🛒 Carrito creado: ${docRef.id} para ${usuarioId ? `usuario ${usuarioId}` : `sesión ${sessionId}`}`,
      );

      return {
        id: docRef.id,
        ...nuevoCarrito,
      } as Carrito;
    } catch (error) {
      console.error("❌ Error en getOrCreateCart:", error);
      throw new Error("Error al obtener o crear el carrito");
    }
  }

  /**
   * Busca un carrito existente por usuarioId o sessionId
   *
   * @param usuarioId - UID de Firebase Auth (opcional)
   * @param sessionId - UUID de sesión (opcional)
   * @returns Promise con el carrito o null si no existe
   */
  private async findCart(
    usuarioId?: string,
    sessionId?: string,
  ): Promise<Carrito | null> {
    // Buscar por usuarioId primero (tiene prioridad)
    if (usuarioId) {
      const snapshot = await firestoreTienda
        .collection(CARRITOS_COLLECTION)
        .where("usuarioId", "==", usuarioId)
        .limit(1)
        .get();

      if (!snapshot.empty) {
        const doc = snapshot.docs[0];
        return { id: doc.id, ...doc.data() } as Carrito;
      }
    }

    // Buscar por sessionId
    if (sessionId) {
      const snapshot = await firestoreTienda
        .collection(CARRITOS_COLLECTION)
        .where("sessionId", "==", sessionId)
        .limit(1)
        .get();

      if (!snapshot.empty) {
        const doc = snapshot.docs[0];
        return { id: doc.id, ...doc.data() } as Carrito;
      }
    }

    return null;
  }

  /**
   * Obtiene un carrito con información populada de productos
   * Incluye clave, descripción, imágenes, existencias y precio actual
   *
   * @param cartId - ID del carrito en Firestore
   * @returns Promise con el carrito populado
   * @throws Error si el carrito no existe
   */
  async getCartPopulado(cartId: string): Promise<CarritoPopulado> {
    try {
      const doc = await firestoreTienda
        .collection(CARRITOS_COLLECTION)
        .doc(cartId)
        .get();

      if (!doc.exists) {
        throw new Error(`Carrito con ID "${cartId}" no encontrado`);
      }

      const carrito = { id: doc.id, ...doc.data() } as Carrito;
      const totals = this.recalculateTotals(carrito.items || []);
      const needsTotalsSync =
        carrito.subtotal !== totals.subtotal || carrito.total !== totals.total;

      if (needsTotalsSync) {
        await firestoreTienda
          .collection(CARRITOS_COLLECTION)
          .doc(cartId)
          .update({
            subtotal: totals.subtotal,
            total: totals.total,
            updatedAt: Timestamp.now(),
          });

        carrito.subtotal = totals.subtotal;
        carrito.total = totals.total;
      }

      // Si el carrito está vacío, retornar sin populate
      if (!carrito.items || carrito.items.length === 0) {
        return {
          ...carrito,
          itemsDetallados: [],
        };
      }

      // Obtener IDs únicos de productos para batch read
      const productIds = [
        ...new Set(carrito.items.map((item) => item.productoId)),
      ];

      // Batch read de productos (máximo 10 en paralelo para Firestore)
      const productDocs = await Promise.all(
        productIds.map((id) =>
          firestoreTienda.collection(PRODUCTOS_COLLECTION).doc(id).get(),
        ),
      );

      // Crear mapa de productos para acceso rápido
      const productMap = new Map<string, any>();
      productDocs.forEach((prodDoc) => {
        if (prodDoc.exists) {
          productMap.set(prodDoc.id, prodDoc.data());
        }
      });

      // Populate items con información de productos
      const itemsDetallados = carrito.items.map((item) => {
        const prodData = productMap.get(item.productoId);

        if (!prodData) {
          const availability = this.resolveCartItemAvailability(undefined, item);
          return {
            ...item,
            ...availability,
            producto: {
              clave: "N/A",
              descripcion: "Producto no disponible",
              imagenes: [],
              existencias: 0,
              precioPublico: item.precioUnitario,
              activo: false,
            },
          };
        }

        const availability = this.resolveCartItemAvailability(prodData, item);

        return {
          ...item,
          ...availability,
          producto: {
            clave: prodData.clave || "N/A",
            descripcion: prodData.descripcion || "Sin descripción",
            imagenes: prodData.imagenes || [],
            existencias: availability.disponible,
            stockFisico: availability.stockFisico,
            stockStatus: availability.stockStatus,
            purchasable: availability.purchasable,
            precioPublico: prodData.precioPublico || 0,
            activo: prodData.activo ?? false,
          },
        };
      });

      return {
        ...carrito,
        itemsDetallados,
      };
    } catch (error) {
      if (error instanceof Error && error.message.includes("no encontrado")) {
        throw error;
      }
      console.error("❌ Error en getCartPopulado:", error);
      throw new Error("Error al obtener el carrito con detalles");
    }
  }

  // ===================================
  // Métodos de Escritura
  // ===================================

  /**
   * Agrega un item al carrito
   * Si el producto ya existe en el carrito, suma las cantidades
   * El precioUnitario se obtiene del producto (precioPublico), nunca del cliente
   *
   * @param cartId - ID del carrito
   * @param itemDTO - Datos del item a agregar (productoId, cantidad, tallaId?)
   * @returns Promise con el carrito actualizado
   * @throws Error si el producto no existe, no está activo, o no tiene stock
   */
  async addItem(
    cartId: string,
    itemDTO: AgregarItemCarritoDTO,
  ): Promise<Carrito> {
    try {
      // 1. Validar que el producto existe y está activo
      const prodDoc = await firestoreTienda
        .collection(PRODUCTOS_COLLECTION)
        .doc(itemDTO.productoId)
        .get();

      if (!prodDoc.exists) {
        throw new Error(`Producto con ID "${itemDTO.productoId}" no existe`);
      }

      const prodData = prodDoc.data()!;

      if (!prodData.activo) {
        throw new Error(
          `Producto "${prodData.descripcion || itemDTO.productoId}" no está disponible`,
        );
      }

      const stockContext = this.resolveStockContext(prodData, itemDTO.tallaId);

      // 2. Obtener el carrito actual
      const cartDoc = await firestoreTienda
        .collection(CARRITOS_COLLECTION)
        .doc(cartId)
        .get();

      if (!cartDoc.exists) {
        throw new Error(`Carrito con ID "${cartId}" no encontrado`);
      }

      const carrito = { id: cartDoc.id, ...cartDoc.data() } as Carrito;
      const items = [...(carrito.items || [])];

      // 3. Buscar si el producto ya está en el carrito (mismo productoId y tallaId)
      const existingIndex = items.findIndex(
        (item) =>
          item.productoId === itemDTO.productoId &&
          item.tallaId === stockContext.tallaId,
      );

      let cantidadTotal: number;

      if (existingIndex >= 0) {
        // Producto ya existe → sumar cantidades
        cantidadTotal = items[existingIndex].cantidad + itemDTO.cantidad;
      } else {
        cantidadTotal = itemDTO.cantidad;
      }

      // 4. Validar cantidad total contra límite y stock
      if (cantidadTotal > MAX_CANTIDAD_POR_ITEM) {
        throw new Error(
          `La cantidad máxima por producto es ${MAX_CANTIDAD_POR_ITEM}. ` +
            `Cantidad actual en carrito: ${existingIndex >= 0 ? items[existingIndex].cantidad : 0}, ` +
            `intentando agregar: ${itemDTO.cantidad}`,
        );
      }

      if (cantidadTotal > stockContext.available) {
        throw new Error(
          `Stock insuficiente para "${prodData.descripcion || itemDTO.productoId}". ` +
            `${stockContext.tallaId ? `Talla: ${stockContext.tallaId}. ` : ""}` +
            `Disponible: ${stockContext.available}, solicitado: ${cantidadTotal}`,
        );
      }

      // 5. Actualizar o agregar item (precioUnitario del servidor)
      const precioUnitario = prodData.precioPublico;

      if (existingIndex >= 0) {
        items[existingIndex] = {
          ...items[existingIndex],
          cantidad: cantidadTotal,
          precioUnitario, // Actualizar precio al actual
        };
      } else {
        const newItem: ItemCarrito = {
          productoId: itemDTO.productoId,
          cantidad: itemDTO.cantidad,
          precioUnitario,
          ...(stockContext.tallaId ? { tallaId: stockContext.tallaId } : {}),
        };
        items.push(newItem);
      }

      // 6. Recalcular totales y guardar
      const { subtotal, total } = this.recalculateTotals(items);

      await firestoreTienda.collection(CARRITOS_COLLECTION).doc(cartId).update({
        items,
        subtotal,
        total,
        updatedAt: Timestamp.now(),
      });

      console.log(
        `🛒 Item agregado al carrito ${cartId}: ${itemDTO.productoId} x${itemDTO.cantidad}`,
      );

      return {
        ...carrito,
        items,
        subtotal,
        total,
        updatedAt: Timestamp.now(),
      };
    } catch (error) {
      if (error instanceof Error) {
        // Re-throw business errors
        if (
          error.message.includes("no existe") ||
          error.message.includes("no está disponible") ||
          error.message.includes("Stock insuficiente") ||
          error.message.includes("talla") ||
          error.message.includes("cantidad máxima") ||
          error.message.includes("no encontrado")
        ) {
          throw error;
        }
      }
      console.error("❌ Error en addItem:", error);
      throw new Error("Error al agregar item al carrito");
    }
  }

  /**
   * Actualiza la cantidad de un item en el carrito
   * Si cantidad es 0, elimina el item
   *
   * @param cartId - ID del carrito
   * @param productoId - ID del producto a actualizar
   * @param cantidad - Nueva cantidad (0 para eliminar)
   * @param tallaId - ID de talla (opcional, para diferenciar variantes)
   * @returns Promise con el carrito actualizado
   * @throws Error si el item no existe en el carrito o stock insuficiente
   */
  async updateItemQuantity(
    cartId: string,
    productoId: string,
    cantidad: number,
    tallaId?: string,
  ): Promise<Carrito> {
    try {
      // Si cantidad es 0, delegar a removeItem
      if (cantidad === 0) {
        return this.removeItem(cartId, productoId, tallaId);
      }

      // 1. Obtener carrito
      const cartDoc = await firestoreTienda
        .collection(CARRITOS_COLLECTION)
        .doc(cartId)
        .get();

      if (!cartDoc.exists) {
        throw new Error(`Carrito con ID "${cartId}" no encontrado`);
      }

      const carrito = { id: cartDoc.id, ...cartDoc.data() } as Carrito;
      const items = [...(carrito.items || [])];

      // 2. Buscar item en el carrito
      const itemIndex = items.findIndex(
        (item) =>
          item.productoId === productoId &&
          (tallaId ? item.tallaId === tallaId : true),
      );

      if (itemIndex < 0) {
        throw new Error(`Producto "${productoId}" no encontrado en el carrito`);
      }

      // 3. Validar stock
      const prodDoc = await firestoreTienda
        .collection(PRODUCTOS_COLLECTION)
        .doc(productoId)
        .get();

      if (prodDoc.exists) {
        const prodData = prodDoc.data()!;
        const stockContext = this.resolveStockContext(
          prodData,
          items[itemIndex].tallaId ?? tallaId,
        );

        if (cantidad > stockContext.available) {
          throw new Error(
            `Stock insuficiente para "${prodData.descripcion || productoId}". ` +
              `${stockContext.tallaId ? `Talla: ${stockContext.tallaId}. ` : ""}` +
              `Disponible: ${stockContext.available}, solicitado: ${cantidad}`,
          );
        }

        // Actualizar precio al actual
        items[itemIndex] = {
          ...items[itemIndex],
          cantidad,
          precioUnitario: prodData.precioPublico,
          ...(stockContext.tallaId ? { tallaId: stockContext.tallaId } : {}),
        };
      } else {
        // Producto eliminado, actualizar cantidad sin cambiar precio
        items[itemIndex] = {
          ...items[itemIndex],
          cantidad,
        };
      }

      // 4. Recalcular y guardar
      const { subtotal, total } = this.recalculateTotals(items);

      await firestoreTienda.collection(CARRITOS_COLLECTION).doc(cartId).update({
        items,
        subtotal,
        total,
        updatedAt: Timestamp.now(),
      });

      console.log(
        `🛒 Cantidad actualizada en carrito ${cartId}: ${productoId} → ${cantidad}`,
      );

      return {
        ...carrito,
        items,
        subtotal,
        total,
        updatedAt: Timestamp.now(),
      };
    } catch (error) {
      if (error instanceof Error) {
        if (
          error.message.includes("no encontrado") ||
          error.message.includes("Stock insuficiente") ||
          error.message.includes("talla")
        ) {
          throw error;
        }
      }
      console.error("❌ Error en updateItemQuantity:", error);
      throw new Error("Error al actualizar cantidad del item");
    }
  }

  /**
   * Elimina un item del carrito
   *
   * @param cartId - ID del carrito
   * @param productoId - ID del producto a eliminar
   * @param tallaId - ID de talla (opcional)
   * @returns Promise con el carrito actualizado
   * @throws Error si el item no existe en el carrito
   */
  async removeItem(
    cartId: string,
    productoId: string,
    tallaId?: string,
  ): Promise<Carrito> {
    try {
      const cartDoc = await firestoreTienda
        .collection(CARRITOS_COLLECTION)
        .doc(cartId)
        .get();

      if (!cartDoc.exists) {
        throw new Error(`Carrito con ID "${cartId}" no encontrado`);
      }

      const carrito = { id: cartDoc.id, ...cartDoc.data() } as Carrito;
      const items = [...(carrito.items || [])];

      // Buscar item
      const itemIndex = items.findIndex(
        (item) =>
          item.productoId === productoId &&
          (tallaId ? item.tallaId === tallaId : true),
      );

      if (itemIndex < 0) {
        throw new Error(`Producto "${productoId}" no encontrado en el carrito`);
      }

      // Eliminar item
      items.splice(itemIndex, 1);

      // Recalcular y guardar
      const { subtotal, total } = this.recalculateTotals(items);

      await firestoreTienda.collection(CARRITOS_COLLECTION).doc(cartId).update({
        items,
        subtotal,
        total,
        updatedAt: Timestamp.now(),
      });

      console.log(`🛒 Item eliminado del carrito ${cartId}: ${productoId}`);

      return {
        ...carrito,
        items,
        subtotal,
        total,
        updatedAt: Timestamp.now(),
      };
    } catch (error) {
      if (error instanceof Error && error.message.includes("no encontrado")) {
        throw error;
      }
      console.error("❌ Error en removeItem:", error);
      throw new Error("Error al eliminar item del carrito");
    }
  }

  /**
   * Vacía completamente el carrito (elimina todos los items)
   *
   * @param cartId - ID del carrito
   * @returns Promise con el carrito vacío
   * @throws Error si el carrito no existe
   */
  async clearCart(cartId: string): Promise<Carrito> {
    try {
      const cartDoc = await firestoreTienda
        .collection(CARRITOS_COLLECTION)
        .doc(cartId)
        .get();

      if (!cartDoc.exists) {
        throw new Error(`Carrito con ID "${cartId}" no encontrado`);
      }

      const carrito = { id: cartDoc.id, ...cartDoc.data() } as Carrito;

      await firestoreTienda.collection(CARRITOS_COLLECTION).doc(cartId).update({
        items: [],
        subtotal: 0,
        total: 0,
        updatedAt: Timestamp.now(),
      });

      console.log(`🛒 Carrito vaciado: ${cartId}`);

      return {
        ...carrito,
        items: [],
        subtotal: 0,
        total: 0,
        updatedAt: Timestamp.now(),
      };
    } catch (error) {
      if (error instanceof Error && error.message.includes("no encontrado")) {
        throw error;
      }
      console.error("❌ Error en clearCart:", error);
      throw new Error("Error al vaciar el carrito");
    }
  }

  /**
   * Fusiona un carrito de sesión (anónimo) con el carrito de un usuario autenticado
   * Los items del carrito de sesión se agregan al carrito del usuario.
   * Si un producto ya existe en ambos, las cantidades se suman (respetando límites).
   * El carrito de sesión se elimina después del merge.
   *
   * @param sessionId - UUID de la sesión anónima
   * @param usuarioId - UID de Firebase Auth del usuario autenticado
   * @returns Promise con el carrito del usuario después del merge
   */
  async mergeCarts(sessionId: string, usuarioId: string): Promise<Carrito> {
    try {
      // 1. Buscar carrito de sesión
      const sessionSnapshot = await firestoreTienda
        .collection(CARRITOS_COLLECTION)
        .where("sessionId", "==", sessionId)
        .limit(1)
        .get();

      if (sessionSnapshot.empty) {
        // No hay carrito de sesión, retornar carrito de usuario (o crear uno)
        console.log(
          `🛒 Merge: No se encontró carrito de sesión ${sessionId}. Retornando carrito de usuario.`,
        );
        return this.getOrCreateCart(usuarioId);
      }

      const sessionCartDoc = sessionSnapshot.docs[0];
      const sessionCart = {
        id: sessionCartDoc.id,
        ...sessionCartDoc.data(),
      } as Carrito;

      // 2. Obtener o crear carrito de usuario
      const userCart = await this.getOrCreateCart(usuarioId);

      // 3. Si el carrito de sesión está vacío, solo eliminarlo
      if (!sessionCart.items || sessionCart.items.length === 0) {
        await firestoreTienda
          .collection(CARRITOS_COLLECTION)
          .doc(sessionCartDoc.id)
          .delete();
        return userCart;
      }

      // 4. Merge items
      const mergedItems = [...(userCart.items || [])];

      for (const sessionItem of sessionCart.items) {
        // Verificar que el producto sigue existiendo y activo
        const prodDoc = await firestoreTienda
          .collection(PRODUCTOS_COLLECTION)
          .doc(sessionItem.productoId)
          .get();

        if (!prodDoc.exists || !prodDoc.data()?.activo) {
          // Producto no disponible, omitir
          console.log(
            `🛒 Merge: Omitiendo producto no disponible ${sessionItem.productoId}`,
          );
          continue;
        }

        const prodData = prodDoc.data()!;
        let stockContext: {
          available: number;
          tallaId?: string;
          usesInventoryBySize: boolean;
        } | null = null;

        try {
          stockContext = this.resolveStockContext(
            prodData,
            sessionItem.tallaId,
          );
        } catch (_stockError) {
          console.log(
            `🛒 Merge: Omitiendo variante no válida ${sessionItem.productoId}/${sessionItem.tallaId || "sin-talla"}`,
          );
          continue;
        }

        if (!stockContext) {
          continue;
        }

        const resolvedStockContext = stockContext;

        // Buscar si el producto ya existe en el carrito del usuario
        const existingIndex = mergedItems.findIndex(
          (item) =>
            item.productoId === sessionItem.productoId &&
            item.tallaId === resolvedStockContext.tallaId,
        );

        if (existingIndex >= 0) {
          // Sumar cantidades, respetando límites
          const newQuantity = Math.min(
            mergedItems[existingIndex].cantidad + sessionItem.cantidad,
            MAX_CANTIDAD_POR_ITEM,
            resolvedStockContext.available,
          );
          mergedItems[existingIndex] = {
            ...mergedItems[existingIndex],
            cantidad: newQuantity,
            precioUnitario: prodData.precioPublico, // Actualizar precio
          };
        } else {
          // Agregar nuevo item, respetando stock
          const quantity = Math.min(
            sessionItem.cantidad,
            MAX_CANTIDAD_POR_ITEM,
            resolvedStockContext.available,
          );
          if (quantity > 0) {
            mergedItems.push({
              productoId: sessionItem.productoId,
              cantidad: quantity,
              precioUnitario: prodData.precioPublico,
              ...(resolvedStockContext.tallaId
                ? { tallaId: resolvedStockContext.tallaId }
                : {}),
            });
          }
        }
      }

      // 5. Recalcular totales
      const { subtotal, total } = this.recalculateTotals(mergedItems);

      // 6. Guardar carrito de usuario actualizado
      await firestoreTienda
        .collection(CARRITOS_COLLECTION)
        .doc(userCart.id!)
        .update({
          items: mergedItems,
          subtotal,
          total,
          updatedAt: Timestamp.now(),
        });

      // 7. Eliminar carrito de sesión
      await firestoreTienda
        .collection(CARRITOS_COLLECTION)
        .doc(sessionCartDoc.id)
        .delete();

      console.log(
        `🛒 Merge completado: sesión ${sessionId} → usuario ${usuarioId}. ` +
          `Items en carrito: ${mergedItems.length}`,
      );

      return {
        ...userCart,
        items: mergedItems,
        subtotal,
        total,
        updatedAt: Timestamp.now(),
      };
    } catch (error) {
      console.error("❌ Error en mergeCarts:", error);
      throw new Error("Error al fusionar los carritos");
    }
  }

  // ===================================
  // Checkout
  // ===================================

  /**
   * Convierte el carrito del usuario en una orden de compra
   *
   * FLUJO:
   * 1. Obtiene el carrito del usuario autenticado
   * 2. Valida que el carrito tenga items (no vacío)
   * 3. Mapea ItemCarrito[] → ItemOrden[] (agrega subtotal por item)
   * 4. Construye CrearOrdenDTO con datos del carrito + checkout data
   * 5. Delega a OrdenService.createOrden() para:
   *    - Validar existencia y stock de cada producto
   *    - Recalcular precios desde el servidor (seguridad)
   *    - Crear la orden en Firestore
   *    - Decrementar stock con transacciones atómicas
   * 6. El carrito se vacía solo cuando el pago queda confirmado
   * 7. Si falla la creación, el carrito queda intacto (rollback)
   *
   * @param usuarioId - UID de Firebase Auth del usuario
   * @param checkoutData - Datos de checkout: direccionEnvio, metodoPago, costoEnvio?, notas?
   * @returns Promise con la orden creada
   * @throws Error si el carrito está vacío
   * @throws Error si algún producto no tiene stock (propagado desde OrdenService)
   * @throws Error si falla la creación de la orden
   */
  async buildCheckoutOrderDraft(
    usuarioId: string,
    checkoutData: {
      fulfillmentMethod?: FulfillmentMethod | string;
      direccionEnvio?: DireccionEnvio;
      pickupLocationId?: string;
      pickupContact?: PickupContact;
      metodoPago: MetodoPago;
      codigoPromocion?: string;
      costoEnvio?: number;
      shippingQuoteId?: string;
      selectedShippingOptionId?: string;
      selectedServiceType?: string;
      shippingSelection?: Partial<CheckoutShippingSelection>;
      notas?: string;
    },
  ): Promise<{
    cartId: string;
    orderDraft: CrearOrdenDTO;
    pricing: Awaited<
      ReturnType<typeof checkoutPricingService.calculateCheckoutPricing>
    >;
  }> {
    const carrito = await this.getOrCreateCart(usuarioId);

    if (!carrito.items || carrito.items.length === 0) {
      throw new Error(
        "El carrito está vacío. Agrega productos antes de hacer checkout",
      );
    }

    const fulfillmentMethod = this.normalizeFulfillmentMethod(
      checkoutData.fulfillmentMethod,
    );
    const direccionEnvio = this.normalizeDireccionEnvio(
      checkoutData.direccionEnvio,
    );

    const codigoPromocion =
      typeof checkoutData.codigoPromocion === "string"
        ? checkoutData.codigoPromocion.trim().toUpperCase()
        : undefined;

    const pricing = await checkoutPricingService.calculateCheckoutPricing({
      userId: usuarioId,
      cartId: carrito.id,
      shippingSelection: this.buildShippingSelection(
        fulfillmentMethod,
        checkoutData,
      ),
      shippingAddress:
        fulfillmentMethod === FulfillmentMethod.DELIVERY
          ? this.buildCheckoutShippingAddress(direccionEnvio)
          : undefined,
      paymentProvider:
        checkoutData.metodoPago === MetodoPago.APLAZO ? "APLAZO" : "STRIPE",
      shippingQuoteId: checkoutData.shippingQuoteId,
      selectedShippingOptionId: checkoutData.selectedShippingOptionId,
      selectedServiceType: checkoutData.selectedServiceType,
      ...(codigoPromocion ? { codigoPromocion } : {}),
    });

    const orderDraft: CrearOrdenDTO = {
      usuarioId,
      items: pricing.items.map((item) => ({
        productoId: item.productId,
        cantidad: item.quantity,
        precioUnitario: item.unitPriceFinal,
        subtotal: item.subtotalFinal,
        ...(item.tallaId ? { tallaId: item.tallaId } : {}),
      })),
      subtotal: pricing.subtotalFinal,
      impuestos: 0,
      total: pricing.total,
      fulfillmentMethod,
      direccionEnvio,
      pickupLocationId: checkoutData.pickupLocationId,
      pickupContact: checkoutData.pickupContact,
      metodoPago: checkoutData.metodoPago,
      ...(codigoPromocion ? { codigoPromocion } : {}),
      costoEnvio: pricing.shippingTotal,
      shipping: pricing.shipping,
      pricingSnapshot: pricing,
      paymentMetadata: {
        cartId: carrito.id,
        shippingProvider: pricing.shipping.provider || "",
        shippingCarrier: pricing.shipping.carrier || "",
        shippingServiceType: pricing.shipping.serviceType || "",
        shippingMethod:
          pricing.shipping.shippingMethod || pricing.shipping.method,
        carrierCode: pricing.shipping.carrierCode || "",
      },
      discountTotal: pricing.discountTotal,
      subtotalOriginal: pricing.subtotalOriginal,
      subtotalFinal: pricing.subtotalFinal,
      shippingTotal: pricing.shippingTotal,
      currency: pricing.currency,
      shippingQuoteId: checkoutData.shippingQuoteId,
      selectedShippingOptionId: checkoutData.selectedShippingOptionId,
      selectedServiceType: checkoutData.selectedServiceType,
      notas: checkoutData.notas,
    };

    return { cartId: carrito.id!, orderDraft, pricing };
  }

  /**
   * @deprecated Preferir checkoutAttemptService.startCheckout para Stripe.
   * Se conserva para compatibilidad con integraciones legacy.
   */
  async checkout(
    usuarioId: string,
    checkoutData: {
  fulfillmentMethod?: FulfillmentMethod | string;
  direccionEnvio?: DireccionEnvio;
  pickupLocationId?: string;
  pickupContact?: PickupContact;
  metodoPago: MetodoPago;
  codigoPromocion?: string;
  costoEnvio?: number;
  shippingQuoteId?: string;
  selectedShippingOptionId?: string;
  selectedServiceType?: string;
  shippingSelection?: Partial<CheckoutShippingSelection>;
  notas?: string;
},
  ): Promise<Orden> {
    console.log(`🛒 Iniciando checkout legacy para usuario: ${usuarioId}`);

    const { cartId, orderDraft } = await this.buildCheckoutOrderDraft(
      usuarioId,
      checkoutData,
    );

    console.log(
      `📦 Carrito ${cartId} tiene ${orderDraft.items.length} items. Creando orden...`,
    );

    const orden = await ordenService.createOrden(orderDraft);

    console.log(
      `✅ Orden ${orden.id} creada exitosamente desde carrito ${cartId}`,
    );

    return orden;
  }

  /**
   * Vacía el carrito asociado a una orden pagada.
   * No lanza error si el carrito ya fue vaciado o no existe.
   */
  async clearCartAfterSuccessfulPayment(cartId: string): Promise<void> {
    if (!cartId) {
      return;
    }

    try {
      await this.clearCart(cartId);
      console.log(`🧹 Carrito ${cartId} vaciado tras confirmar pago`);
    } catch (clearError) {
      console.error(
        `⚠️ Error al vaciar carrito ${cartId} tras confirmar pago:`,
        clearError,
      );
    }
  }

  // ===================================
  // Métodos Internos
  // ===================================

  /**
   * Recalcula subtotal y total a partir de los items
   * Total = subtotal (impuestos se aplican en checkout, no en carrito)
   *
   * @param items - Array de items del carrito
   * @returns Objeto con subtotal y total calculados
   */
  private recalculateTotals(items: ItemCarrito[]): {
    subtotal: number;
    total: number;
  } {
    const subtotal = items.reduce(
      (acc, item) => acc + item.precioUnitario * item.cantidad,
      0,
    );

    // Redondear a 2 decimales para evitar errores de punto flotante
    const subtotalRedondeado = Math.round(subtotal * 100) / 100;

    return {
      subtotal: subtotalRedondeado,
      total: subtotalRedondeado, // Impuestos se aplican en checkout
    };
  }

  private buildShippingSelection(
    fulfillmentMethod: FulfillmentMethod,
    checkoutData: {
      shippingSelection?: Partial<CheckoutShippingSelection>;
      selectedServiceType?: string;
    },
  ): CheckoutShippingSelection {
    if (fulfillmentMethod === FulfillmentMethod.PICKUP) {
      return { method: "PICKUP" };
    }

    return { method: "MANUAL", provider: "MANUAL" };
  }

  private normalizeFulfillmentMethod(
    value?: FulfillmentMethod | string,
  ): FulfillmentMethod {
    if (value === FulfillmentMethod.PICKUP) {
      return FulfillmentMethod.PICKUP;
    }

    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (normalized === "pickup" || normalized === "store_pickup") {
        return FulfillmentMethod.PICKUP;
      }
    }

    return FulfillmentMethod.DELIVERY;
  }

  private normalizeDireccionEnvio(
    address?: DireccionEnvio,
  ): DireccionEnvio | undefined {
    if (!address) {
      return undefined;
    }

    const raw = address as DireccionEnvio & {
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

  private buildCheckoutShippingAddress(
    address?: DireccionEnvio,
  ): CheckoutShippingAddress | undefined {
    if (!address) {
      return undefined;
    }

    return {
      streetLines: [
        `${address.calle} ${address.numero || address.numeroExterior || ""}`.trim(),
        address.numeroInterior
          ? `${address.colonia} Int ${address.numeroInterior}`.trim()
          : address.colonia,
        address.referencias || "",
      ].filter(Boolean),
      city: address.ciudad,
      stateOrProvinceCode: address.estado,
      postalCode: address.codigoPostal,
      countryCode: "MX",
      residential: true,
      addressValidationStatus:
        address.addressValidationStatus || "USER_CONFIRMED",
    };
  }
}

/**
 * Instancia singleton del servicio de carrito
 */
const carritoService = new CarritoService();
export default carritoService;
