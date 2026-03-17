import { Request, Response } from "express";
import galleryService from "../../services/galeria.service";

export const getAll = async (_req: Request, res: Response): Promise<Response> => {

    try {

        const galleries = await galleryService.getAll();

        return res.status(200).json({
            success: true,
            count: galleries.length,
            data: galleries
        });

    } catch (error) {

        return res.status(500).json({
            success: false,
            message: "Error al obtener galerías"
        });

    }

};

export const getById = async (req: Request, res: Response): Promise<Response> => {

    try {

        const { id } = req.params;

        const gallery = await galleryService.getById(id);

        if (!gallery) {
            return res.status(404).json({
                success: false,
                message: "Galería no encontrada"
            });
        }

        return res.status(200).json({
            success: true,
            data: gallery
        });

    } catch (error) {

        return res.status(500).json({
            success: false,
            message: "Error al obtener galería"
        });

    }

};