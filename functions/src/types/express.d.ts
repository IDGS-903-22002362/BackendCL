import { RolUsuario } from "../models/usuario.model";
import type { ClientOrigin } from "./client-origin";

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
      firebaseAuth?: {
        uid: string;
        phoneNumber?: string;
      };
      rawBody?: Buffer;
      requestId?: string;
      clientOrigin?: ClientOrigin;
      advertisingTrackingAllowed?: boolean;
    }
  }
}
