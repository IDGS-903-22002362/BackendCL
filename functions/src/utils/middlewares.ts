import { authAppOficial, firestoreApp } from "../config/app.firebase";
import { Request, Response, NextFunction } from "express";
import { RolUsuario } from "../models/usuario.model";
import { mapFirebaseError } from "./firebase-error.util";

//Middleware de autenticacion
export const authMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const token = req.headers.authorization?.split("Bearer ")[1];

  if (!token) {
    res.status(401).json({ message: "No autorizado" });
    return;
  }

  try {
    const decoded = await authAppOficial.verifyIdToken(token);

    const snapshot = await firestoreApp
      .collection("usuariosApp")
      .where("uid", "==", decoded.uid)
      .limit(1)
      .get();

    if (snapshot.empty) {
      res.status(404).json({ message: "Usuario no registrado" });
      return;
    }

    req.user = {
      ...decoded,
      ...snapshot.docs[0].data(),
    };

    next();
    return;
  } catch (error) {
    const mapped = mapFirebaseError(error, {
      unauthorizedMessage: "Token inválido o expirado",
      forbiddenMessage: "No autorizado para acceder a app-oficial-leon",
      notFoundMessage: "Usuario no encontrado",
      internalMessage: "Error de autenticación",
    });

    console.error("❌ authMiddleware error", {
      code: mapped.code,
      status: mapped.status,
      route: req.originalUrl,
    });

    res.status(mapped.status).json({ message: mapped.message });
    return;
  }
};

/**
 * Middleware de autenticación opcional
 * Intenta autenticar al usuario, pero si falla o no hay token,
 * continúa sin req.user (para endpoints que soportan ambos modos).
 * Ideal para carrito de compras que funciona para autenticados y anónimos.
 */
export const optionalAuthMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const token = req.headers.authorization?.split("Bearer ")[1];

  if (!token) {
    // Sin token → continuar como anónimo
    next();
    return;
  }

  try {
    const decoded = await authAppOficial.verifyIdToken(token);

    const snapshot = await firestoreApp
      .collection("usuariosApp")
      .where("uid", "==", decoded.uid)
      .limit(1)
      .get();

    if (!snapshot.empty) {
      req.user = {
        ...decoded,
        ...snapshot.docs[0].data(),
      };
    }

    next();
    return;
  } catch {
    // Token inválido → continuar como anónimo (no bloquear)
    next();
    return;
  }
};

/**
 * Middleware de autorización para administradores
 * Verifica que el usuario autenticado tenga rol de ADMIN o EMPLEADO
 * IMPORTANTE: Debe usarse DESPUÉS de authMiddleware
 *
 * @throws 401 - Si no hay usuario autenticado
 * @throws 403 - Si el usuario no tiene permisos de administrador
 */
export const requireAdmin = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  // Verificar que authMiddleware se ejecutó primero
  if (!req.user) {
    res.status(401).json({
      success: false,
      message: "No autorizado. Se requiere autenticación.",
    });
    return;
  }

  // Verificar rol del usuario
  const userRole = req.user.rol as RolUsuario;

  if (userRole !== RolUsuario.ADMIN && userRole !== RolUsuario.EMPLEADO) {
    res.status(403).json({
      success: false,
      message: "Acceso denegado. Se requieren permisos de administrador.",
    });
    return;
  }

  // Usuario tiene permisos, continuar
  next();
  return;
};
