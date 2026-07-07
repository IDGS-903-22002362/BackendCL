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

export const firebaseAuthMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({
      success: false,
      message: "No autorizado. Token requerido",
      code: "AUTH_TOKEN_REQUIRED",
    });
    return;
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = await authAppOficial.verifyIdToken(token, true);
    const firebaseUser = await authAppOficial.getUser(decoded.uid);

    const snapshot = await firestoreApp
      .collection("usuariosApp")
      .where("uid", "==", decoded.uid)
      .limit(1)
      .get();

    if (snapshot.empty) {
      res.status(404).json({
        success: false,
        message: "Usuario no encontrado",
        code: "USER_NOT_FOUND",
      });
      return;
    }

    const userData = snapshot.docs[0].data();
    req.user = {
      ...userData,
      uid: decoded.uid,
      email: decoded.email ?? firebaseUser.email ?? String(userData.email ?? ""),
      rol: userData.rol as RolUsuario,
      nombre:
        firebaseUser.displayName ??
        (typeof userData.nombre === "string" ? userData.nombre : ""),
    };
    req.firebaseAuth = {
      uid: firebaseUser.uid,
      phoneNumber: firebaseUser.phoneNumber,
    };

    next();
  } catch (error) {
    console.warn("firebase_auth_middleware_denied", {
      route: req.originalUrl,
      reason: error instanceof Error ? error.message : "invalid_token",
    });
    res.status(401).json({
      success: false,
      message: "Token inválido o expirado",
      code: "AUTH_TOKEN_INVALID",
    });
  }
};

const ADMIN_ROLES = new Set<RolUsuario>([
  RolUsuario.SUPER_ADMIN,
  RolUsuario.ADMIN,
  RolUsuario.EMPLEADO,
]);

/** Roles del POS de concesiones: nunca tienen privilegios admin de tienda. */
const CONCESION_ROLES = new Set<RolUsuario>([
  RolUsuario.CONCESION_SUPERADMIN,
  RolUsuario.CONCESION_ADMIN,
  RolUsuario.CONCESION_VENDEDOR,
]);

export function isAdminRole(rol: RolUsuario | string | undefined): boolean {
  if (!rol) return false;
  // Defensa explícita: roles CONCESION_* no son admin de Club León.
  if (CONCESION_ROLES.has(rol as RolUsuario)) return false;
  return ADMIN_ROLES.has(rol as RolUsuario);
}

export function isConcesionRole(rol: RolUsuario | string | undefined): boolean {
  return CONCESION_ROLES.has(rol as RolUsuario);
}

export async function syncFirebaseAdminClaims(
  uid: string,
  rol: RolUsuario,
): Promise<void> {
  await authAppOficial.setCustomUserClaims(uid, {
    admin: isAdminRole(rol),
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
  "/stripe/webhook",
  "/api/pagos/webhook",
  "/pagos/webhook",
  "/api/webhooks/aplazo",
  "/webhooks/aplazo",
  "/api/usuarios/exists/email",
  "/usuarios/exists/email",
  "/health",
  "/api/health",
  "/api-docs",
  "/api-docs/",
  // API pública de lealtad para socios externos: autentica con OAuth Bearer
  // propio (no Firebase), por lo que App Check no aplica. Las peticiones con
  // Bearer ya omiten App Check; excluir el prefijo completo garantiza que las
  // peticiones sin token reciban el error problem+json documentado (401
  // AUTHENTICATION_REQUIRED) en lugar de un error de App Check.
  "/api/loyalty/sandbox/v1",
  "/loyalty/sandbox/v1",
  "/api/loyalty/v1",
  "/loyalty/v1",
];

/** Rutas de catálogo/tienda: GET público (SSR Next.js no puede emitir token App Check). */
const PUBLIC_STOREFRONT_READ_PREFIXES = [
  "/api/productos",
  "/productos",
  "/api/lineas",
  "/lineas",
  "/api/categorias",
  "/categorias",
  "/api/tallas",
  "/tallas",
  "/api/banners",
  "/banners",
  "/api/recomendaciones",
  "/recomendaciones",
  "/api/noticias",
  "/noticias",
  "/api/beneficios",
  "/beneficios",
  "/api/liga-mx",
  "/liga-mx",
  "/api/pickup-locations",
  "/pickup-locations",
  "/api/plantilla",
  "/plantilla",
  "/api/galeria",
  "/galeria",
];

/** Cálculo de ofertas en catálogo (POST público sin auth). */
const PUBLIC_STOREFRONT_ALL_METHODS_PREFIXES = [
  "/api/ofertas",
  "/ofertas",
];

const AUTH_AND_CHECKOUT_PREFIXES = [
  "/api/auth",
  "/auth",
  "/api/carrito",
  "/carrito",
  "/api/checkout",
  "/checkout",
  "/api/codigos-promocion",
  "/codigos-promocion",
  "/api/contacto",
  "/contacto",
  "/api/shipping",
  "/shipping",
  "/api/favoritos",
  "/favoritos",
  "/api/payments",
  "/payments",
];

function getNormalizedRequestPaths(req: Request): string[] {
  const path = req.path || "";
  const originalPath = (req.originalUrl || "").split("?")[0] ?? "";
  return Array.from(new Set([path, originalPath].filter(Boolean)));
}

function pathMatchesPrefix(candidate: string, prefix: string): boolean {
  return (
    candidate === prefix ||
    candidate.startsWith(`${prefix}/`) ||
    candidate.endsWith(prefix)
  );
}

function pathsMatchAnyPrefix(paths: string[], prefixes: string[]): boolean {
  return prefixes.some((prefix) =>
    paths.some((candidate) => pathMatchesPrefix(candidate, prefix)),
  );
}

function hasBearerAuthorization(req: Request): boolean {
  const authHeader = req.header("Authorization") || req.header("authorization");
  return Boolean(authHeader?.startsWith("Bearer "));
}

function isPublicStorefrontAllMethods(req: Request): boolean {
  return pathsMatchAnyPrefix(
    getNormalizedRequestPaths(req),
    PUBLIC_STOREFRONT_ALL_METHODS_PREFIXES,
  );
}

function isPublicStorefrontRead(req: Request): boolean {
  const method = (req.method || "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    return false;
  }

  return pathsMatchAnyPrefix(
    getNormalizedRequestPaths(req),
    PUBLIC_STOREFRONT_READ_PREFIXES,
  );
}

export async function verifyClientAppCheckToken(token: string): Promise<void> {
  const appOficial = admin.app("APP_OFICIAL");
  await getAppCheck(appOficial).verifyToken(token);
}

function shouldSkipAppCheck(req: Request): boolean {
  const paths = getNormalizedRequestPaths(req);

  if (pathsMatchAnyPrefix(paths, APP_CHECK_SKIP_PATH_PREFIXES)) {
    return true;
  }

  if (pathsMatchAnyPrefix(paths, AUTH_AND_CHECKOUT_PREFIXES)) {
    return true;
  }

  if (isPublicStorefrontAllMethods(req)) {
    return true;
  }

  if (isPublicStorefrontRead(req)) {
    return true;
  }

  // JWT de sesión ya autentica al cliente (admin, empleado, usuario).
  if (hasBearerAuthorization(req)) {
    return true;
  }

  return false;
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
    await verifyClientAppCheckToken(token);
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

  if (!isAdminRole(userRole)) {
    res.status(403).json({
      success: false,
      message: "Acceso denegado. Se requieren permisos de administrador.",
    });
    return;
  }

  next();
};
