import type { Request, Response } from "express";

import { ofertasService } from "../../services/ofertas.service";
import type {
  CreateOfertaDto,
  UpdateOfertaDto,
} from "../../models/ofertas.model";

type AuthObjectLike = {
  uid?: unknown;
  id?: unknown;
  userId?: unknown;
  email?: unknown;
};

function getStringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}

function getAuthObject(value: unknown): AuthObjectLike | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  return value as AuthObjectLike;
}

function getRequestUserId(req: Request): string | undefined {
  const reqRecord = req as unknown as Record<string, unknown>;

  const user = getAuthObject(reqRecord.user);
  const usuario = getAuthObject(reqRecord.usuario);

  return (
    getStringValue(user?.uid) ??
    getStringValue(user?.id) ??
    getStringValue(user?.userId) ??
    getStringValue(usuario?.uid) ??
    getStringValue(usuario?.id) ??
    getStringValue(usuario?.userId)
  );
}

function handleError(res: Response, error: unknown): void {
  const message =
    error instanceof Error ? error.message : "Error interno del servidor";

  if (message.toLowerCase().includes("no encontrada")) {
    res.status(404).json({
      success: false,
      message,
    });
    return;
  }

  if (message.toLowerCase().includes("ya existe")) {
    res.status(409).json({
      success: false,
      message,
    });
    return;
  }

  if (
    message.toLowerCase().includes("no tiene") ||
    message.toLowerCase().includes("no válido") ||
    message.toLowerCase().includes("stock") ||
    message.toLowerCase().includes("cantidad")
  ) {
    res.status(400).json({
      success: false,
      message,
    });
    return;
  }

  res.status(500).json({
    success: false,
    message,
  });
}

export class OfertasCommandController {
  crear = async (req: Request, res: Response): Promise<void> => {
    try {
      const data = req.body as CreateOfertaDto;
      const userId = getRequestUserId(req);

      const oferta = await ofertasService.crearOferta(data, userId);

      res.status(201).json({
        success: true,
        message: "Oferta creada correctamente",
        data: oferta,
      });
    } catch (error: unknown) {
      handleError(res, error);
    }
  };

  actualizar = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const data = req.body as UpdateOfertaDto;
      const userId = getRequestUserId(req);

      const oferta = await ofertasService.actualizarOferta(id, data, userId);

      res.status(200).json({
        success: true,
        message: "Oferta actualizada correctamente",
        data: oferta,
      });
    } catch (error: unknown) {
      handleError(res, error);
    }
  };

  eliminar = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const userId = getRequestUserId(req);

      await ofertasService.eliminarOferta(id, userId);

      res.status(200).json({
        success: true,
        message: "Oferta eliminada correctamente",
      });
    } catch (error: unknown) {
      handleError(res, error);
    }
  };
}

export const ofertasCommandController = new OfertasCommandController();