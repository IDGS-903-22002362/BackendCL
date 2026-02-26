import { DecodedIdToken } from "firebase-admin/auth";
import { UsuarioApp } from "../models/usuario.model";

declare global {
  namespace Express {
    interface Request {
      user?: DecodedIdToken | UsuarioApp | any;
      rawBody?: Buffer;
    }
  }
}
