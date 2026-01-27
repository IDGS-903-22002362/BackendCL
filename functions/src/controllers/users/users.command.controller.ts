import { Request, Response } from "express";
import userAppService from "../../services/user.service";
import storageService from "../../services/storage.service";

/**
 * Controller: Users Command (Escritura)
 * Responsabilidad: Manejar operaciones de mutación de datos (POST, PUT, DELETE)
 */

export const create = async (req: Request, res: Response) => {
    try {
        const usuarioData = req.body;

        /**
        const camposRequeridos = [
            "clave",
            "descripcion",
            "lineaId",
            "categoriaId",
            "precioPublico",
            "precioCompra",
            "existencias",
            "proveedorId",
        ];

        const camposFaltantes = camposRequeridos.filter(
            (campo) => !usuarioData[campo] && usuarioData[campo] !== 0
        );

        if (camposFaltantes.length > 0) {
            return res.status(400).json({
                success: false,
                message: "Faltan campos requeridos",
                camposFaltantes,
            });
        }
             */

        usuarioData.activo =
            usuarioData.activo !== undefined ? usuarioData.activo : true;

        const nuevoUsuario = await userAppService.createUser(usuarioData);

        return res.status(201).json({
            success: true,
            message: "Usuario creado exitosamente",
            data: nuevoUsuario,
        });
    } catch (error) {
        console.error("Error en POST /api/usuarios:", error);
        return res.status(500).json({
            success: false,
            message: "Error al crear el usuario",
            error: error instanceof Error ? error.message : "Error desconocido",
        });
    }
};
export const checkEmail = async (req: Request, res: Response) => {
    try {
        const { email } = req.query;

        if (!email) {
            return res.status(400).json({
                success: false,
                message: "Email requerido",
            });
        }

        const exists = await userAppService.existsByEmail(email as string);

        return res.status(200).json({
            success: true,
            exists,
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: "Error al verificar email",
        });
    }
};


export const update = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const updateData = req.body;
        const usarioActualizado = await userAppService.updateUser(
            id,
            updateData
        );

        return res.status(200).json({
            success: true,
            message: "Usuario actualizado exitosamente",
            data: usarioActualizado,
        });
    } catch (error) {
        console.error("Error en PUT /api/usuarios/:id:", error);
        const statusCode =
            error instanceof Error && error.message.includes("no encontrado")
                ? 404
                : 500;
        return res.status(statusCode).json({
            success: false,
            message: "Error al actualizar el usuario",
            error: error instanceof Error ? error.message : "Error desconocido",
        });
    }
};

export const remove = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        await userAppService.deleteUser(id);
        return res.status(200).json({
            success: true,
            message: "Usuario eliminado exitosamente",
        });
    } catch (error) {
        console.error("Error en DELETE /api/usuarios/:id:", error);
        const statusCode =
            error instanceof Error && error.message.includes("no encontrado")
                ? 404
                : 500;
        return res.status(statusCode).json({
            success: false,
            message: "Error al eliminar el usuario",
            error: error instanceof Error ? error.message : "Error desconocido",
        });
    }
};


/**
export const uploadImages = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const files = req.files as Express.Multer.File[];

        if (!files || files.length === 0) {
            return res
                .status(400)
                .json({ success: false, message: "No se enviaron archivos" });
        }

        const producto = await productService.getProductById(id);
        if (!producto) {
            return res
                .status(404)
                .json({
                    success: false,
                    message: `Producto con ID ${id} no encontrado`,
                });
        }

        const imagenesData = files.map((file) => ({
            buffer: file.buffer,
            originalName: file.originalname,
        }));

        const urls = await storageService.uploadMultipleFiles(
            imagenesData,
            "productos"
        );
        const imagenesActuales = producto.imagenes || [];
        const imagenesActualizadas = [...imagenesActuales, ...urls];

        await productService.updateProduct(id, { imagenes: imagenesActualizadas });

        return res.status(200).json({
            success: true,
            message: `${urls.length} imagen(es) subida(s) exitosamente`,
            data: { urls, totalImagenes: imagenesActualizadas.length },
        });
    } catch (error) {
        console.error("Error en POST /api/productos/:id/imagenes:", error);
        return res.status(500).json({
            success: false,
            message: "Error al subir las imágenes",
            error: error instanceof Error ? error.message : "Error desconocido",
        });
    }
};



export const deleteImage = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { imageUrl } = req.body;

        if (!imageUrl) {
            return res
                .status(400)
                .json({
                    success: false,
                    message: "Se requiere la URL de la imagen a eliminar",
                });
        }

        const producto = await productService.getProductById(id);
        if (!producto) {
            return res
                .status(404)
                .json({
                    success: false,
                    message: `Producto con ID ${id} no encontrado`,
                });
        }

        const imagenes = producto.imagenes || [];
        if (!imagenes.includes(imageUrl)) {
            return res
                .status(404)
                .json({
                    success: false,
                    message: "La imagen no existe en este producto",
                });
        }

        await storageService.deleteFile(imageUrl);
        const imagenesActualizadas = imagenes.filter((url) => url !== imageUrl);
        await productService.updateProduct(id, { imagenes: imagenesActualizadas });

        return res.status(200).json({
            success: true,
            message: "Imagen eliminada exitosamente",
            data: { imagenesRestantes: imagenesActualizadas.length },
        });
    } catch (error) {
        console.error("Error en DELETE /api/productos/:id/imagenes:", error);
        return res.status(500).json({
            success: false,
            message: "Error al eliminar la imagen",
            error: error instanceof Error ? error.message : "Error desconocido",
        });
    }
};
 */