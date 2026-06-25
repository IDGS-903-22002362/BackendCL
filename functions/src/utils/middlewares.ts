import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { getAppCheck } from "firebase-admin/app-check";
import { firestoreApp, authAppOficial } from "../config/app.firebase";
import { admin } from "../config/firebase.admin";
import { RolUsuario } from "../models/usuario.model";

// Middleware de autenticación con JWT propio
export const authMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    console.warn("❌ authMiddleware: No hay Bearer token en header");
    res.status(401).json({ message: "No autorizado. Token requerido" });
    return;
  }

  const token = authHeader.split(" ")[1];
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    console.error("auth_config_error", {
      route: req.originalUrl,
      reason: "JWT_SECRET_missing",
    });
    res.status(500).json({ message: "Error de configuración del servidor" });
    return;
  }

  try {
    // Verificar el token JWT propio con la clave secreta
    const decoded = jwt.verify(token, jwtSecret) as {
      uid: string;
      email: string;
      rol: RolUsuario;
      nombre: string;
    };

    // Buscar el usuario en Firestore para obtener datos adicionales
    const snapshot = await firestoreApp
      .collection("usuariosApp")
      .where("uid", "==", decoded.uid)
      .limit(1)
      .get();

    if (snapshot.empty) {
      res.status(404).json({ message: "Usuario no registrado en la base de datos" });
      return;
    }

    // Combinar datos del token y de Firestore
    req.user = {
      ...decoded,
      ...snapshot.docs[0].data(),
      uid: decoded.uid, // Asegurar que uid esté presente
    };

    next();
  } catch (error) {
    // Mapear errores de JWT
    let status = 401;
    let message = "Token inválido o expirado";

    if (error instanceof jwt.TokenExpiredError) {
      message = "Token expirado";
    } else if (error instanceof jwt.JsonWebTokenError) {
      message = "Token inválido";
    }

    console.error("❌ authMiddleware error:", {
      error: error instanceof Error ? error.message : error,
      route: req.originalUrl,
    });

    res.status(status).json({ message });
  }
};

const ADMIN_ROLES = new Set<RolUsuario>([
  RolUsuario.ADMIN,
  RolUsuario.EMPLEADO,
]);

export async function syncFirebaseAdminClaims(
  uid: string,
  rol: RolUsuario,
): Promise<void> {
  await authAppOficial.setCustomUserClaims(uid, {
    admin: ADMIN_ROLES.has(rol),
    rol,
  });
}

const isProductionRuntime = (): boolean =>
  process.env.NODE_ENV === "production" ||
  Boolean(process.env.K_SERVICE || process.env.FUNCTION_NAME);

export const blockDebugInProduction = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  if (!isProductionRuntime()) {
    next();
    return;
  }

  if (req.path.toLowerCase().includes("/debug")) {
    res.status(404).json({ success: false, message: "Ruta no encontrada" });
    return;
  }

  next();
};

const APP_CHECK_SKIP_PATH_PREFIXES = [
  "/api/stripe/webhook",
  "/api/pagos/webhook",
  "/api/webhooks/aplazo",
  "/health",
  "/api/health",
];

function shouldSkipAppCheck(req: Request): boolean {
  const path = req.path || "";
  const originalUrl = req.originalUrl || "";

  return APP_CHECK_SKIP_PATH_PREFIXES.some(
    (prefix) => path.startsWith(prefix) || originalUrl.startsWith(prefix),
  );
}

export const optionalAppCheckMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  if (shouldSkipAppCheck(req)) {
    next();
    return;
  }

  const enforced = process.env.APP_CHECK_ENFORCED === "true";
  const token = req.header("X-Firebase-AppCheck");

  if (!token) {
    if (enforced) {
      res.status(401).json({ success: false, message: "App Check token requerido" });
      return;
    }

    console.warn("app_check_observation_missing", {
      route: req.originalUrl,
      method: req.method,
    });
    next();
    return;
  }

  try {
    await getAppCheck(admin.app()).verifyToken(token);
    next();
  } catch (error) {
    if (enforced) {
      res.status(401).json({ success: false, message: "App Check token invalido" });
      return;
    }

    console.warn("app_check_observation_invalid", {
      route: req.originalUrl,
      method: req.method,
      reason: error instanceof Error ? error.message : "invalid",
    });
    next();
  }
};

/**
 * Middleware de autenticación opcional (para endpoints públicos/privados)
 * Intenta autenticar con JWT propio; si falla o no hay token, continúa sin usuario.
 */
// En tu archivo de middlewares (ej. utils/middlewares.ts)
export const optionalAuthMiddleware = (
  req: any,
  res: any,
  next: any
) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return next();
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!);
    req.user = decoded;
  } catch (error) {
    console.warn("Token opcional inválido");
  }

  next();
};

/**
 * Middleware de autorización para administradores
 * Verifica que el usuario autenticado tenga rol ADMIN o EMPLEADO
 * (Debe usarse DESPUÉS de authMiddleware)
 */
export const requireAdmin = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ success: false, message: "No autenticado" });
    return;
  }

  const userRole = req.user.rol as RolUsuario;
  const isAdminRole =
    userRole === RolUsuario.ADMIN || userRole === RolUsuario.EMPLEADO;

  if (!isAdminRole) {
    res.status(403).json({
      success: false,
      message: "Acceso denegado. Se requieren permisos de administrador.",
    });
    return;
  }

  const jwtAdminClaim = (req.user as { admin?: boolean }).admin;
  if (jwtAdminClaim !== true) {
    res.status(403).json({
      success: false,
      message: "Acceso denegado. Custom claim admin requerido.",
    });
    return;
  }

  next();
};
