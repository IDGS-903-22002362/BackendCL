import { Request, Response } from "express";
import userAppService from "../../services/user.service";

/**
 * Controller: Products Query (Lectura)
 * Responsabilidad: Manejar operaciones de lectura de datos (GET)
 */
export const getAll = async (_req: Request, res: Response) => {
    try {
        const usuarios = await userAppService.getAllUsers();
        res.status(200).json({
            success: true,
            count: usuarios.length,
            data: usuarios,
        });
    } catch (error) {
        console.error("Error en GET /api/usuarios:", error);
        res.status(500).json({
            success: false,
            message: "Error al obtener los usuarios",
            error: error instanceof Error ? error.message : "Error desconocido",
        });
    }
};

export const getById = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const usuario = await userAppService.getUserById(id);

        if (!usuario) {
            return res.status(404).json({
                success: false,
                message: `Usuario con ID ${id} no encontrado`,
            });
        }

        return res.status(200).json({
            success: true,
            data: usuario,
        });
    } catch (error) {
        console.error("Error en GET /api/usuarios/:id:", error);
        return res.status(500).json({
            success: false,
            message: "Error al obtener el usuario",
            error: error instanceof Error ? error.message : "Error desconocido",
        });
    }
};

/** 
export const getByCategory = async (req: Request, res: Response) => {
    try {
        const { categoriaId } = req.params;
        const productos = await userAppService.getProductsByCategory(categoriaId);

        res.status(200).json({
            success: true,
            count: productos.length,
            data: productos,
        });
    } catch (error) {
        console.error("Error en GET /api/productos/categoria/:categoriaId:", error);
        res.status(500).json({
            success: false,
            message: "Error al obtener productos por categoría",
            error: error instanceof Error ? error.message : "Error desconocido",
        });
    }
};

export const getByLine = async (req: Request, res: Response) => {
    try {
        const { lineaId } = req.params;
        const productos = await productService.getProductsByLine(lineaId);

        res.status(200).json({
            success: true,
            count: productos.length,
            data: productos,
        });
    } catch (error) {
        console.error("Error en GET /api/productos/linea/:lineaId:", error);
        res.status(500).json({
            success: false,
            message: "Error al obtener productos por línea",
            error: error instanceof Error ? error.message : "Error desconocido",
        });
    }
};
*/

export const search = async (req: Request, res: Response) => {
    try {
        const { termino } = req.params;
        const usuarios = await userAppService.searchUsers(termino);

        res.status(200).json({
            success: true,
            count: usuarios.length,
            data: usuarios,
        });
    } catch (error) {
        console.error("Error en GET /api/usuarios/buscar/:termino:", error);
        res.status(500).json({
            success: false,
            message: "Error al buscar usuarios",
            error: error instanceof Error ? error.message : "Error desconocido",
        });
    }
};

