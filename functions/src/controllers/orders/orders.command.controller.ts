import { Request, Response } from "express";
import ordenService from "../../services/orden.service";

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
 * TODO: Métodos futuros a implementar
 *
 * export const update = async (req: Request, res: Response) => { ... }
 * export const cancel = async (req: Request, res: Response) => { ... }
 * export const updateEstado = async (req: Request, res: Response) => { ... }
 */
