import { authAppOficial, firestoreApp } from "../config/app.firebase";
import { admin } from "../config/firebase.admin";
import { RolUsuario, UsuarioApp } from "../models/usuario.model";
import pointsService from "./puntos.service";
import { syncFirebaseAdminClaims } from "../utils/middlewares";

const calcularEdad = (fechaNacimiento?: string | Date): number | null => {
  if (!fechaNacimiento) return null;
  const nacimiento = new Date(fechaNacimiento);
  if (isNaN(nacimiento.getTime())) return null;
  const hoy = new Date();
  let edad = hoy.getFullYear() - nacimiento.getFullYear();
  const mes = hoy.getMonth() - nacimiento.getMonth();
  if (mes < 0 || (mes === 0 && hoy.getDate() < nacimiento.getDate())) {
    edad--;
  }
  return edad;
};

const isAlreadyExistsError = (error: unknown): boolean => {
  const code =
    error && typeof error === "object" && "code" in error
      ? String((error as { code?: string }).code || "")
      : "";

  return code === "6" || code === "already-exists" || code === "ALREADY_EXISTS";
};

export interface CreateEmailUserInput {
  email: string;
  password: string;
  nombre: string;
  telefono?: string;
  fechaNacimiento?: string;
  genero?: string;
}

function getFirebaseErrorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    return String((error as { code?: string }).code || "");
  }
  return "";
}

export async function isEmailAlreadyRegistered(email: string): Promise<boolean> {
  const normalizedEmail = email.toLowerCase().trim();

  try {
    await authAppOficial.getUserByEmail(normalizedEmail);
    return true;
  } catch (error: unknown) {
    const code = getFirebaseErrorCode(error);

    if (code === "auth/user-not-found") {
      // Continue with Firestore lookup below.
    } else if (code) {
      console.warn("auth_email_lookup_failed", {
        code,
        email: normalizedEmail,
      });
    } else {
      throw error;
    }
  }

  const snapshot = await firestoreApp
    .collection("usuariosApp")
    .where("email", "==", normalizedEmail)
    .where("activo", "==", true)
    .limit(1)
    .get();

  return !snapshot.empty;
}

export async function createEmailUser(
  input: CreateEmailUserInput,
): Promise<UsuarioApp> {
  const normalizedEmail = input.email.toLowerCase().trim();
  const edad = calcularEdad(input.fechaNacimiento);
  const perfilCompleto = !!(
    input.nombre &&
    input.telefono &&
    input.fechaNacimiento
  );

  const authUser = await authAppOficial.createUser({
    email: normalizedEmail,
    password: input.password,
    displayName: input.nombre.trim(),
  });

  const uid = authUser.uid;
  const now = admin.firestore.Timestamp.now();
  const docRef = firestoreApp.collection("usuariosApp").doc(uid);

  const nuevoUsuario: Omit<UsuarioApp, "id"> = {
    uid,
    provider: "email",
    nombre: input.nombre.trim(),
    email: normalizedEmail,
    telefono: input.telefono?.trim() || undefined,
    fechaNacimiento: input.fechaNacimiento
      ? new Date(input.fechaNacimiento)
      : undefined,
    puntosActuales: 0,
    nivel: "Bronce",
    perfilCompleto,
    edad: edad ?? 0,
    genero: input.genero || "",
    rol: RolUsuario.CLIENTE,
    activo: true,
    createdAt: now,
    updatedAt: now,
  };

  try {
    await docRef.create(nuevoUsuario);
    const usuario = await pointsService.otorgarBonoBienvenida(uid);

    try {
      await syncFirebaseAdminClaims(uid, RolUsuario.CLIENTE);
    } catch (claimsError) {
      console.error("admin_claims_sync_error", {
        uid,
        reason:
          claimsError instanceof Error ? claimsError.message : "unknown",
      });
    }

    return usuario;
  } catch (createError) {
    try {
      await authAppOficial.deleteUser(uid);
    } catch (rollbackError) {
      console.error("rollback_auth_user_failed", {
        uid,
        reason:
          rollbackError instanceof Error
            ? rollbackError.message
            : "unknown",
      });
    }

    if (!isAlreadyExistsError(createError)) {
      throw createError;
    }

    throw new Error("El usuario ya existe");
  }
}
