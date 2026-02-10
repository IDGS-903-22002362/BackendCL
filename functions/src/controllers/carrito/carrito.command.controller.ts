import { Request, Response } from "express";
import carritoService from "../../services/carrito.service";

/**
 * Controller: Carrito Command (Escritura)
 * Responsabilidad: Manejar operaciones de mutación del carrito (POST, PUT, DELETE)
 *
 * PATRÓN CQRS:
 * - Command: Operaciones de escritura (addItem, updateItem, removeItem, clearCart, mergeCarts)
 * - Query: Operaciones de lectura (implementadas en carrito.query.controller.ts)
 *
 * IDENTIFICACIÓN:
 * - Usuario autenticado: req.user.uid
 * - Usuario anónimo: req.headers['x-session-id']
 *
 * SEGURIDAD:
 * - precioUnitario NUNCA se recibe del cliente (se lee del producto en el servicio)
 * - Cantidades se validan contra stock real
 */

/**
 * Helper para extraer identificación del carrito del request
 * @returns { usuarioId?, sessionId? } o null si no hay identificación
 */
const getCartIdentity = (
  req: Request,
): { usuarioId?: string; sessionId?: string } | null => {
  const usuarioId = req.user?.uid as string | undefined;
  const sessionId = req.headers["x-session-id"] as string | undefined;

  if (!usuarioId && !sessionId) {
    return null;
  }

  return { usuarioId, sessionId };
};

/**
 * POST /api/carrito/items
 * Agrega un producto al carrito
 *
 * LÓGICA:
 * - Valida que el producto exista y tenga stock
 * - Si el producto ya está en el carrito, suma cantidades
 * - precioUnitario se obtiene del servidor (precioPublico del producto)
 * - Recalcula totales automáticamente
 *
 * @param req.body - AgregarItemCarritoDTO (validado por Zod middleware)
 * @returns 200 - Item agregado, carrito actualizado
 * @returns 400 - Error de validación (sin ID, producto no existe, sin stock)
 * @returns 500 - Error del servidor
 */
export const addItem = async (req: Request, res: Response) => {
  try {
    const identity = getCartIdentity(req);
    if (!identity) {
      return res.status(400).json({
        success: false,
        message:
          "Se requiere autenticación o header x-session-id para identificar el carrito",
      });
    }

    // Obtener o crear carrito
    const carrito = await carritoService.getOrCreateCart(
      identity.usuarioId,
      identity.sessionId,
    );

    // Agregar item (body ya validado por Zod middleware)
    await carritoService.addItem(carrito.id!, req.body);

    // Obtener carrito populado para la respuesta
    const carritoPopulado = await carritoService.getCartPopulado(carrito.id!);

    return res.status(200).json({
      success: true,
      message: "Producto agregado al carrito",
      data: carritoPopulado,
    });
  } catch (error) {
    console.error("Error en POST /api/carrito/items:", error);

    let statusCode = 500;
    if (error instanceof Error) {
      const msg = error.message.toLowerCase();
      if (
        msg.includes("no existe") ||
        msg.includes("no está disponible") ||
        msg.includes("stock insuficiente") ||
        msg.includes("cantidad máxima") ||
        msg.includes("se requiere")
      ) {
        statusCode = 400;
      }
    }

    return res.status(statusCode).json({
      success: false,
      message:
        statusCode === 400
          ? error instanceof Error
            ? error.message
            : "Error de validación"
          : "Error al agregar producto al carrito",
      error:
        statusCode === 500 && error instanceof Error
          ? error.message
          : undefined,
    });
  }
};

/**
 * PUT /api/carrito/items/:productoId
 * Actualiza la cantidad de un item en el carrito
 * Si cantidad es 0, elimina el item
 *
 * @param req.params.productoId - ID del producto a actualizar
 * @param req.body.cantidad - Nueva cantidad (0 = eliminar)
 * @returns 200 - Cantidad actualizada, carrito actualizado
 * @returns 400 - Error de validación
 * @returns 404 - Item no encontrado en el carrito
 * @returns 500 - Error del servidor
 */
export const updateItem = async (req: Request, res: Response) => {
  try {
    const identity = getCartIdentity(req);
    if (!identity) {
      return res.status(400).json({
        success: false,
        message:
          "Se requiere autenticación o header x-session-id para identificar el carrito",
      });
    }

    const { productoId } = req.params;
    const { cantidad } = req.body;

    // Obtener carrito
    const carrito = await carritoService.getOrCreateCart(
      identity.usuarioId,
      identity.sessionId,
    );

    // Actualizar cantidad
    await carritoService.updateItemQuantity(carrito.id!, productoId, cantidad);

    // Obtener carrito populado para la respuesta
    const carritoPopulado = await carritoService.getCartPopulado(carrito.id!);

    const message =
      cantidad === 0
        ? "Producto eliminado del carrito"
        : "Cantidad actualizada";

    return res.status(200).json({
      success: true,
      message,
      data: carritoPopulado,
    });
  } catch (error) {
    console.error("Error en PUT /api/carrito/items/:productoId:", error);

    let statusCode = 500;
    if (error instanceof Error) {
      const msg = error.message.toLowerCase();
      if (msg.includes("no encontrado")) {
        statusCode = 404;
      } else if (msg.includes("stock insuficiente")) {
        statusCode = 400;
      }
    }

    return res.status(statusCode).json({
      success: false,
      message:
        error instanceof Error
          ? error.message
          : "Error al actualizar item del carrito",
    });
  }
};

/**
 * DELETE /api/carrito/items/:productoId
 * Elimina un item del carrito
 *
 * @param req.params.productoId - ID del producto a eliminar
 * @returns 200 - Item eliminado, carrito actualizado
 * @returns 404 - Item no encontrado en el carrito
 * @returns 500 - Error del servidor
 */
export const removeItem = async (req: Request, res: Response) => {
  try {
    const identity = getCartIdentity(req);
    if (!identity) {
      return res.status(400).json({
        success: false,
        message:
          "Se requiere autenticación o header x-session-id para identificar el carrito",
      });
    }

    const { productoId } = req.params;

    // Obtener carrito
    const carrito = await carritoService.getOrCreateCart(
      identity.usuarioId,
      identity.sessionId,
    );

    // Eliminar item
    await carritoService.removeItem(carrito.id!, productoId);

    // Obtener carrito populado para la respuesta
    const carritoPopulado = await carritoService.getCartPopulado(carrito.id!);

    return res.status(200).json({
      success: true,
      message: "Producto eliminado del carrito",
      data: carritoPopulado,
    });
  } catch (error) {
    console.error("Error en DELETE /api/carrito/items/:productoId:", error);

    let statusCode = 500;
    if (error instanceof Error && error.message.includes("no encontrado")) {
      statusCode = 404;
    }

    return res.status(statusCode).json({
      success: false,
      message:
        error instanceof Error
          ? error.message
          : "Error al eliminar item del carrito",
    });
  }
};

/**
 * DELETE /api/carrito
 * Vacía completamente el carrito
 *
 * @returns 200 - Carrito vaciado
 * @returns 400 - Sin identificación
 * @returns 500 - Error del servidor
 */
export const clearCart = async (req: Request, res: Response) => {
  try {
    const identity = getCartIdentity(req);
    if (!identity) {
      return res.status(400).json({
        success: false,
        message:
          "Se requiere autenticación o header x-session-id para identificar el carrito",
      });
    }

    // Obtener carrito
    const carrito = await carritoService.getOrCreateCart(
      identity.usuarioId,
      identity.sessionId,
    );

    // Vaciar carrito
    const carritoVacio = await carritoService.clearCart(carrito.id!);

    return res.status(200).json({
      success: true,
      message: "Carrito vaciado exitosamente",
      data: carritoVacio,
    });
  } catch (error) {
    console.error("Error en DELETE /api/carrito:", error);

    return res.status(500).json({
      success: false,
      message: "Error al vaciar el carrito",
      error: error instanceof Error ? error.message : "Error desconocido",
    });
  }
};

/**
 * POST /api/carrito/checkout
 * Convierte el carrito del usuario autenticado en una orden de compra
 * Requiere autenticación (authMiddleware)
 *
 * LÓGICA:
 * - Obtiene el carrito del usuario autenticado
 * - Valida que el carrito tenga items
 * - Valida stock de todos los productos (delegado a OrdenService)
 * - Crea orden con items del carrito, dirección de envío y método de pago
 * - Vacía el carrito después de crear la orden exitosamente
 * - Si falla la creación de la orden, el carrito queda intacto
 *
 * @param req.body - CheckoutCarritoDTO (direccionEnvio, metodoPago, costoEnvio?, notas?)
 * @param req.user.uid - UID del usuario autenticado (de authMiddleware)
 * @returns 201 - Orden creada exitosamente
 * @returns 400 - Carrito vacío, stock insuficiente, validación
 * @returns 401 - No autenticado
 * @returns 500 - Error del servidor
 */
export const checkout = async (req: Request, res: Response) => {
  try {
    if (!req.user?.uid) {
      return res.status(401).json({
        success: false,
        message: "Se requiere autenticación para realizar el checkout",
      });
    }

    const usuarioId = req.user.uid as string;

    // Crear orden desde carrito (body ya validado por Zod middleware)
    const orden = await carritoService.checkout(usuarioId, req.body);

    return res.status(201).json({
      success: true,
      message: "Orden creada exitosamente desde el carrito",
      data: orden,
    });
  } catch (error) {
    console.error("Error en POST /api/carrito/checkout:", error);

    let statusCode = 500;
    if (error instanceof Error) {
      const msg = error.message.toLowerCase();
      if (
        msg.includes("carrito está vacío") ||
        msg.includes("no existe") ||
        msg.includes("no está disponible") ||
        msg.includes("stock insuficiente")
      ) {
        statusCode = 400;
      }
    }

    return res.status(statusCode).json({
      success: false,
      message:
        statusCode === 400
          ? error instanceof Error
            ? error.message
            : "Error de validación"
          : "Error al procesar el checkout",
      error:
        statusCode === 500 && error instanceof Error
          ? error.message
          : undefined,
    });
  }
};

/**
 * POST /api/carrito/merge
 * Fusiona el carrito de sesión anónima con el carrito del usuario autenticado
 * Requiere autenticación (authMiddleware)
 *
 * LÓGICA:
 * - Toma items del carrito de sesión y los agrega al carrito del usuario
 * - Si un producto ya existe en ambos, las cantidades se suman
 * - Respeta límites de stock y MAX_CANTIDAD_POR_ITEM
 * - Elimina el carrito de sesión después del merge
 *
 * @param req.body.sessionId - UUID de la sesión anónima a fusionar
 * @param req.user.uid - UID del usuario autenticado (de authMiddleware)
 * @returns 200 - Carritos fusionados exitosamente
 * @returns 401 - No autenticado
 * @returns 500 - Error del servidor
 */
export const mergeCarts = async (req: Request, res: Response) => {
  try {
    if (!req.user?.uid) {
      return res.status(401).json({
        success: false,
        message: "Se requiere autenticación para fusionar carritos",
      });
    }

    const { sessionId } = req.body;
    const usuarioId = req.user.uid as string;

    // Merge carritos
    const carritoMerged = await carritoService.mergeCarts(sessionId, usuarioId);

    // Obtener carrito populado
    const carritoPopulado = await carritoService.getCartPopulado(
      carritoMerged.id!,
    );

    return res.status(200).json({
      success: true,
      message: "Carritos fusionados exitosamente",
      data: carritoPopulado,
    });
  } catch (error) {
    console.error("Error en POST /api/carrito/merge:", error);

    return res.status(500).json({
      success: false,
      message: "Error al fusionar los carritos",
      error: error instanceof Error ? error.message : "Error desconocido",
    });
  }
};
