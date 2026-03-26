import { Request, Response } from "express";
import favoritoService from "../../services/favorito.service";
import { ListFavoritosQuery } from "../models/favorito.model";

export const getFavoritos = async (req: Request, res: Response) => {
  try {
    const usuarioId = (req as any).user?.uid;
    const limit = Number(req.query.limit) || 20;
    const offset = Number(req.query.offset) || 0;

    if (!usuarioId) {
      return res.status(401).json({
        success: false,
        message: "No autenticado",
      });
    }

    const favoritos = await favoritoService.getFavoritos(usuarioId, limit, offset);

    return res.status(200).json({
      success: true,
      count: favoritos.length,
      data: favoritos,
    });
  } catch (error) {
    console.error("Error en GET /api/favoritos:", error);
    return res.status(500).json({
      success: false,
      message: "Error al listar favoritos",
    });
  }
};

export const checkFavorito = async (req: Request, res: Response) => {
  try {
    const usuarioId = (req as any).user?.uid;
    const { productoId } = req.params;

    if (!usuarioId) {
      return res.status(401).json({
        success: false,
        message: "No autenticado",
      });
    }

    const esFavorito = await favoritoService.isFavorito(usuarioId, productoId);

    return res.status(200).json({
      success: true,
      data: { esFavorito },
    });
  } catch (error) {
    console.error("Error en GET /api/favoritos/check/:productoId:", error);
    return res.status(500).json({
      success: false,
      message: "Error al verificar favorito",
    });
  }
};