import { Request, Response } from "express";
import carritoService from "../../services/carrito.service";

/**
 * Controller: Carrito Query (Lectura)
 * Responsabilidad: Manejar operaciones de lectura del carrito (GET)
 *
 * PATRÓN CQRS:
 * - Query: Operaciones de lectura (getCart)
 * - Command: Operaciones de escritura (implementadas en carrito.command.controller.ts)
 *
 * IDENTIFICACIÓN:
 * - Usuario autenticado: req.user.uid
 * - Usuario anónimo: req.headers['x-session-id']
 */

/**
 * GET /api/carrito
 * Obtiene el carrito del usuario o sesión actual (con información populada)
 * Si no existe, crea un carrito vacío
 *
 * IDENTIFICACIÓN:
 * - Autenticado: usa req.user.uid (de authMiddleware)
 * - Anónimo: usa header x-session-id
 *
 * @param req.user - Usuario autenticado (opcional, agregado por optionalAuthMiddleware)
 * @param req.headers['x-session-id'] - UUID de sesión para usuarios anónimos
 * @returns 200 - Carrito con items populados
 * @returns 400 - Sin identificación (ni auth ni session)
 * @returns 500 - Error del servidor
 */
export const getCart = async (req: Request, res: Response) => {
  try {
    const usuarioId = req.user?.uid as string | undefined;
    const sessionId = req.headers["x-session-id"] as string | undefined;

    if (!usuarioId && !sessionId) {
      return res.status(400).json({
        success: false,
        message:
          "Se requiere autenticación o header x-session-id para identificar el carrito",
      });
    }

    // Obtener o crear carrito
    const carrito = await carritoService.getOrCreateCart(usuarioId, sessionId);

    // Obtener carrito con información populada de productos
    const carritoPopulado = await carritoService.getCartPopulado(carrito.id!);

    return res.status(200).json({
      success: true,
      data: carritoPopulado,
    });
  } catch (error) {
    console.error("Error en GET /api/carrito:", error);

    return res.status(500).json({
      success: false,
      message: "Error al obtener el carrito",
      error: error instanceof Error ? error.message : "Error desconocido",
    });
  }
};
