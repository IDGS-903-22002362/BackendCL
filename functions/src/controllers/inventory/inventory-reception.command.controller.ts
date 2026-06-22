import { Request, Response } from "express";
import inventoryReceptionService from "../../services/inventory-reception.service";

const getOptionalIdempotencyKey = (req: Request): string | undefined => {
  const headerKey = req.header("Idempotency-Key")?.trim();
  const bodyKey =
    typeof req.body?.idempotencyKey === "string"
      ? req.body.idempotencyKey.trim()
      : undefined;
  const idempotencyKey = headerKey || bodyKey;
  if (!idempotencyKey) {
    return undefined;
  }
  if (idempotencyKey.length < 8 || idempotencyKey.length > 255) {
    throw new Error("Idempotency-Key debe tener entre 8 y 255 caracteres");
  }
  return idempotencyKey;
};

const mapErrorStatus = (error: unknown): number => {
  if (!(error instanceof Error)) {
    return 500;
  }
  const msg = error.message.toLowerCase();
  if (msg.includes("no encontrada") || msg.includes("no encontrado")) {
    return 404;
  }
  if (
    msg.includes("cerrada") ||
    msg.includes("cancelada") ||
    msg.includes("excede") ||
    msg.includes("requiere") ||
    msg.includes("no pertenece") ||
    msg.includes("no maneja") ||
    msg.includes("idempotency")
  ) {
    return 400;
  }
  return 500;
};

export const createRecepcion = async (req: Request, res: Response) => {
  try {
    const recepcion = await inventoryReceptionService.createRecepcion({
      ...req.body,
      responsableId: req.user?.uid ?? "",
      responsableNombre: req.user?.email,
    });

    return res.status(201).json({
      success: true,
      message: "Recepcion de mercancia creada exitosamente",
      data: recepcion,
    });
  } catch (error) {
    console.error("Error en POST /api/inventario/recepciones:", error);
    const statusCode = mapErrorStatus(error);
    return res.status(statusCode).json({
      success: false,
      message:
        error instanceof Error ? error.message : "Error al crear recepcion",
    });
  }
};

export const updateRecepcionLineas = async (req: Request, res: Response) => {
  try {
    const recepcion = await inventoryReceptionService.updateLineas(
      req.params.recepcionId,
      req.body.lineas ?? [],
    );

    return res.status(200).json({
      success: true,
      message: "Lineas de recepcion actualizadas",
      data: recepcion,
    });
  } catch (error) {
    console.error(
      "Error en PUT /api/inventario/recepciones/:recepcionId/lineas:",
      error,
    );
    const statusCode = mapErrorStatus(error);
    return res.status(statusCode).json({
      success: false,
      message:
        error instanceof Error
          ? error.message
          : "Error al actualizar lineas de recepcion",
    });
  }
};

export const confirmRecepcion = async (req: Request, res: Response) => {
  try {
    const idempotencyKey = getOptionalIdempotencyKey(req);
    const recepcion = await inventoryReceptionService.confirmRecepcion({
      recepcionId: req.params.recepcionId,
      lineas: req.body.lineas ?? [],
      responsableId: req.user?.uid ?? "",
      idempotencyKey,
    });

    return res.status(200).json({
      success: true,
      message: "Recepcion confirmada parcial o totalmente",
      data: recepcion,
    });
  } catch (error) {
    console.error(
      "Error en POST /api/inventario/recepciones/:recepcionId/confirmar:",
      error,
    );
    const statusCode = mapErrorStatus(error);
    return res.status(statusCode).json({
      success: false,
      message:
        error instanceof Error ? error.message : "Error al confirmar recepcion",
    });
  }
};

export const closeRecepcion = async (req: Request, res: Response) => {
  try {
    const recepcion = await inventoryReceptionService.closeRecepcion(
      req.params.recepcionId,
      req.user?.uid ?? "",
    );

    return res.status(200).json({
      success: true,
      message: "Recepcion cerrada exitosamente",
      data: recepcion,
    });
  } catch (error) {
    console.error(
      "Error en POST /api/inventario/recepciones/:recepcionId/cerrar:",
      error,
    );
    const statusCode = mapErrorStatus(error);
    return res.status(statusCode).json({
      success: false,
      message:
        error instanceof Error ? error.message : "Error al cerrar recepcion",
    });
  }
};
