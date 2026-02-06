import { Request, Response } from "express";
import ordenService from "../../services/orden.service";
import { EstadoOrden } from "../../models/orden.model";
import { RolUsuario } from "../../models/usuario.model";

/**
 * Controller: Orders Command (Escritura)
 * Responsabilidad: Manejar operaciones de mutación de órdenes (POST, PUT, DELETE)
 *
 * PATRÓN CQRS:
 * - Command: Operaciones de escritura (create, update, cancel)
 * - Query: Operaciones de lectura (implementar en orders.query.controller.ts)
 */

/**
 * POST /api/ordenes
 * Crea una nueva orden de compra
 *
 * LÓGICA DE NEGOCIO:
 * - Valida que todos los productos existan y tengan stock
 * - Recalcula totales en servidor (ignora valores del cliente)
 * - Establece estado PENDIENTE automáticamente
 * - NO reduce stock (implementar en TASK futura)
 * - NO requiere autenticación por ahora (agregar cuando TASK-032 esté lista)
 *
 * @param req.body - CrearOrdenDTO ya validado por Zod middleware
 * @returns 201 - Orden creada exitosamente
 * @returns 400 - Error de validación (producto no existe, sin stock)
 * @returns 500 - Error del servidor
 */
export const create = async (req: Request, res: Response) => {
  try {
    // Body ya validado por middleware de Zod (validateBody)
    // Tipos garantizados: usuarioId, items[], direccionEnvio, metodoPago
    const ordenData = req.body;

    console.log(
      `📦 POST /api/ordenes - Intentando crear orden para usuario: ${ordenData.usuarioId}`,
    );

    // Llamar al servicio (recalcula totales internamente)
    const nuevaOrden = await ordenService.createOrden(ordenData);

    return res.status(201).json({
      success: true,
      message: "Orden creada exitosamente",
      data: nuevaOrden,
    });
  } catch (error) {
    console.error("Error en POST /api/ordenes:", error);

    // Determinar código de estado según tipo de error
    let statusCode = 500;
    if (error instanceof Error) {
      const errorMessage = error.message.toLowerCase();
      // Errores de validación de negocio -> 400
      if (
        errorMessage.includes("no existe") ||
        errorMessage.includes("no está disponible") ||
        errorMessage.includes("stock insuficiente")
      ) {
        statusCode = 400;
      }
    }

    return res.status(statusCode).json({
      success: false,
      message:
        statusCode === 400
          ? "Error al procesar la orden"
          : "Error al crear la orden",
      error: error instanceof Error ? error.message : "Error desconocido",
    });
  }
};

/**
 * PUT /api/ordenes/:id/estado
 * Actualiza el estado de una orden existente
 *
 * LÓGICA DE NEGOCIO:
 * - Solo admins/empleados pueden cambiar el estado (requireAdmin middleware)
 * - Valida ownership: usuarios solo pueden actualizar sus órdenes
 * - Admins pueden actualizar cualquier orden (BOLA prevention)
 * - Todas las transiciones de estado son permitidas (flexibilidad operativa)
 * - Actualiza timestamp automáticamente
 *
 * @param req.params.id - ID de la orden
 * @param req.body.estado - Nuevo estado (validado por Zod middleware)
 * @param req.user - Usuario autenticado (agregado por authMiddleware)
 * @returns 200 - Estado actualizado exitosamente
 * @returns 400 - Error de validación
 * @returns 403 - Sin permisos (BOLA)
 * @returns 404 - Orden no encontrada
 * @returns 500 - Error del servidor
 */
export const updateEstado = async (req: Request, res: Response) => {
  try {
    const ordenId = req.params.id;
    const { estado } = req.body as { estado: EstadoOrden };

    // Validar que el usuario existe (agregado por authMiddleware)
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Usuario no autenticado",
      });
    }

    const usuarioActual = {
      uid: req.user.uid,
      rol: req.user.rol as RolUsuario,
    };

    console.log(
      `📦 PUT /api/ordenes/${ordenId}/estado - Usuario: ${usuarioActual.uid}, Nuevo estado: ${estado}`,
    );

    // Llamar al servicio (valida ownership internamente)
    const ordenActualizada = await ordenService.updateEstadoOrden(
      ordenId,
      estado,
      usuarioActual,
    );

    return res.status(200).json({
      success: true,
      message: `Estado de la orden actualizado a ${estado}`,
      data: ordenActualizada,
    });
  } catch (error) {
    console.error("Error en PUT /api/ordenes/:id/estado:", error);

    // Determinar código de estado según tipo de error
    let statusCode = 500;
    if (error instanceof Error) {
      const errorMessage = error.message.toLowerCase();
      if (errorMessage.includes("no existe")) {
        statusCode = 404;
      } else if (errorMessage.includes("no tienes permisos")) {
        statusCode = 403;
      } else if (errorMessage.includes("validación")) {
        statusCode = 400;
      }
    }

    return res.status(statusCode).json({
      success: false,
      message:
        statusCode === 404
          ? "Orden no encontrada"
          : statusCode === 403
            ? "No tienes permisos para actualizar esta orden"
            : "Error al actualizar el estado de la orden",
      error: error instanceof Error ? error.message : "Error desconocido",
    });
  }
};

/**
 * TODO: Métodos futuros a implementar
 *
 * export const update = async (req: Request, res: Response) => { ... }
 * export const cancel = async (req: Request, res: Response) => { ... }
 */
