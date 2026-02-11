import { Request, Response } from "express";
import ordenService from "../../services/orden.service";
import pagoService from "../../services/pago.service";
import { RolUsuario } from "../../models/usuario.model";
import { ApiError } from "../../utils/error-handler";

/**
 * Controller: Orders Query (Lectura)
 * Responsabilidad: Manejar operaciones de lectura de órdenes (GET)
 *
 * PATRÓN CQRS:
 * - Query: Operaciones de lectura (getAll, getById)
 * - Command: Operaciones de escritura (implementadas en orders.command.controller.ts)
 */

/**
 * GET /api/ordenes
 * Lista órdenes con filtros opcionales
 *
 * LÓGICA DE AUTORIZACIÓN (BOLA Prevention):
 * - Clientes: solo ven sus propias órdenes (forzar usuarioId = req.user.uid)
 * - Admins/Empleados: ven todas las órdenes (pueden filtrar por usuarioId)
 *
 * FILTROS DISPONIBLES:
 * - estado: string CSV (ej: "PENDIENTE,CONFIRMADA") - opcional
 * - usuarioId: string - opcional (solo para admins, ignorado para clientes)
 * - fechaDesde: ISO 8601 datetime - opcional
 * - fechaHasta: ISO 8601 datetime - opcional
 *
 * ORDENAMIENTO:
 * - Siempre ordenado por createdAt descendente (más recientes primero)
 *
 * SIN PAGINACIÓN:
 * - Retorna todas las órdenes que coincidan con los filtros
 * - Consistente con otros endpoints del proyecto (productos, categorías)
 *
 * @param req.query - Filtros validados por Zod middleware
 * @param req.user - Usuario autenticado (agregado por authMiddleware)
 * @returns 200 - Lista de órdenes con count
 * @returns 401 - No autenticado
 * @returns 500 - Error del servidor
 */
export const getAll = async (req: Request, res: Response) => {
  try {
    // Verificar autenticación (authMiddleware debe ejecutarse antes)
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "No autorizado. Se requiere autenticación.",
      });
    }

    // Extraer filtros de query params (ya validados por Zod middleware)
    const { estado, usuarioId, fechaDesde, fechaHasta } = req.query;

    // Determinar si el usuario es admin/empleado
    const userRole = req.user.rol as RolUsuario;
    const esAdmin =
      userRole === RolUsuario.ADMIN || userRole === RolUsuario.EMPLEADO;

    // Preparar objeto de filtros
    const filtros: any = {};

    // OWNERSHIP ENFORCEMENT: Clientes solo ven sus órdenes
    if (esAdmin) {
      // Admins pueden filtrar por usuarioId o ver todas
      if (usuarioId && typeof usuarioId === "string") {
        filtros.usuarioId = usuarioId;
      }
    } else {
      // Clientes: SIEMPRE filtrar por su UID (BOLA prevention)
      filtros.usuarioId = req.user.uid;
    }

    // Filtro por estado (CSV: "PENDIENTE,CONFIRMADA" -> array)
    if (estado && typeof estado === "string") {
      // Dividir por coma y limpiar espacios
      const estados = estado.split(",").map((e) => e.trim());
      if (estados.length > 0) {
        filtros.estados = estados;
      }
    }

    // Filtro por rango de fechas (ISO 8601)
    if (fechaDesde && typeof fechaDesde === "string") {
      filtros.fechaDesde = fechaDesde;
    }
    if (fechaHasta && typeof fechaHasta === "string") {
      filtros.fechaHasta = fechaHasta;
    }

    console.log(`📋 GET /api/ordenes - Filtros aplicados:`, filtros);
    console.log(`👤 Usuario: ${req.user.uid} (${userRole})`);

    // Llamar al servicio
    const ordenes = await ordenService.getAllOrdenes(filtros, req.user);

    return res.status(200).json({
      success: true,
      count: ordenes.length,
      data: ordenes,
    });
  } catch (error) {
    console.error("Error en GET /api/ordenes:", error);
    return res.status(500).json({
      success: false,
      message: "Error al obtener las órdenes",
      error: error instanceof Error ? error.message : "Error desconocido",
    });
  }
};

/**
 * GET /api/ordenes/:id
 * Obtiene una orden específica por ID con información populada
 *
 * POPULATE INCLUIDO:
 * - Información de productos: clave, descripción, imágenes
 * - Información de usuario: nombre, email, telefono
 *
 * LÓGICA DE AUTORIZACIÓN (BOLA Prevention):
 * - Clientes: solo pueden ver sus propias órdenes
 * - Admins/Empleados: pueden ver cualquier orden
 *
 * @param req.params.id - ID de la orden
 * @param req.user - Usuario autenticado (agregado por authMiddleware)
 * @returns 200 - Orden encontrada con información populada
 * @returns 401 - No autenticado
 * @returns 403 - Sin permisos (no es el propietario)
 * @returns 404 - Orden no encontrada
 * @returns 500 - Error del servidor
 */
export const getById = async (req: Request, res: Response) => {
  try {
    // Verificar autenticación
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "No autorizado. Se requiere autenticación.",
      });
    }

    const ordenId = req.params.id;

    console.log(
      `📋 GET /api/ordenes/${ordenId} - Usuario: ${req.user.uid} (${req.user.rol})`,
    );

    // Llamar al servicio con populate (incluye validación de ownership)
    const orden = await ordenService.getOrdenByIdConPopulate(ordenId, req.user);

    if (!orden) {
      return res.status(404).json({
        success: false,
        message: `Orden con ID "${ordenId}" no encontrada`,
      });
    }

    return res.status(200).json({
      success: true,
      data: orden,
    });
  } catch (error) {
    console.error(`Error en GET /api/ordenes/:id:`, error);

    // Detectar errores de autorización (BOLA)
    if (error instanceof Error && error.message.includes("permisos")) {
      return res.status(403).json({
        success: false,
        message: error.message,
      });
    }

    return res.status(500).json({
      success: false,
      message: "Error al obtener la orden",
      error: error instanceof Error ? error.message : "Error desconocido",
    });
  }
};

/**
 * GET /api/ordenes/:id/pago
 * Endpoint proxy para consultar el pago asociado a una orden
 */
export const getPagoByOrdenIdProxy = async (req: Request, res: Response) => {
  try {
    if (!req.user?.uid) {
      return res.status(401).json({
        success: false,
        message: "No autorizado. Se requiere autenticación.",
      });
    }

    const result = await pagoService.getPagoByOrdenId(req.params.id, {
      uid: req.user.uid,
      rol: req.user.rol as string | undefined,
    });

    return res.status(200).json({
      success: true,
      message: "Pago obtenido exitosamente",
      data: result,
    });
  } catch (error) {
    if (error instanceof ApiError) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.message,
      });
    }

    return res.status(500).json({
      success: false,
      message: "Error al obtener el pago de la orden",
      error: error instanceof Error ? error.message : "Error desconocido",
    });
  }
};
