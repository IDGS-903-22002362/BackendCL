import { Request, Response } from "express";
import inventoryService from "../../services/inventory.service";

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
