import { Request, Response } from "express";
import { firestoreApp } from "../../config/app.firebase";
import { sendVerificationEmail } from "../../lib/brevo/client";
import { isAppleReviewTestEmail } from "../../lib/auth/apple-review-credentials";
import otpService from "../../lib/firebase/otp-service";
import jwt from "jsonwebtoken";
import { RolUsuario } from "../../models/usuario.model";
import { isAdminRole, syncFirebaseAdminClaims } from "../../utils/middlewares";

export async function requestVerificationCode(req: Request, res: Response) {
    try {
        const { email } = req.body;

        if (!email || !email.trim()) {
            return res.status(400).json({
                success: false,
                message: "El correo electrónico es requerido"
            });
        }

        // Normalizar email
        const normalizedEmail = email.toLowerCase().trim();

        if (isAppleReviewTestEmail(normalizedEmail)) {
            return res.status(400).json({
                success: false,
                message: "Esta cuenta debe iniciar sesión con correo y contraseña",
            });
        }

        // Verificar si el usuario existe en Firestore
        const snapshot = await firestoreApp
            .collection("usuariosApp")
            .where("email", "==", normalizedEmail)
            .where("activo", "==", true)
            .limit(1)
            .get();

        if (snapshot.empty) {
            return res.status(404).json({
                success: false,
                message: "No existe una cuenta con este correo electrónico"
            });
        }

        const userData = snapshot.docs[0].data();

        // Limpiar códigos anteriores del mismo usuario
        await otpService.clearUserCodes(normalizedEmail);

        // Generar y almacenar nuevo OTP
        const { code, success } = await otpService.storeOTP(normalizedEmail);

        if (!success) {
            return res.status(500).json({
                success: false,
                message: "Error al generar el código de verificación"
            });
        }

        // Enviar email con Brevo
        const emailSent = await sendVerificationEmail(
            normalizedEmail,
            code,
            userData.nombre || userData.email
        );

        if (!emailSent) {
            return res.status(500).json({
                success: false,
                message: "Error al enviar el código de verificación. Intenta nuevamente."
            });
        }

        return res.status(200).json({
            success: true,
            message: "Código de verificación enviado a tu correo electrónico",
            expiresIn: 10 // minutos
        });

    } catch (error) {
        console.error("Error en requestVerificationCode:", error);
        return res.status(500).json({
            success: false,
            message: "Error interno del servidor"
        });
    }
}

export async function verifyAndLogin(req: Request, res: Response) {
    try {
        const { email, verificationCode } = req.body;

        if (!email || !verificationCode) {
            return res.status(400).json({
                success: false,
                message: "Correo y código de verificación son requeridos"
            });
        }

        const normalizedEmail = email.toLowerCase().trim();

        // Verificar el código OTP
        const verification = await otpService.verifyOTP(normalizedEmail, verificationCode);

        if (!verification.valid) {
            return res.status(401).json({
                success: false,
                message: verification.message,
                remainingAttempts: verification.remainingAttempts
            });
        }

        // Obtener usuario de Firestore
        const snapshot = await firestoreApp
            .collection("usuariosApp")
            .where("email", "==", normalizedEmail)
            .where("activo", "==", true)
            .limit(1)
            .get();

        if (snapshot.empty) {
            return res.status(404).json({
                success: false,
                message: "Usuario no encontrado"
            });
        }

        const userDoc = snapshot.docs[0];
        const userData = userDoc.data();
        const rol = userData.rol as RolUsuario;

        try {
            await syncFirebaseAdminClaims(userData.uid, rol);
        } catch (claimsError) {
            console.error("admin_claims_sync_error", {
                uid: userData.uid,
                reason:
                    claimsError instanceof Error ? claimsError.message : "unknown",
            });
        }

        const isAdminUser = isAdminRole(rol);

        // Generar JWT para la sesión
        const jwtSecret = process.env.JWT_SECRET;
        if (!jwtSecret) {
            throw new Error("JWT_SECRET no configurado");
        }

        const token = jwt.sign(
            {
                uid: userData.uid,
                email: userData.email,
                rol,
                nombre: userData.nombre,
                admin: isAdminUser,
            },
            jwtSecret,
            { expiresIn: "7d" }
        );

        return res.status(200).json({
            success: true,
            message: "Inicio de sesión exitoso",
            data: {
                token,
                user: {
                    uid: userData.uid,
                    email: userData.email,
                    nombre: userData.nombre,
                    rol: userData.rol,
                    telefono: userData.telefono ?? null,
                    fechaNacimiento: userData.fechaNacimiento ?? null,
                    genero: userData.genero ?? "",
                    perfilCompleto: userData.perfilCompleto ?? false
                }
            }
        });

    } catch (error) {
        console.error("Error en verifyAndLogin:", error);
        return res.status(500).json({
            success: false,
            message: "Error interno del servidor"
        });
    }
}

// Endpoint adicional para limpieza manual (opcional, para cron jobs)
export async function cleanupExpiredCodes(req: Request, res: Response) {
    try {
        // Verificar que sea admin
        if (req.user?.rol !== 'ADMIN') {
            return res.status(403).json({
                success: false,
                message: "No autorizado"
            });
        }

        const deletedCount = await otpService.manualCleanup();
        const stats = await otpService.getStats();

        return res.status(200).json({
            success: true,
            message: "Limpieza completada",
            data: {
                deleted: deletedCount,
                stats
            }
        });
    } catch (error) {
        console.error("Error en cleanup:", error);
        return res.status(500).json({
            success: false,
            message: "Error en limpieza"
        });
    }
}

// Endpoint para estadísticas (debug/admin)
export async function getOTPStats(req: Request, res: Response) {
    try {
        // Verificar que sea admin
        if (req.user?.rol !== 'ADMIN') {
            return res.status(403).json({
                success: false,
                message: "No autorizado"
            });
        }

        const stats = await otpService.getStats();

        return res.status(200).json({
            success: true,
            data: stats
        });
    } catch (error) {
        console.error("Error obteniendo estadísticas:", error);
        return res.status(500).json({
            success: false,
            message: "Error obteniendo estadísticas"
        });
    }
}