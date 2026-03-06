import { RolUsuario } from "../models/usuario.model";

declare global {
  namespace Express {
    interface Request {
      user?: {
        uid: string;
        email: string;
        rol: RolUsuario;
        nombre: string;
      };
      rawBody?: Buffer;
    }
  }
}
