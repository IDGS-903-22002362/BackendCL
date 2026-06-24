import { Request, Response } from "express";
import { sendVerificationEmail } from "../../lib/brevo/client";
import pendingRegistrationService from "../../services/pending-registration.service";
import {
  createEmailUser,
  isEmailAlreadyRegistered,
} from "../../services/email-user-registration.service";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 6;

function normalizeGenero(genero?: string): string | undefined {
  if (!genero) return undefined;

  const generoMap: Record<string, string> = {
    M: "masculino",
    F: "femenino",
    O: "otro",
    masculino: "masculino",
    femenino: "femenino",
    otro: "otro",
  };

  return generoMap[genero] || genero;
}

function normalizeFechaNacimiento(fecha?: string): string | undefined {
  if (!fecha) return undefined;
  return fecha.substring(0, 10);
}

export async function requestRegistrationCode(req: Request, res: Response) {
  try {
    const {
      email,
      password,
      nombre,
      telefono,
      fechaNacimiento,
      genero,
    } = req.body;

    if (!email || !String(email).trim()) {
      return res.status(400).json({
        success: false,
        message: "El correo electrónico es requerido",
      });
    }

    if (!password || String(password).length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({
        success: false,
        message: "La contraseña debe tener al menos 6 caracteres",
      });
    }

    if (!nombre || !String(nombre).trim()) {
      return res.status(400).json({
        success: false,
        message: "El nombre es requerido",
      });
    }

    const normalizedEmail = String(email).toLowerCase().trim();

    if (!EMAIL_REGEX.test(normalizedEmail)) {
      return res.status(400).json({
        success: false,
        message: "Correo electrónico inválido",
      });
    }

    const alreadyRegistered = await isEmailAlreadyRegistered(normalizedEmail);

    if (alreadyRegistered) {
      return res.status(409).json({
        success: false,
        message: "Ya existe una cuenta con este correo electrónico",
      });
    }

    const profile = {
      nombre: String(nombre).trim(),
      telefono: telefono ? String(telefono).trim() : undefined,
      fechaNacimiento: normalizeFechaNacimiento(
        fechaNacimiento ? String(fechaNacimiento) : undefined,
      ),
      genero: normalizeGenero(genero ? String(genero) : undefined),
    };

    const { success, code } = await pendingRegistrationService.storePendingRegistration(
      normalizedEmail,
      String(password),
      profile,
    );

    if (!success || !code) {
      return res.status(500).json({
        success: false,
        message: "Error al generar el código de verificación",
      });
    }

    const emailSent = await sendVerificationEmail(
      normalizedEmail,
      code,
      profile.nombre,
    );

    if (!emailSent) {
      await pendingRegistrationService.deletePendingRegistration(normalizedEmail);
      return res.status(500).json({
        success: false,
        message: "Error al enviar el código de verificación. Intenta nuevamente.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Código de verificación enviado a tu correo electrónico",
      expiresIn: 10,
    });
  } catch (error) {
    console.error("Error en requestRegistrationCode:", error);
    return res.status(500).json({
      success: false,
      message: "Error interno del servidor",
    });
  }
}

export async function verifyRegistration(req: Request, res: Response) {
  try {
    const { email, verificationCode } = req.body;

    if (!email || !verificationCode) {
      return res.status(400).json({
        success: false,
        message: "Correo y código de verificación son requeridos",
      });
    }

    const normalizedEmail = String(email).toLowerCase().trim();
    const code = String(verificationCode).trim();

    if (code.length !== 6) {
      return res.status(400).json({
        success: false,
        message: "El código debe tener 6 dígitos",
      });
    }

    const verification = await pendingRegistrationService.verifyPendingRegistration(
      normalizedEmail,
      code,
    );

    if (!verification.valid || !verification.password || !verification.profile) {
      return res.status(401).json({
        success: false,
        message: verification.message,
        remainingAttempts: verification.remainingAttempts,
      });
    }

    const stillRegistered = await isEmailAlreadyRegistered(normalizedEmail);

    if (stillRegistered) {
      await pendingRegistrationService.deletePendingRegistration(normalizedEmail);
      return res.status(409).json({
        success: false,
        message: "Ya existe una cuenta con este correo electrónico",
      });
    }

    try {
      await createEmailUser({
        email: normalizedEmail,
        password: verification.password,
        nombre: verification.profile.nombre,
        telefono: verification.profile.telefono,
        fechaNacimiento: verification.profile.fechaNacimiento,
        genero: verification.profile.genero,
      });
    } catch (createError: unknown) {
      const createCode =
        createError && typeof createError === "object" && "code" in createError
          ? String((createError as { code?: string }).code || "")
          : "";

      if (createCode === "auth/email-already-exists") {
        await pendingRegistrationService.deletePendingRegistration(normalizedEmail);
        return res.status(409).json({
          success: false,
          message: "Ya existe una cuenta con este correo electrónico",
        });
      }

      if (createCode === "auth/invalid-password") {
        return res.status(400).json({
          success: false,
          message: "La contraseña no cumple los requisitos mínimos",
        });
      }

      throw createError;
    }

    await pendingRegistrationService.deletePendingRegistration(normalizedEmail);

    return res.status(200).json({
      success: true,
      message: "Cuenta creada correctamente. Ya puedes iniciar sesión.",
    });
  } catch (error) {
    console.error("Error en verifyRegistration:", error);
    return res.status(500).json({
      success: false,
      message: "Error interno del servidor",
    });
  }
}
