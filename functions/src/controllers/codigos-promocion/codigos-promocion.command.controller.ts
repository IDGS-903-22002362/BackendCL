import type { Request, Response } from "express";

import { codigosPromocionService } from "../../services/codigos-promocion.service";

type RequestWithAuth = Request & {
  usuario?: {
    uid?: string;
    id?: string;
    email?: string;
  };
  user?: {
    uid?: string;
    id?: string;
    email?: string;
  };
};

function getRequestUserId(req: Request): string | null {
  const authReq = req as RequestWithAuth;

  return (
    authReq.usuario?.uid ??
    authReq.usuario?.id ??
    authReq.user?.uid ??
    authReq.user?.id ??
    authReq.user?.email ??
    authReq.usuario?.email ??
    null
  );
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "Ocurrió un error inesperado.";
}

export const codigosPromocionCommandController = {
  async crear(req: Request, res: Response): Promise<void> {
    try {
      const userId = getRequestUserId(req);

      const codigoPromocion = await codigosPromocionService.crear(
        req.body,
        userId,
      );

      res.status(201).json({
        success: true,
        message: "Código promocional creado correctamente.",
        data: codigoPromocion,
      });
    } catch (error) {
      console.error("Error al crear código promocional:", error);

      res.status(400).json({
        success: false,
        message: getErrorMessage(error),
      });
    }
  },

  async actualizar(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const userId = getRequestUserId(req);

      const codigoPromocion = await codigosPromocionService.actualizar(
        id,
        req.body,
        userId,
      );

      if (!codigoPromocion) {
        res.status(404).json({
          success: false,
          message: "Código promocional no encontrado.",
        });
        return;
      }

      res.status(200).json({
        success: true,
        message: "Código promocional actualizado correctamente.",
        data: codigoPromocion,
      });
    } catch (error) {
      console.error("Error al actualizar código promocional:", error);

      res.status(400).json({
        success: false,
        message: getErrorMessage(error),
      });
    }
  },

  async eliminar(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const userId = getRequestUserId(req);

      const eliminado = await codigosPromocionService.eliminar(id, userId);

      if (!eliminado) {
        res.status(404).json({
          success: false,
          message: "Código promocional no encontrado.",
        });
        return;
      }

      res.status(200).json({
        success: true,
        message: "Código promocional eliminado correctamente.",
      });
    } catch (error) {
      console.error("Error al eliminar código promocional:", error);

      res.status(500).json({
        success: false,
        message: "Error al eliminar código promocional.",
      });
    }
  },
};