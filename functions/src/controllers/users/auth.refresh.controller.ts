import { Request, Response } from "express";
import jwt from 'jsonwebtoken';
import { firestoreApp } from "../../config/app.firebase";
import { RolUsuario } from "../../models/usuario.model";

export const refreshToken = async (req: Request, res: Response) => {
    try {
        const token = req.headers.authorization?.split("Bearer ")[1];
        if (!token) {
            return res.status(401).json({ success: false, message: "Token requerido" });
        }

        const jwtSecret = process.env.JWT_SECRET;
        if (!jwtSecret) {
            console.error("JWT_SECRET no definido en entorno");
            return res.status(500).json({ success: false, message: "Error de configuración del servidor" });
        }

        // Verificar token actual (ignorar expiración para poder renovar)
        let decoded: any;
        try {
            decoded = jwt.verify(token, jwtSecret, { ignoreExpiration: true });
        } catch (error) {
            return res.status(401).json({ success: false, message: "Token inválido" });
        }

        // Buscar usuario en Firestore
        const snapshot = await firestoreApp
            .collection("usuariosApp")
            .where("uid", "==", decoded.uid)
            .limit(1)
            .get();

        if (snapshot.empty) {
            return res.status(404).json({ success: false, message: "Usuario no encontrado" });
        }

        const userDoc = snapshot.docs[0];
        const userData = userDoc.data();

        if (!userData.activo) {
            return res.status(403).json({ success: false, message: "Usuario desactivado" });
        }

        // Generar nuevo token con datos actualizados
        const newPayload = {
            uid: userData.uid,
            email: userData.email,
            rol: userData.rol as RolUsuario,
            nombre: userData.nombre,
        };

        const expiresIn = process.env.JWT_EXPIRES_IN || '7d';
        const newToken = jwt.sign(newPayload, jwtSecret, { expiresIn } as jwt.SignOptions);

        return res.json({
            success: true,
            token: newToken,
            usuario: {
                id: userDoc.id,
                ...userData,
            },
        });

    } catch (error) {
        console.error("Error en refresh token:", error);
        return res.status(500).json({ success: false, message: "Error interno del servidor" });
    }
};