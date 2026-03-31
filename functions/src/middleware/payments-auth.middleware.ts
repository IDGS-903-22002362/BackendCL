import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { firestoreApp } from "../config/app.firebase";
import { RolUsuario } from "../models/usuario.model";

const respondAuthError = (
  res: Response,
  status: number,
  code: string,
  message: string,
): void => {
  res.status(status).json({
    ok: false,
    error: {
      code,
      message,
    },
  });
};

export const paymentAuthMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    respondAuthError(
      res,
      401,
      "PAYMENT_AUTH_REQUIRED",
      "No autorizado. Token requerido",
    );
    return;
  }

  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    respondAuthError(
      res,
      500,
      "PAYMENT_INTERNAL_ERROR",
      "Error de configuración del servidor",
    );
    return;
  }

  try {
    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, jwtSecret) as {
      uid: string;
      email: string;
      rol: RolUsuario;
      nombre: string;
    };

    const snapshot = await firestoreApp
      .collection("usuariosApp")
      .where("uid", "==", decoded.uid)
      .limit(1)
      .get();

    if (snapshot.empty) {
      respondAuthError(
        res,
        404,
        "PAYMENT_AUTH_REQUIRED",
        "Usuario no registrado en la base de datos",
      );
      return;
    }

    req.user = {
      ...decoded,
      ...snapshot.docs[0].data(),
      uid: decoded.uid,
    };

    next();
  } catch (error) {
    let message = "Token inválido o expirado";
    if (error instanceof jwt.TokenExpiredError) {
      message = "Token expirado";
    } else if (error instanceof jwt.JsonWebTokenError) {
      message = "Token inválido";
    }

    respondAuthError(res, 401, "PAYMENT_AUTH_REQUIRED", message);
  }
};

export const paymentStaffMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  if (!req.user) {
    respondAuthError(
      res,
      401,
      "PAYMENT_AUTH_REQUIRED",
      "No autenticado",
    );
    return;
  }

  const role = req.user.rol as RolUsuario;
  if (role !== RolUsuario.ADMIN && role !== RolUsuario.EMPLEADO) {
    respondAuthError(
      res,
      403,
      "PAYMENT_FORBIDDEN",
      "Acceso denegado para este flujo de pagos",
    );
    return;
  }

  next();
};
