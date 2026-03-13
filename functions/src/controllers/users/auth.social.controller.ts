import { Request, Response } from "express";
import { authAppOficial, firestoreApp } from "../../config/app.firebase";
import { admin } from "../../config/firebase.admin";
import { mapFirebaseError } from "../../utils/firebase-error.util";
import jwt from "jsonwebtoken";
import axios from "axios";
import { UsuarioApp, RolUsuario } from "../../models/usuario.model";

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

const getFirebaseWebApiKey = (): string => {
  const apiKey =
    process.env.WEB_API_KEY ||
    process.env.FIREBASE_WEB_API_KEY ||
    process.env.FIREBASE_API_KEY ||
    process.env.GOOGLE_API_KEY;

  if (!apiKey) {
    throw new Error(
      "FIREBASE_WEB_API_KEY no está definido en variables de entorno",
    );
  }

  return apiKey;
};

const signInWithEmailAndPassword = async (
  email: string,
  password: string,
): Promise<{ idToken: string; uid: string; email: string }> => {
  const apiKey = getFirebaseWebApiKey();
  const endpoint = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`;

  const response = await axios.post(endpoint, {
    email,
    password,
    returnSecureToken: true,
  });

  const idToken = response.data?.idToken as string | undefined;
  const uid = response.data?.localId as string | undefined;
  const responseEmail = response.data?.email as string | undefined;
  if (!idToken) {
    throw new Error("No se pudo obtener idToken de Firebase Auth");
  }

  if (!uid || !responseEmail) {
    throw new Error("Respuesta incompleta de Firebase Auth");
  }

  return { idToken, uid, email: responseEmail };
};

const getIdentityToolkitErrorCode = (error: unknown): string | undefined => {
  if (!axios.isAxiosError(error)) {
    return undefined;
  }

  const message = error.response?.data?.error?.message;
  return typeof message === "string" ? message : undefined;
};

export const registerOrLogin = async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    const headerToken = authHeader?.startsWith("Bearer ")
      ? authHeader.split("Bearer ")[1]
      : undefined;

    const { email, password, nombre, telefono, fechaNacimiento, genero } =
      req.body;

    let token = headerToken;
    let resolvedUid: string | undefined;
    let resolvedEmail: string | undefined;
    let resolvedName: string | undefined;
    let resolvedProvider: string | undefined;

    // Flujo actual: si ya viene token en header, se mantiene tal cual.
    // Flujo nuevo: si no viene token, se autentica con email/password para obtener idToken.
    if (!token) {
      if (!email || !password) {
        return res.status(400).json({
          success: false,
          message: "Debes enviar email y password para iniciar sesión",
        });
      }

      const normalizedEmail = String(email).toLowerCase().trim();

      try {
        const signInResult = await signInWithEmailAndPassword(
          normalizedEmail,
          String(password),
        );
        token = signInResult.idToken;
        resolvedUid = signInResult.uid;
        resolvedEmail = signInResult.email;
        resolvedName = typeof nombre === "string" ? nombre.trim() : undefined;
        resolvedProvider = "password";
      } catch (signInError) {
        const errorCode = getIdentityToolkitErrorCode(signInError);

        // Con Email Enumeration Protection, Firebase puede devolver
        // INVALID_LOGIN_CREDENTIALS tanto para "no existe" como para "password incorrecto".
        // Intentamos crear: si ya existe, tratamos como credenciales inválidas.
        const shouldTryCreateUser =
          errorCode === "EMAIL_NOT_FOUND" ||
          errorCode === "INVALID_LOGIN_CREDENTIALS";

        if (shouldTryCreateUser) {
          try {
            await authAppOficial.createUser({
              email: normalizedEmail,
              password: String(password),
              displayName:
                typeof nombre === "string" ? nombre.trim() : undefined,
            });
          } catch (createUserError: unknown) {
            const createUserCode =
              createUserError &&
              typeof createUserError === "object" &&
              "code" in createUserError
                ? String((createUserError as { code?: string }).code || "")
                : "";

            if (
              createUserCode === "auth/email-already-exists" ||
              createUserCode === "auth/invalid-password"
            ) {
              const message =
                createUserCode === "auth/invalid-password"
                  ? "La contraseña no cumple los requisitos mínimos"
                  : "Credenciales inválidas";

              return res.status(401).json({
                success: false,
                message,
              });
            }

            if (createUserCode.startsWith("auth/")) {
              const message = createUserCode.includes("password")
                ? "La contraseña no cumple los requisitos mínimos"
                : "No fue posible registrar al usuario";

              return res.status(400).json({
                success: false,
                message,
              });
            }

            throw createUserError;
          }

          const signInResult = await signInWithEmailAndPassword(
            normalizedEmail,
            String(password),
          );
          token = signInResult.idToken;
          resolvedUid = signInResult.uid;
          resolvedEmail = signInResult.email;
          resolvedName = typeof nombre === "string" ? nombre.trim() : undefined;
          resolvedProvider = "password";
        } else if (
          errorCode === "INVALID_PASSWORD" ||
          errorCode === "USER_DISABLED"
        ) {
          return res.status(401).json({
            success: false,
            message: "Credenciales inválidas",
          });
        } else if (
          errorCode === "INVALID_API_KEY" ||
          errorCode === "API_KEY_INVALID" ||
          errorCode === "PROJECT_NOT_FOUND" ||
          errorCode === "OPERATION_NOT_ALLOWED"
        ) {
          return res.status(500).json({
            success: false,
            message:
              "Configuración de autenticación inválida en servidor (API key o proveedor email/password)",
          });
        } else if (axios.isAxiosError(signInError)) {
          return res.status(401).json({
            success: false,
            message: "Credenciales inválidas",
          });
        } else {
          throw signInError;
        }
      }
    }

    let uid: string;
    let decodedEmail: string;
    let name: string | undefined;
    let firebaseProvider = resolvedProvider;

    // Si el token viene por Authorization (social/client flow), verificamos idToken.
    // Si el login se resolvió en backend por email/password, usamos los datos
    // ya validados por Identity Toolkit.
    if (resolvedUid && resolvedEmail) {
      uid = resolvedUid;
      decodedEmail = resolvedEmail;
      name = resolvedName;
    } else {
      const decoded = await authAppOficial.verifyIdToken(token);
      uid = decoded.uid;
      decodedEmail = decoded.email || "";
      name = decoded.name;
      firebaseProvider = decoded.firebase?.sign_in_provider;
    }

    if (!decodedEmail) {
      return res
        .status(400)
        .json({ success: false, message: "El usuario no tiene email" });
    }

    // 4. Detectar provider
    const providerSource = firebaseProvider ?? "password";
    const providerMap: Record<string, "google" | "email" | "apple"> = {
      "google.com": "google",
      password: "email",
      "apple.com": "apple",
    };
    const provider = providerMap[providerSource];
    if (!provider) {
      return res.status(400).json({
        success: false,
        message: `Provider no soportado: ${providerSource}`,
      });
    }

    // 5. Referencia al documento del usuario
    const docRef = firestoreApp.collection("usuariosApp").doc(uid);
    const docSnap = await docRef.get();

    let usuario: UsuarioApp;

    if (!docSnap.exists) {
      // 👤 NUEVO USUARIO
      const now = admin.firestore.Timestamp.now();
      const edad = calcularEdad(fechaNacimiento);
      const perfilCompleto =
        provider === "email"
          ? !!(nombre && telefono && fechaNacimiento)
          : false;

      const nuevoUsuario: Omit<UsuarioApp, "id"> = {
        uid,
        provider,
        nombre: nombre ?? name ?? "",
        email: decodedEmail.toLowerCase(),
        telefono: telefono ?? null,
        fechaNacimiento: fechaNacimiento ?? null,
        puntosActuales: 0,
        nivel: "Bronce",
        perfilCompleto,
        edad: edad ?? 0,
        genero: genero ?? "",
        rol: RolUsuario.CLIENTE,
        activo: true,
        createdAt: now,
        updatedAt: now,
      };

      await docRef.set(nuevoUsuario);
      usuario = { id: uid, ...nuevoUsuario } as UsuarioApp;
    } else {
      // 👤 USUARIO EXISTENTE
      const data = docSnap.data()!;
      usuario = {
        id: docSnap.id,
        uid: data.uid,
        provider: data.provider,
        nombre: data.nombre,
        email: data.email,
        telefono: data.telefono ?? null,
        fechaNacimiento: data.fechaNacimiento ?? null,
        puntosActuales: data.puntosActuales ?? 0,
        nivel: data.nivel ?? "Bronce",
        perfilCompleto: data.perfilCompleto ?? false,
        edad: data.edad ?? 0,
        genero: data.genero ?? "",
        rol: data.rol ?? RolUsuario.CLIENTE,
        activo: data.activo ?? true,
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
      };

      await docRef.update({ updatedAt: admin.firestore.Timestamp.now() });
    }

    // 🔐 Validar que JWT_SECRET esté definido
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      throw new Error(
        "JWT_SECRET no está definido en las variables de entorno",
      );
    }

    // 6. Generar JWT propio con opciones tipadas
    const jwtPayload = {
      uid: usuario.uid,
      email: usuario.email,
      rol: usuario.rol,
      nombre: usuario.nombre,
    };

    // 👇 Forzamos el tipo SignOptions para evitar ambigüedad en las sobrecargas
    const jwtToken = jwt.sign(jwtPayload, jwtSecret, {
      expiresIn: process.env.JWT_EXPIRES_IN || "7d",
    } as jwt.SignOptions);

    console.log("🔑 Token generado para", usuario.email);

    // 7. Respuesta exitosa
    return res.status(200).json({
      success: true,
      token: jwtToken,
      bearerToken: jwtToken,
      tokenType: "Bearer",
      usuario,
    });
  } catch (error) {
    const originalMessage =
      error instanceof Error ? error.message : String(error);
    const originalCode =
      error && typeof error === "object" && "code" in error
        ? String((error as { code?: string }).code || "unknown")
        : "unknown";

    const mapped = mapFirebaseError(error, {
      unauthorizedMessage: "Token inválido o expirado",
      forbiddenMessage: "Sin permisos para acceder",
      notFoundMessage: "Usuario no encontrado",
      internalMessage: "Error de autenticación",
    });

    console.error("Error en auth:", {
      code: mapped.code,
      status: mapped.status,
      route: req.originalUrl,
      originalCode,
      originalMessage,
    });

    return res.status(mapped.status).json({
      success: false,
      message: mapped.message,
    });
  }
};
