// controllers/detalleProducto.query.controller.ts
import { Request, Response } from "express";
import detalleProductoService from "../../services/detalleProducto.service";

/**
 * Obtiene todos los detalles de un producto.
 * GET /api/productos/:productoId/detalles
 */
export const getDetallesByProducto = async (req: Request, res: Response) => {
    try {
        const { productoId } = req.params;
        const detalles = await detalleProductoService.getDetallesByProducto(productoId);

        return res.status(200).json({
            success: true,
            count: detalles.length,
            data: detalles,
        });
    } catch (error) {
        console.error("Error en GET /api/productos/:productoId/detalles:", error);
        return res.status(500).json({
            success: false,
            message: "Error al obtener los detalles del producto",
            error: error instanceof Error ? error.message : "Error desconocido",
        });
    }
};

/**
 * Obtiene un detalle específico por ID.
 * GET /api/productos/:productoId/detalles/:detalleId
 */
export const getDetalleById = async (req: Request, res: Response) => {
    try {
        const { productoId, detalleId } = req.params;
        const detalle = await detalleProductoService.getDetalleById(productoId, detalleId);

        if (!detalle) {
            return res.status(404).json({
                success: false,
                message: `Detalle con ID ${detalleId} no encontrado en el producto ${productoId}`,
            });
        }

        return res.status(200).json({
            success: true,
            data: detalle,
        });
    } catch (error) {
        console.error("Error en GET /api/productos/:productoId/detalles/:detalleId:", error);
        return res.status(500).json({
            success: false,
            message: "Error al obtener el detalle",
            error: error instanceof Error ? error.message : "Error desconocido",
        });
    }
};