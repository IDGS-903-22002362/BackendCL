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
): Promise<string> => {
  const apiKey = getFirebaseWebApiKey();
  const endpoint = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`;

  const response = await axios.post(endpoint, {
    email,
    password,
    returnSecureToken: true,
  });

  const idToken = response.data?.idToken as string | undefined;
  if (!idToken) {
    throw new Error("No se pudo obtener idToken de Firebase Auth");
  }

  return idToken;
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
        token = await signInWithEmailAndPassword(
          normalizedEmail,
          String(password),
        );
      } catch (signInError) {
        const errorCode =
          axios.isAxiosError(signInError) &&
          typeof signInError.response?.data?.error?.message === "string"
            ? signInError.response.data.error.message
            : undefined;

        if (errorCode === "EMAIL_NOT_FOUND") {
          await authAppOficial.createUser({
            email: normalizedEmail,
            password: String(password),
            displayName: typeof nombre === "string" ? nombre.trim() : undefined,
          });

          token = await signInWithEmailAndPassword(
            normalizedEmail,
            String(password),
          );
        } else if (errorCode === "INVALID_PASSWORD") {
          return res.status(401).json({
            success: false,
            message: "Credenciales inválidas",
          });
        } else {
          throw signInError;
        }
      }
    }

    // 2. Verificar token de Firebase
    const decoded = await authAppOficial.verifyIdToken(token);
    const { uid, email: decodedEmail, name, firebase } = decoded;

    if (!decodedEmail) {
      return res
        .status(400)
        .json({ success: false, message: "El usuario no tiene email" });
    }

    // 4. Detectar provider
    const firebaseProvider = firebase?.sign_in_provider ?? "password";
    const providerMap: Record<string, "google" | "email" | "apple"> = {
      "google.com": "google",
      password: "email",
      "apple.com": "apple",
    };
    const provider = providerMap[firebaseProvider];
    if (!provider) {
      return res.status(400).json({
        success: false,
        message: `Provider no soportado: ${firebaseProvider}`,
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

    console.log("🔑 Token generado para", usuario.email, ":", jwtToken);

    // 7. Respuesta exitosa
    return res.status(200).json({
      success: true,
      token: jwtToken,
      bearerToken: jwtToken,
      tokenType: "Bearer",
      usuario,
    });
  } catch (error) {
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
    });

    return res.status(mapped.status).json({
      success: false,
      message: mapped.message,
    });
  }
};
