import type { Request, Response } from "express";

import { ofertasService } from "../../services/ofertas.service";
import type {
  CalcularPreciosOfertaDto,
  Oferta,
} from "../../models/ofertas.model";

function parseBooleanQuery(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;

  return undefined;
}

function parseNumberQuery(value: unknown): number | undefined {
  if (typeof value === "number") return value;

  if (typeof value === "string" && /^\d+$/.test(value)) {
    return Number(value);
  }

  return undefined;
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

export class OfertasQueryController {
  listar = async (req: Request, res: Response): Promise<void> => {
    try {
      const ofertas = await ofertasService.listarOfertas({
        estado: parseBooleanQuery(req.query.estado),

        aplicaA:
          typeof req.query.aplicaA === "string"
            ? (req.query.aplicaA as Oferta["aplicaA"])
            : undefined,

        tipoDescuento:
          typeof req.query.tipoDescuento === "string"
            ? (req.query.tipoDescuento as Oferta["tipoDescuento"])
            : undefined,

        productoId:
          typeof req.query.productoId === "string"
            ? req.query.productoId
            : undefined,

        categoriaId:
          typeof req.query.categoriaId === "string"
            ? req.query.categoriaId
            : undefined,

        lineaId:
          typeof req.query.lineaId === "string"
            ? req.query.lineaId
            : undefined,

        tallaId:
          typeof req.query.tallaId === "string"
            ? req.query.tallaId
            : undefined,

        q: typeof req.query.q === "string" ? req.query.q : undefined,

        limit: parseNumberQuery(req.query.limit),
      });

      res.status(200).json({
        success: true,
        data: ofertas,
      });
    } catch (error: unknown) {
      handleError(res, error);
    }
  };

  listarActivas = async (_req: Request, res: Response): Promise<void> => {
    try {
      const ofertas = await ofertasService.listarOfertasActivas();

      res.status(200).json({
        success: true,
        data: ofertas,
      });
    } catch (error: unknown) {
      handleError(res, error);
    }
  };

  obtenerPorId = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;

      const oferta = await ofertasService.obtenerOfertaPorId(id);

      if (!oferta) {
        res.status(404).json({
          success: false,
          message: "Oferta no encontrada",
        });
        return;
      }

      res.status(200).json({
        success: true,
        data: oferta,
      });
    } catch (error: unknown) {
      handleError(res, error);
    }
  };

  calcularPrecios = async (req: Request, res: Response): Promise<void> => {
    try {
      const data = req.body as CalcularPreciosOfertaDto;

      const resultado = await ofertasService.calcularPreciosCarrito(data.items);

      res.status(200).json({
        success: true,
        data: resultado,
      });
    } catch (error: unknown) {
      handleError(res, error);
    }
  };
}

export const ofertasQueryController = new OfertasQueryController();