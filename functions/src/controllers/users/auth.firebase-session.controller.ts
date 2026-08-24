import { Request, Response } from "express";
import { authAppOficial } from "../../config/app.firebase";

/**
 * Emite un Firebase custom token para el uid de la sesión backend.
 *
 * Los logins con email/password terminan con JWT propio pero sin sesión de
 * Firebase Auth en el cliente, y la verificación telefónica por SMS y
 * `/usuarios/me/season-pass/verify` sí la requieren. El uid nunca se toma del
 * body: solo del token ya verificado por `authMiddleware`.
 */
export const createFirebaseSessionToken = async (
  req: Request,
  res: Response,
) => {
  const uid = req.user?.uid?.trim();
  if (!uid) {
    return res.status(401).json({
      success: false,
      message: "No autorizado. Token requerido",
      code: "AUTH_TOKEN_REQUIRED",
    });
  }

  try {
    await authAppOficial.getUser(uid);
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "auth/user-not-found") {
      console.warn("firebase_session_user_not_found", { uid });
      return res.status(404).json({
        success: false,
        message: "Tu cuenta no tiene credenciales de Firebase disponibles.",
        code: "FIREBASE_USER_NOT_FOUND",
      });
    }

    console.error("firebase_session_lookup_error", { uid, code });
    return res.status(500).json({
      success: false,
      message: "Error interno del servidor",
    });
  }

  try {
    const customToken = await authAppOficial.createCustomToken(uid);
    return res.status(200).json({
      success: true,
      data: { customToken, uid },
    });
  } catch (error) {
    console.error("firebase_session_custom_token_error", {
      uid,
      reason: error instanceof Error ? error.message : "unknown",
    });
    return res.status(500).json({
      success: false,
      message: "No fue posible iniciar tu sesión de Firebase",
    });
  }
};
