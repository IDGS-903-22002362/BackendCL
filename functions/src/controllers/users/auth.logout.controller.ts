import { Request, Response } from "express";
import { authAppOficial } from "../../config/app.firebase";

function maskUid(uid: string): string {
    if (uid.length <= 8) {
        return `${uid.slice(0, 2)}...`;
    }

    return `${uid.slice(0, 4)}...${uid.slice(-4)}`;
}

export const logout = async (req: Request, res: Response) => {
    try {
        const uid = (req as any).user?.uid;

        if (!uid) {
            return res.status(401).json({
                success: false,
                message: "No autenticado"
            });
        }

        console.info("auth_logout_local", {
            uid: maskUid(uid),
            revokeRefreshTokens: false,
        });

        return res.status(200).json({
            success: true,
            message: "Sesion local cerrada correctamente"
        });

    } catch (error) {
        console.error("Error en logout:", error);

        return res.status(500).json({
            success: false,
            message: "Error al cerrar sesion"
        });

    }
};

export const logoutAllSessions = async (req: Request, res: Response) => {
    try {
        const uid = (req as any).user?.uid;

        if (!uid) {
            return res.status(401).json({
                success: false,
                message: "No autenticado"
            });
        }

        await authAppOficial.revokeRefreshTokens(uid);

        console.info("auth_logout_all_sessions", {
            uid: maskUid(uid),
            revokeRefreshTokens: true,
        });

        return res.status(200).json({
            success: true,
            message: "Todas las sesiones fueron revocadas correctamente"
        });

    } catch (error) {
        console.error("Error en logoutAllSessions:", error);

        return res.status(500).json({
            success: false,
            message: "Error al cerrar todas las sesiones"
        });

    }
};
