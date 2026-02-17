import { Request, Response } from "express";
import inventoryService from "../../services/inventory.service";

const IDEMPOTENCY_KEY_MIN_LENGTH = 8;
const IDEMPOTENCY_KEY_MAX_LENGTH = 255;

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

  if (
    idempotencyKey.length < IDEMPOTENCY_KEY_MIN_LENGTH ||
    idempotencyKey.length > IDEMPOTENCY_KEY_MAX_LENGTH
  ) {
    throw new Error(
      `Idempotency-Key debe tener entre ${IDEMPOTENCY_KEY_MIN_LENGTH} y ${IDEMPOTENCY_KEY_MAX_LENGTH} caracteres`,
    );
  }

  return idempotencyKey;
};

export const registerMovement = async (req: Request, res: Response) => {
  try {
    const movement = await inventoryService.registerMovement({
      ...req.body,
      usuarioId: req.user?.uid,
    });

    return res.status(201).json({
      success: true,
      message: "Movimiento de inventario registrado exitosamente",
      data: movement,
    });
  } catch (error) {
    console.error("Error en POST /api/inventario/movimientos:", error);

    let statusCode = 500;

    if (error instanceof Error) {
      const msg = error.message.toLowerCase();
      if (
        msg.includes("no encontrado") ||
        msg.includes("no encontrada") ||
        msg.includes("no existe")
      ) {
        statusCode = 404;
      } else if (
        msg.includes("stock insuficiente") ||
        msg.includes("se requiere") ||
        msg.includes("no maneja inventario") ||
        msg.includes("no puede")
      ) {
        statusCode = 400;
      }
    }

    return res.status(statusCode).json({
      success: false,
      message:
        statusCode === 404
          ? "Recurso relacionado no encontrado"
          : statusCode === 400
            ? error instanceof Error
              ? error.message
              : "Error de validación"
            : "Error al registrar movimiento de inventario",
      error:
        statusCode === 500 && error instanceof Error
          ? error.message
          : undefined,
    });
  }
};

export const registerAdjustment = async (req: Request, res: Response) => {
  try {
    const idempotencyKey = getOptionalIdempotencyKey(req);

    const result = await inventoryService.registerAdjustment({
      productoId: req.body.productoId,
      tallaId: req.body.tallaId,
      cantidadFisica: req.body.cantidadFisica,
      motivo: req.body.motivo,
      referencia: req.body.referencia,
      usuarioId: req.user?.uid,
      idempotencyKey,
    });

    return res.status(result.reused ? 200 : 201).json({
      success: true,
      message: result.reused
        ? "Ajuste de inventario reutilizado por idempotencia"
        : "Ajuste de inventario registrado exitosamente",
      data: result.movimiento,
    });
  } catch (error) {
    console.error("Error en POST /api/inventario/ajustes:", error);

    let statusCode = 500;

    if (error instanceof Error) {
      const msg = error.message.toLowerCase();
      if (
        msg.includes("no encontrado") ||
        msg.includes("no encontrada") ||
        msg.includes("no existe")
      ) {
        statusCode = 404;
      } else if (
        msg.includes("se requiere") ||
        msg.includes("no maneja inventario") ||
        msg.includes("no puede") ||
        msg.includes("idempotency-key")
      ) {
        statusCode = 400;
      }
    }

    return res.status(statusCode).json({
      success: false,
      message:
        statusCode === 404
          ? "Recurso relacionado no encontrado"
          : statusCode === 400
            ? error instanceof Error
              ? error.message
              : "Error de validación"
            : "Error al registrar ajuste de inventario",
      error:
        statusCode === 500 && error instanceof Error
          ? error.message
          : undefined,
    });
  }
};
