import { RolUsuario } from "../models/usuario.model";

declare global {
  namespace Express {
    interface AuthenticatedUser {
      uid: string;
      email: string;
      rol: RolUsuario;
      nombre: string;
      aiToolScopes?: string[];
      activo?: boolean;
      [key: string]: unknown;
    }

    interface Request {
      user?: AuthenticatedUser;
      rawBody?: Buffer;
      requestId?: string;
    }
  }
}
