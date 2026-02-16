import { Request, Response } from "express";
import inventoryService from "../../services/inventory.service";
import { RolUsuario } from "../../models/usuario.model";
import { TipoMovimientoInventario } from "../../models/inventario.model";

export const getMovements = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "No autorizado. Se requiere autenticación.",
      });
    }

    const { productoId, tallaId, tipo, ordenId, fechaDesde, fechaHasta } =
      req.query;

    const limit =
      typeof req.query.limit === "number"
        ? req.query.limit
        : Number(req.query.limit) || 20;
    const cursor =
      typeof req.query.cursor === "string" ? req.query.cursor : undefined;

    const userRole = req.user.rol as RolUsuario;
    const isAdmin =
      userRole === RolUsuario.ADMIN || userRole === RolUsuario.EMPLEADO;

    const movementType =
      typeof tipo === "string" ? (tipo as TipoMovimientoInventario) : undefined;

    const result = await inventoryService.listMovements({
      productoId: typeof productoId === "string" ? productoId : undefined,
      tallaId: typeof tallaId === "string" ? tallaId : undefined,
      tipo: movementType,
      ordenId: typeof ordenId === "string" ? ordenId : undefined,
      fechaDesde: typeof fechaDesde === "string" ? fechaDesde : undefined,
      fechaHasta: typeof fechaHasta === "string" ? fechaHasta : undefined,
      limit,
      cursor,
      usuarioId: isAdmin ? undefined : req.user.uid,
    });

    return res.status(200).json({
      success: true,
      count: result.movimientos.length,
      data: result.movimientos,
      pagination: {
        limit,
        nextCursor: result.nextCursor,
        hasNextPage: result.nextCursor !== null,
      },
    });
  } catch (error) {
    console.error("Error en GET /api/inventario/movimientos:", error);

    let statusCode = 500;
    if (
      error instanceof Error &&
      error.message.toLowerCase().includes("cursor inválido")
    ) {
      statusCode = 400;
    }

    return res.status(statusCode).json({
      success: false,
      message:
        statusCode === 400
          ? "Parámetros de consulta inválidos"
          : "Error al consultar historial de movimientos",
      error: error instanceof Error ? error.message : "Error desconocido",
    });
  }
};
