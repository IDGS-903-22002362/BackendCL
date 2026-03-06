import { Request, Response } from "express";
import { admin } from "../../config/firebase.admin";

export const logout = async (req: Request, res: Response) => {
    try {

        const uid = (req as any).user?.uid;

        if (!uid) {
            return res.status(401).json({
                success: false,
                message: "No autenticado"
            });
        }

        /**
         * Revoca TODOS los refresh tokens del usuario.
         * Esto invalida sesiones activas en Firebase.
         */
        await admin.auth().revokeRefreshTokens(uid);

        return res.status(200).json({
            success: true,
            message: "Sesión cerrada correctamente"
        });

    } catch (error) {

        console.error("Error en logout:", error);

        return res.status(500).json({
            success: false,
            message: "Error al cerrar sesión"
        });

    }
};