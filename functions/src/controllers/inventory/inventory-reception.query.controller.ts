import { Request, Response } from "express";
import inventoryReceptionService from "../../services/inventory-reception.service";
import { EstadoRecepcionMercancia } from "../../models/inventario.model";

export const listRecepciones = async (req: Request, res: Response) => {
  try {
    const limit =
      typeof req.query.limit === "number"
        ? req.query.limit
        : Number(req.query.limit) || 20;
    const cursor =
      typeof req.query.cursor === "string" ? req.query.cursor : undefined;
    const estadoRaw = req.query.estado;
    const estado =
      typeof estadoRaw === "string" &&
      Object.values(EstadoRecepcionMercancia).includes(
        estadoRaw as EstadoRecepcionMercancia,
      )
        ? (estadoRaw as EstadoRecepcionMercancia)
        : undefined;

    const result = await inventoryReceptionService.listRecepciones({
      estado,
      proveedorId:
        typeof req.query.proveedorId === "string"
          ? req.query.proveedorId
          : undefined,
      referencia:
        typeof req.query.referencia === "string"
          ? req.query.referencia
          : undefined,
      limit,
      cursor,
    });

    return res.status(200).json({
      success: true,
      count: result.recepciones.length,
      data: result.recepciones,
      pagination: {
        limit,
        nextCursor: result.nextCursor,
        hasNextPage: result.nextCursor !== null,
      },
    });
  } catch (error) {
    console.error("Error en GET /api/inventario/recepciones:", error);
    return res.status(500).json({
      success: false,
      message: "Error al listar recepciones de mercancia",
      error: error instanceof Error ? error.message : "Error desconocido",
    });
  }
};

export const getRecepcion = async (req: Request, res: Response) => {
  try {
    const recepcion = await inventoryReceptionService.getRecepcion(
      req.params.recepcionId,
    );

    return res.status(200).json({
      success: true,
      data: recepcion,
    });
  } catch (error) {
    console.error(
      "Error en GET /api/inventario/recepciones/:recepcionId:",
      error,
    );
    const statusCode =
      error instanceof Error &&
      error.message.toLowerCase().includes("no encontrada")
        ? 404
        : 500;

    return res.status(statusCode).json({
      success: false,
      message:
        statusCode === 404
          ? "Recepcion no encontrada"
          : "Error al consultar recepcion",
    });
  }
};
