// controllers/detalleProducto.command.controller.ts
import { Request, Response } from "express";

import { z } from "zod";
import detalleProductoService from "../../services/detalleProducto.service";
import { createDetalleProductoSchema, updateDetalleProductoSchema } from "../../middleware/validators/detalleProducto.validator";

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

/**
 * Crea un nuevo detalle para un producto.
 * POST /api/productos/:productoId/detalles
 */
export const createDetalle = async (req: Request, res: Response) => {
    try {
        const { productoId } = req.params;
        // Validar body con Zod
        const validatedData = createDetalleProductoSchema.parse(req.body);

        const nuevoDetalle = await detalleProductoService.createDetalle(productoId, validatedData);

        return res.status(201).json({
            success: true,
            message: "Detalle creado exitosamente",
            data: nuevoDetalle,
        });
    } catch (error) {
        console.error("Error en POST /api/productos/:productoId/detalles:", error);
        let statusCode = 500;
        let errorMessage = "Error desconocido";

        if (error instanceof z.ZodError) {
            return res.status(400).json({
                success: false,
                message: "Error de validación",
                errors: error.errors,
            });
        }
        if (error instanceof Error) {
            errorMessage = error.message;
            const msg = error.message.toLowerCase();
            if (msg.includes("no encontrado") || msg.includes("inactivo")) {
                statusCode = 404;
            }
        }

        return res.status(statusCode).json({
            success: false,
            message: statusCode === 404 ? errorMessage : "Error al crear el detalle",
            error: errorMessage,
        });
    }
};

/**
 * Actualiza un detalle existente.
 * PUT /api/productos/:productoId/detalles/:detalleId
 */
export const updateDetalle = async (req: Request, res: Response) => {
    try {
        const { productoId, detalleId } = req.params;
        const validatedData = updateDetalleProductoSchema.parse(req.body);

        const detalleActualizado = await detalleProductoService.updateDetalle(
            productoId,
            detalleId,
            validatedData
        );

        return res.status(200).json({
            success: true,
            message: "Detalle actualizado exitosamente",
            data: detalleActualizado,
        });
    } catch (error) {
        console.error("Error en PUT /api/productos/:productoId/detalles/:detalleId:", error);
        let statusCode = 500;
        let errorMessage = "Error desconocido";
        if (error instanceof Error) {
            errorMessage = error.message;
            const msg = error.message.toLowerCase();
            if (msg.includes("no encontrado")) {
                statusCode = 404;
            }
        }
        return res.status(statusCode).json({
            success: false,
            message: statusCode === 404 ? errorMessage : "Error al actualizar el detalle",
            error: errorMessage,
        });
    }
};

/**
 * Elimina un detalle.
 * DELETE /api/productos/:productoId/detalles/:detalleId
 */
export const deleteDetalle = async (req: Request, res: Response) => {
    try {
        const { productoId, detalleId } = req.params;

        await detalleProductoService.deleteDetalle(productoId, detalleId);

        return res.status(200).json({
            success: true,
            message: "Detalle eliminado exitosamente",
        });
    } catch (error) {
        console.error("Error en DELETE /api/productos/:productoId/detalles/:detalleId:", error);
        let statusCode = 500;
        let errorMessage = "Error desconocido";
        if (error instanceof Error) {
            errorMessage = error.message;
            const msg = error.message.toLowerCase();
            if (msg.includes("no encontrado")) {
                statusCode = 404;
            }
        }

        return res.status(statusCode).json({
            success: false,
            message: statusCode === 404 ? errorMessage : "Error al eliminar el detalle",
            error: errorMessage,
        });
    }
};