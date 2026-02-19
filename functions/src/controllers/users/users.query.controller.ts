import { Request, Response } from "express";
import userAppService from "../../services/user.service";
import ordenService from "../../services/orden.service";
import { RolUsuario } from "../../models/usuario.model";
import { mapFirebaseError } from "../../utils/firebase-error.util";

/**
 * Controller: Products Query (Lectura)
 * Responsabilidad: Manejar operaciones de lectura de datos (GET)
 */
export const getAll = async (_req: Request, res: Response) => {
  try {
    const usuarios = await userAppService.getAllUsers();
    res.status(200).json({
      success: true,
      count: usuarios.length,
      data: usuarios,
    });
  } catch (error) {
    const mapped = mapFirebaseError(error, {
      unauthorizedMessage: "No autorizado",
      forbiddenMessage:
        "Sin permisos para acceder a usuarios de app-oficial-leon",
      notFoundMessage: "Usuarios no encontrados",
      internalMessage: "Error al obtener los usuarios",
    });

    console.error("Error en GET /api/usuarios:", {
      code: mapped.code,
      status: mapped.status,
    });

    res.status(mapped.status).json({
      success: false,
      message: mapped.message,
    });
  }
};

export const getById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const usuario = await userAppService.getUserById(id);

    if (!usuario) {
      return res.status(404).json({
        success: false,
        message: `Usuario con ID ${id} no encontrado`,
      });
    }

    return res.status(200).json({
      success: true,
      data: usuario,
    });
  } catch (error) {
    const mapped = mapFirebaseError(error, {
      unauthorizedMessage: "No autorizado",
      forbiddenMessage: "Sin permisos para acceder a este usuario",
      notFoundMessage: `Usuario con ID ${req.params.id} no encontrado`,
      internalMessage: "Error al obtener el usuario",
    });

    console.error("Error en GET /api/usuarios/:id:", {
      code: mapped.code,
      status: mapped.status,
    });

    return res.status(mapped.status).json({
      success: false,
      message: mapped.message,
    });
  }
};

/** 
export const getByCategory = async (req: Request, res: Response) => {
    try {
        const { categoriaId } = req.params;
        const productos = await userAppService.getProductsByCategory(categoriaId);

        res.status(200).json({
            success: true,
            count: productos.length,
            data: productos,
        });
    } catch (error) {
        console.error("Error en GET /api/productos/categoria/:categoriaId:", error);
        res.status(500).json({
            success: false,
            message: "Error al obtener productos por categoría",
            error: error instanceof Error ? error.message : "Error desconocido",
        });
    }
};

export const getByLine = async (req: Request, res: Response) => {
    try {
        const { lineaId } = req.params;
        const productos = await productService.getProductsByLine(lineaId);

        res.status(200).json({
            success: true,
            count: productos.length,
            data: productos,
        });
    } catch (error) {
        console.error("Error en GET /api/productos/linea/:lineaId:", error);
        res.status(500).json({
            success: false,
            message: "Error al obtener productos por línea",
            error: error instanceof Error ? error.message : "Error desconocido",
        });
    }
};
*/

export const search = async (req: Request, res: Response) => {
  try {
    const { termino } = req.params;
    const usuarios = await userAppService.searchUsers(termino);

    res.status(200).json({
      success: true,
      count: usuarios.length,
      data: usuarios,
    });
  } catch (error) {
    const mapped = mapFirebaseError(error, {
      unauthorizedMessage: "No autorizado",
      forbiddenMessage: "Sin permisos para buscar usuarios",
      notFoundMessage: "No se encontraron usuarios",
      internalMessage: "Error al buscar usuarios",
    });

    console.error("Error en GET /api/usuarios/buscar/:termino:", {
      code: mapped.code,
      status: mapped.status,
    });

    res.status(mapped.status).json({
      success: false,
      message: mapped.message,
    });
  }
};

/**
 * GET /api/usuarios/:id/ordenes
 * Obtiene el historial de órdenes de un usuario específico
 *
 * LÓGICA DE AUTORIZACIÓN (BOLA Prevention):
 * - Clientes: solo pueden ver su propio historial (req.user.uid === :id)
 * - Admins/Empleados: pueden ver historial de cualquier usuario
 *
 * FILTROS DISPONIBLES (query params):
 * - estado: string CSV (ej: "PENDIENTE,CONFIRMADA") - opcional
 * - fechaDesde: ISO 8601 datetime - opcional
 * - fechaHasta: ISO 8601 datetime - opcional
 *
 * PAGINACIÓN (cursor-based):
 * - limit: número de resultados por página (default 10, max 50)
 * - cursor: ID de la última orden de la página anterior
 *
 * ORDENAMIENTO:
 * - Siempre ordenado por createdAt descendente (más recientes primero)
 *
 * @param req.params.id - UID del usuario (Firebase Auth UID)
 * @param req.query - Filtros y paginación validados por Zod middleware
 * @param req.user - Usuario autenticado (agregado por authMiddleware)
 * @returns 200 - Historial de órdenes paginado
 * @returns 401 - No autenticado
 * @returns 403 - Sin permisos (no es el propietario ni admin)
 * @returns 500 - Error del servidor
 */
export const getOrderHistory = async (req: Request, res: Response) => {
  try {
    // Verificar autenticación
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "No autorizado. Se requiere autenticación.",
      });
    }

    const { id } = req.params; // UID del usuario objetivo

    // Determinar si el usuario es admin/empleado
    const userRole = req.user.rol as RolUsuario;
    const esAdmin =
      userRole === RolUsuario.ADMIN || userRole === RolUsuario.EMPLEADO;

    // BOLA PREVENTION: Clientes solo pueden ver su propio historial
    if (!esAdmin && req.user.uid !== id) {
      return res.status(403).json({
        success: false,
        message:
          "Acceso denegado. Solo puedes ver tu propio historial de órdenes.",
      });
    }

    // Extraer filtros de query params (ya validados por Zod middleware)
    const { estado, fechaDesde, fechaHasta, limit, cursor } = req.query;

    // Preparar objeto de filtros
    const filtros: {
      estados?: string[];
      fechaDesde?: string;
      fechaHasta?: string;
    } = {};

    // Filtro por estado (CSV: "PENDIENTE,CONFIRMADA" -> array)
    if (estado && typeof estado === "string") {
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

    // Preparar paginación
    const paginacion = {
      limit: typeof limit === "number" ? limit : Number(limit) || 10,
      cursor: typeof cursor === "string" ? cursor : undefined,
    };

    console.log(
      `📋 GET /api/usuarios/${id}/ordenes - Filtros:`,
      filtros,
      `| Paginación: limit=${paginacion.limit}, cursor=${paginacion.cursor || "inicio"}`,
    );
    console.log(`👤 Solicitante: ${req.user.uid} (${userRole})`);

    // Llamar al servicio
    const resultado = await ordenService.getOrdenesByUsuario(
      id,
      filtros,
      paginacion,
    );

    return res.status(200).json({
      success: true,
      count: resultado.ordenes.length,
      data: resultado.ordenes,
      pagination: {
        limit: paginacion.limit,
        nextCursor: resultado.nextCursor,
        hasNextPage: resultado.nextCursor !== null,
      },
    });
  } catch (error) {
    const mapped = mapFirebaseError(error, {
      unauthorizedMessage: "No autorizado",
      forbiddenMessage: "Sin permisos para ver historial de órdenes",
      notFoundMessage: "Órdenes no encontradas",
      internalMessage: "Error al obtener el historial de órdenes",
    });

    console.error("Error en GET /api/usuarios/:id/ordenes:", {
      code: mapped.code,
      status: mapped.status,
    });

    return res.status(mapped.status).json({
      success: false,
      message: mapped.message,
    });
  }
};
