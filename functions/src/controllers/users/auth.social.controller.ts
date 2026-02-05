import { Request, Response } from "express";
import { firestoreApp } from "../../config/app.firebase";

import { admin } from "../../config/firebase.admin";

//auth funcionando
export const registerOrLogin = async (req: Request, res: Response) => {
    try {
        const { idToken, nombre, telefono, fechaNacimiento } = req.body;

        if (!idToken) {
            return res.status(400).json({
                success: false,
                message: "idToken es requerido",
            });
        }

        //Verificar token Firebase
        const decoded = await admin.auth().verifyIdToken(idToken);

        const { uid, email, name } = decoded;

        if (!email) {
            return res.status(400).json({
                success: false,
                message: "El usuario no tiene email",
            });
        }

        // Detectar provider
        const firebaseProvider =
            decoded.firebase?.sign_in_provider ?? "password";

        const providerMap: Record<string, "google" | "email" | "apple"> = {
            "google.com": "google",
            "password": "email",
            "apple.com": "apple",
        };

        const provider = providerMap[firebaseProvider];

        if (!provider) {
            return res.status(400).json({
                success: false,
                message: `Provider no soportado: ${firebaseProvider}`,
            });
        }

        // Buscar usuario por UID
        const snapshot = await firestoreApp
            .collection("usuariosApp")
            .where("uid", "==", uid)
            .limit(1)
            .get();

        let usuario;
        const perfilCompleto =
            provider === "email" &&
            !!nombre &&
            !!telefono &&
            !!fechaNacimiento;

        //Crear usuario si no existe
        if (snapshot.empty) {
            const now = admin.firestore.Timestamp.now();

            const nuevoUsuario = {
                uid,
                provider,
                nombre: nombre ?? name ?? "",
                email: email.toLowerCase(),
                telefono: telefono ?? null,
                fechaNacimiento: fechaNacimiento ?? null,
                puntosActuales: 0,
                nivel: "Bronce",
                perfilCompleto,
                activo: true,
                createdAt: now,
                updatedAt: now,
            };

            const docRef = await firestoreApp
                .collection("usuariosApp")
                .add(nuevoUsuario);

            usuario = { id: docRef.id, ...nuevoUsuario };
        } else {
            const doc = snapshot.docs[0];
            usuario = { id: doc.id, ...doc.data() };
        }

        return res.status(200).json({
            success: true,
            usuario,
        });
    } catch (error) {
        console.error("❌ Error en auth:", error);
        return res.status(401).json({
            success: false,
            message: "Token inválido o expirado",
        });
    }
};

export const socialLogin = async (req: Request, res: Response) => {
    try {
        //Solo recibimos el token
        const { idToken } = req.body;

        if (!idToken) {
            return res.status(400).json({
                success: false,
                message: "idToken es requerido",
            });
        }

        //Verificar token Firebase
        const decoded = await admin.auth().verifyIdToken(idToken);

        const { uid, email, name } = decoded;

        if (!email) {
            return res.status(400).json({
                success: false,
                message: "El proveedor no devolvió email",
            });
        }

        //Detectar provider desde Firebase
        const firebaseProvider =
            decoded.firebase?.sign_in_provider ??
            (decoded.firebase?.identities
                ? Object.keys(decoded.firebase.identities)[0]
                : null);

        if (!firebaseProvider) {
            return res.status(400).json({
                success: false,
                message: "No se pudo detectar el provider",
            });
        }

        //NORMALIZAR provider (🔥 AQUÍ VA LO QUE PREGUNTAS 🔥)
        const providerMap: Record<string, "google" | "apple" | "email"> = {
            "password": "email",
            "google.com": "google",
            "apple.com": "apple",
        };

        const provider = providerMap[firebaseProvider];

        if (!provider) {
            return res.status(400).json({
                success: false,
                message: `Provider no soportado: ${firebaseProvider}`,
            });
        }

        //Buscar usuario por UID
        const snapshot = await firestoreApp
            .collection("usuariosApp")
            .where("uid", "==", uid)
            .limit(1)
            .get();

        let usuario;

        //Crear usuario si no existe
        if (snapshot.empty) {
            const now = admin.firestore.Timestamp.now();

            const nuevoUsuario = {
                uid,
                provider,
                nombre: name ?? "",
                email: email.toLowerCase(),
                puntosActuales: 0,
                nivel: "Bronce",
                perfilCompleto: false,
                activo: true,
                createdAt: now,
                updatedAt: now,
            };

            const docRef = await firestoreApp
                .collection("usuariosApp")
                .add(nuevoUsuario);

            usuario = { id: docRef.id, ...nuevoUsuario };
        } else {
            const doc = snapshot.docs[0];
            usuario = { id: doc.id, ...doc.data() };
        }


        return res.status(200).json({
            success: true,
            usuario,
        });
    } catch (error) {
        console.error("❌ Error en auth social:", error);
        return res.status(401).json({
            success: false,
            message: "Token inválido o expirado",
        });
    }
};



export const emailLogin = async (req: Request, res: Response) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({
                success: false,
                message: "Email y contraseña son requeridos",
            });
        }

        // Aquí deberías verificar credenciales con Firebase Auth
        // O con tu propio sistema de autenticación

        // Buscar usuario por email
        const snapshot = await firestoreApp
            .collection("usuariosApp")
            .where("email", "==", email.toLowerCase())
            .limit(1)
            .get();

        if (snapshot.empty) {
            return res.status(404).json({
                success: false,
                message: "Usuario no encontrado",
            });
        }

        const doc = snapshot.docs[0];
        const usuario = { id: doc.id, ...doc.data() };


        // Generar token JWT o usar Firebase token
        const token = "GENERA_TU_TOKEN_AQUI";

        return res.status(200).json({
            success: true,
            token,
            usuario,
        });
    } catch (error) {
        console.error("❌ Error en login:", error);
        return res.status(500).json({
            success: false,
            message: "Error en el servidor",
        });
    }
};