import { firestoreApp } from "../config/app.firebase";
import { admin } from "../config/firebase.admin";
import { Request, Response, NextFunction } from "express";
import { RolUsuario } from "../models/usuario.model";

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
    const decoded = await admin.auth().verifyIdToken(token);

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
  } catch {
    res.status(401).json({ message: "Token inválido" });
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
