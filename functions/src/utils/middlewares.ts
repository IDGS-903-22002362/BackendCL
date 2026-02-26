import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { firestoreApp } from "../config/app.firebase";
import { RolUsuario } from "../models/usuario.model";

// Middleware de autenticación con JWT propio
export const authMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ message: "No autorizado. Token requerido" });
    return;
  }

  const token = authHeader.split(" ")[1];

  try {
    // Verificar el token JWT propio con la clave secreta
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as {
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

/**
 * Middleware de autenticación opcional (para endpoints públicos/privados)
 * Intenta autenticar con JWT propio; si falla o no hay token, continúa sin usuario.
 */
export const optionalAuthMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    next(); // Sin token → anónimo
    return;
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as {
      uid: string;
    };

    const snapshot = await firestoreApp
      .collection("usuariosApp")
      .where("uid", "==", decoded.uid)
      .limit(1)
      .get();

    if (!snapshot.empty) {
      req.user = {
        ...decoded,
        ...snapshot.docs[0].data(),
        uid: decoded.uid,
      };
    }
    next();
  } catch {
    // Token inválido o expirado → anónimo
    next();
  }
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
  if (userRole !== RolUsuario.ADMIN && userRole !== RolUsuario.EMPLEADO) {
    res.status(403).json({ success: false, message: "Acceso denegado. Se requieren permisos de administrador." });
    return;
  }

  next();
};