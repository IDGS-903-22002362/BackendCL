import { Request, Response } from "express";
import userAppService from "../../services/user.service";

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
export const completarPerfil = async (req: Request, res: Response) => {
    try {

        const uid = (req as any).user.uid; // viene del middleware auth
        const data = req.body;

        const usuario = await userAppService.updateByUid(uid, {
            telefono: data.telefono,
            fechaNacimiento: data.fechaNacimiento,
            perfilCompleto: true
        });

        return res.status(200).json({
            success: true,
            data: usuario
        });

    } catch (error) {
        return res.status(500).json({
            success: false,
            message: "Error completando perfil"
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
