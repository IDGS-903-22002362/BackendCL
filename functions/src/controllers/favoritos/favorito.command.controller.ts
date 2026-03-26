import { Request, Response } from "express";
import favoritoService from "../../services/favorito.service";
import { ListFavoritosQuery } from "../models/favorito.model";

export const createFavorito = async (req: Request, res: Response) => {
  try {
    const usuarioId = (req as any).user?.uid; // viene del authMiddleware
    const { productoId } = req.body;

    if (!usuarioId) {
      return res.status(401).json({
        success: false,
        message: "No autenticado",
      });
    }

    const favorito = await favoritoService.createFavorito(usuarioId, productoId);

    return res.status(201).json({
      success: true,
      message: "Producto agregado a favoritos",
      data: favorito,
    });
  } catch (error) {
    console.error("Error en POST /api/favoritos:", error);
    const statusCode =
      error instanceof Error && error.message.includes("no encontrado")
        ? 404
        : 400;
    return res.status(statusCode).json({
      success: false,
      message: error instanceof Error ? error.message : "Error al agregar favorito",
    });
  }
};

export const deleteFavorito = async (req: Request, res: Response) => {
  try {
    const usuarioId = (req as any).user?.uid;
    const { productoId } = req.params;

    if (!usuarioId) {
      return res.status(401).json({
        success: false,
        message: "No autenticado",
      });
    }

    await favoritoService.deleteFavorito(usuarioId, productoId);

    return res.status(200).json({
      success: true,
      message: "Producto eliminado de favoritos",
    });
  } catch (error) {
    console.error("Error en DELETE /api/favoritos/:productoId:", error);
    const statusCode =
      error instanceof Error && error.message.includes("no está en favoritos")
        ? 404
        : 400;
    return res.status(statusCode).json({
      success: false,
      message: error instanceof Error ? error.message : "Error al eliminar favorito",
    });
  }
};