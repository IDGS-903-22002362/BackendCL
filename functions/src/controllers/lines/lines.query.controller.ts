import { Request, Response } from "express";
import lineService from "../../services/line.service";

/**
 * Controller: Products Query (Lectura)
 * Responsabilidad: Manejar operaciones de lectura de datos (GET)
 */
export const getAll = async (_req: Request, res: Response) => {
    try {
        const lineas = await lineService.getAllLines();
        res.status(200).json({
            success: true,
            count: lineas.length,
            data: lineas,
        });
    } catch (error) {
        console.error("Error en GET /api/lineas:", error);
        res.status(500).json({
            success: false,
            message: "Error al obtener las lineas",
            error: error instanceof Error ? error.message : "Error desconocido",
        });
    }
};

export const getById = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const linea = await lineService.getLineById(id);

        if (!linea) {
            return res.status(404).json({
                success: false,
                message: `Linea con ID ${id} no encontrado`,
            });
        }

        return res.status(200).json({
            success: true,
            data: linea,
        });
    } catch (error) {
        console.error("Error en GET /api/lineas/:id:", error);
        return res.status(500).json({
            success: false,
            message: "Error al obtener la linea",
            error: error instanceof Error ? error.message : "Error desconocido",
        });
    }
};



export const search = async (req: Request, res: Response) => {
    try {
        const { termino } = req.params;
        const lineas = await lineService.searchLines(termino);

        res.status(200).json({
            success: true,
            count: lineas.length,
            data: lineas,
        });
    } catch (error) {
        console.error("Error en GET /api/lineas/buscar/:termino:", error);
        res.status(500).json({
            success: false,
            message: "Error al buscar lineas",
            error: error instanceof Error ? error.message : "Error desconocido",
        });
    }
};
