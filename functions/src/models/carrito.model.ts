/**
 * Modelos para gestión de carrito de compras
 * Sistema de carrito para la tienda del Club León
 *
 * RELACIONES:
 * - usuarioId → Colección 'usuariosApp' (Firebase Auth UID, opcional para anónimos)
 * - sessionId → UUID generado por el cliente (header x-session-id, para anónimos)
 * - items[].productoId → Colección 'productos'
 *
 * IDENTIFICACIÓN DEL CARRITO:
 * - Usuarios autenticados: se busca por usuarioId (UID de Firebase Auth)
 * - Usuarios anónimos: se busca por sessionId (UUID enviado en header x-session-id)
 * - Un carrito pertenece a un usuario O a una sesión, nunca a ambos simultáneamente
 *
 * MERGE DE CARRITOS:
 * - Cuando un usuario anónimo se autentica, su carrito de sesión se fusiona
 *   con su carrito de usuario (si existe). Las cantidades se suman para
 *   productos duplicados, respetando los límites de stock.
 * - El carrito de sesión se elimina después del merge.
 *
 * ESTRATEGIA DE DATOS:
 * - NO usa soft delete (activo: boolean)
 * - Carritos se vacían al convertirlos en órdenes (checkout)
 * - Carritos anónimos abandonados pueden limpiarse por TTL (scheduled function)
 * - Precios se leen siempre del producto (precioPublico), nunca del cliente
 * - Totales se recalculan en cada operación de escritura
 * - Timestamps: Firestore Timestamp.now()
 *
 * CONSTANTES:
 * - MAX_CANTIDAD_POR_ITEM: 10 unidades por producto (configurable)
 * - Impuestos NO se aplican en el carrito (se calculan en checkout/orden)
 */

import { Timestamp } from "firebase-admin/firestore";

/**
 * Cantidad máxima permitida por item en el carrito
 * Evita compras masivas de un solo producto
 */
export const MAX_CANTIDAD_POR_ITEM = 10;

/**
 * Interface para items individuales del carrito
 * Representa cada producto agregado al carrito con su cantidad y precio
 */
export interface ItemCarrito {
  productoId: string; // Referencia al documento en colección 'productos'
  cantidad: number; // Cantidad de unidades (1 a MAX_CANTIDAD_POR_ITEM)
  precioUnitario: number; // Precio del producto al momento de agregarlo (snapshot de precioPublico)
  tallaId?: string; // ID de la talla seleccionada (opcional, si el producto maneja tallas)
}

/**
 * Interface principal de Carrito
 * Representa un carrito de compras en la colección 'carritos' de Firestore
 *
 * REGLAS DE IDENTIFICACIÓN:
 * - Si usuarioId está presente → carrito de usuario autenticado
 * - Si sessionId está presente → carrito de usuario anónimo (sesión)
 * - Nunca deben tener ambos (se limpia sessionId al hacer merge)
 */
export interface Carrito {
  id?: string; // ID del documento en Firestore (opcional al crear)
  usuarioId?: string; // UID de Firebase Auth (opcional, para usuarios autenticados)
  sessionId?: string; // UUID de sesión anónima (opcional, header x-session-id)
  items: ItemCarrito[]; // Array de productos en el carrito
  subtotal: number; // Suma de (precioUnitario * cantidad) de cada item
  total: number; // Igual al subtotal (impuestos se aplican en checkout)

  // Campos de auditoría
  createdAt: Timestamp; // Fecha de creación del carrito
  updatedAt: Timestamp; // Fecha de última actualización
}

/**
 * DTO para agregar un item al carrito
 * El precioUnitario se obtiene del producto en el servidor (nunca del cliente)
 */
export interface AgregarItemCarritoDTO {
  productoId: string; // ID del producto a agregar
  cantidad: number; // Cantidad a agregar (1 a MAX_CANTIDAD_POR_ITEM)
  tallaId?: string; // ID de talla seleccionada (si aplica)
}

/**
 * DTO para actualizar la cantidad de un item en el carrito
 * Si cantidad es 0, el item se elimina del carrito
 */
export interface ActualizarItemCarritoDTO {
  cantidad: number; // Nueva cantidad (0 = eliminar)
}

/**
 * Interface para carrito con información populada de productos
 * Útil para respuestas de API que incluyan datos detallados
 */
export interface CarritoPopulado extends Carrito {
  itemsDetallados?: Array<
    ItemCarrito & {
      producto?: {
        clave: string; // SKU del producto
        descripcion: string; // Nombre/descripción del producto
        imagenes: string[]; // URLs de imágenes
        existencias: number; // Stock disponible actual
        precioPublico: number; // Precio público actual (puede diferir del precioUnitario si cambió)
        activo: boolean; // Si el producto sigue activo
      };
    }
  >;
}
