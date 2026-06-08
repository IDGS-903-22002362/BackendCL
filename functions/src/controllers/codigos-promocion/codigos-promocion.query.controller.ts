import type { Request, Response } from "express";

import { codigosPromocionService } from "../../services/codigos-promocion.service";
import type { CodigoPromocionFilters } from "../../models/codigos-promocion.model";

function parseBooleanQuery(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;

  if (value === "true") return true;
  if (value === "false") return false;

  return undefined;
}

function parseStringQuery(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;

  const trimmed = value.trim();

  return trimmed.length > 0 ? trimmed : undefined;
}

function parseAplicaAQuery(
  value: unknown,
): CodigoPromocionFilters["aplicaA"] | undefined {
  if (value === "productos" || value === "categorias" || value === "lineas") {
    return value;
  }

  return undefined;
}

export const codigosPromocionQueryController = {
  async listar(req: Request, res: Response): Promise<void> {
    try {
      const filters: CodigoPromocionFilters = {
        estado: parseBooleanQuery(req.query.estado),
        codigo: parseStringQuery(req.query.codigo),
        aplicaA: parseAplicaAQuery(req.query.aplicaA),
        productoId: parseStringQuery(req.query.productoId),
        categoriaId: parseStringQuery(req.query.categoriaId),
        lineaId: parseStringQuery(req.query.lineaId),
        incluirEliminados:
          parseBooleanQuery(req.query.incluirEliminados) ?? false,
      };

      const codigos = await codigosPromocionService.listar(filters);

      res.status(200).json({
        success: true,
        data: codigos,
        total: codigos.length,
      });
    } catch (error) {
      console.error("Error al listar códigos promocionales:", error);

      res.status(500).json({
        success: false,
        message: "Error al listar códigos promocionales.",
      });
    }
  },

  async obtenerPorId(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;

      const codigoPromocion = await codigosPromocionService.obtenerPorId(id);

      if (!codigoPromocion) {
        res.status(404).json({
          success: false,
          message: "Código promocional no encontrado.",
        });
        return;
      }

      res.status(200).json({
        success: true,
        data: codigoPromocion,
      });
    } catch (error) {
      console.error("Error al obtener código promocional:", error);

      res.status(500).json({
        success: false,
        message: "Error al obtener código promocional.",
      });
    }
  },

  async validar(req: Request, res: Response): Promise<void> {
    try {
      const resultado = await codigosPromocionService.validar(req.body);

      res.status(200).json({
        success: true,
        data: resultado,
      });
    } catch (error) {
      console.error("Error al validar código promocional:", error);

      res.status(500).json({
        success: false,
        message: "Error al validar código promocional.",
      });
    }
  },
};