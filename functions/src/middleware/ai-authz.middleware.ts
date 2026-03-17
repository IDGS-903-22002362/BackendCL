import { NextFunction, Request, Response } from "express";
import { RolUsuario } from "../models/usuario.model";

const employeeCapabilities = new Set(["support", "inventory"]);

const normalizeScopes = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => String(item || "").trim().toLowerCase())
    .filter((item) => item.length > 0 && employeeCapabilities.has(item));
};

export const getAiCapabilitiesFromRequest = (req: Request): string[] => {
  if (!req.user) {
    return [];
  }

  if (req.user.rol === RolUsuario.ADMIN) {
    return ["admin", "support", "inventory"];
  }

  if (req.user.rol === RolUsuario.CLIENTE) {
    return ["customer"];
  }

  const configuredScopes = normalizeScopes(req.user.aiToolScopes);
  if (configuredScopes.length === 0) {
    return ["support"];
  }

  return [...new Set(["support", ...configuredScopes])];
};

export const requireAiAdmin = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  if (!req.user) {
    res.status(401).json({ success: false, message: "No autenticado" });
    return;
  }

  if (req.user.rol !== RolUsuario.ADMIN) {
    res.status(403).json({ success: false, message: "Acceso restringido a administradores" });
    return;
  }

  next();
};

export const requireAiCapability = (capability: string) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ success: false, message: "No autenticado" });
      return;
    }

    const capabilities = getAiCapabilitiesFromRequest(req);
    if (!capabilities.includes(capability) && !capabilities.includes("admin")) {
      res.status(403).json({ success: false, message: "No tienes permisos para esta operación AI" });
      return;
    }

    next();
  };
};

export const requireAiOwnership = <T>(resolver: (req: Request) => Promise<T | null>, getOwnerId: (resource: T) => string | undefined) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      res.status(401).json({ success: false, message: "No autenticado" });
      return;
    }

    if (req.user.rol === RolUsuario.ADMIN) {
      next();
      return;
    }

    const resource = await resolver(req);
    if (!resource) {
      res.status(404).json({ success: false, message: "Recurso no encontrado" });
      return;
    }

    const ownerId = getOwnerId(resource);
    if (!ownerId || ownerId !== req.user.uid) {
      res.status(403).json({ success: false, message: "No tienes permisos para acceder a este recurso" });
      return;
    }

    next();
  };
};
