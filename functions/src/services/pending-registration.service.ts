import { firestoreApp } from "../config/app.firebase";
import { admin } from "../config/firebase.admin";
import {
  decryptPendingPassword,
  encryptPendingPassword,
} from "../utils/pending-registration-crypto";
import otpService from "../lib/firebase/otp-service";

const COLLECTION = "pending_registrations";
const EXPIRY_MINUTES = 10;
const MAX_ATTEMPTS = 3;

export interface PendingRegistrationPayload {
  nombre: string;
  telefono?: string;
  fechaNacimiento?: string;
  genero?: string;
}

interface PendingRegistrationDoc extends PendingRegistrationPayload {
  email: string;
  code: string;
  passwordEncrypted: string;
  createdAt: FirebaseFirestore.FieldValue;
  expiresAt: FirebaseFirestore.Timestamp;
  attempts: number;
  maxAttempts: number;
  isUsed: boolean;
}

export interface StorePendingRegistrationResult {
  success: boolean;
  code?: string;
}

export interface VerifyPendingRegistrationResult {
  valid: boolean;
  message: string;
  remainingAttempts?: number;
  password?: string;
  profile?: PendingRegistrationPayload;
}

class PendingRegistrationService {
  private docIdForEmail(email: string): string {
    return email.toLowerCase().trim();
  }

  async storePendingRegistration(
    email: string,
    password: string,
    profile: PendingRegistrationPayload,
  ): Promise<StorePendingRegistrationResult> {
    try {
      const normalizedEmail = this.docIdForEmail(email);
      const code = otpService.generateCode();
      const expiresAt = new Date();
      expiresAt.setMinutes(expiresAt.getMinutes() + EXPIRY_MINUTES);

      const data: PendingRegistrationDoc = {
        email: normalizedEmail,
        code,
        passwordEncrypted: encryptPendingPassword(password),
        nombre: profile.nombre.trim(),
        telefono: profile.telefono?.trim() || undefined,
        fechaNacimiento: profile.fechaNacimiento || undefined,
        genero: profile.genero || undefined,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        expiresAt: admin.firestore.Timestamp.fromDate(expiresAt),
        attempts: 0,
        maxAttempts: MAX_ATTEMPTS,
        isUsed: false,
      };

      await firestoreApp
        .collection(COLLECTION)
        .doc(normalizedEmail)
        .set(data);

      return { success: true, code };
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes("JWT_SECRET no está configurado")
      ) {
        console.error("Error de configuración al cifrar registro pendiente:", error.message);
      } else {
        console.error("Error almacenando registro pendiente:", error);
      }
      return { success: false };
    }
  }

  async verifyPendingRegistration(
    email: string,
    code: string,
  ): Promise<VerifyPendingRegistrationResult> {
    try {
      const normalizedEmail = this.docIdForEmail(email);
      const docRef = firestoreApp.collection(COLLECTION).doc(normalizedEmail);
      const docSnap = await docRef.get();

      if (!docSnap.exists) {
        return { valid: false, message: "Código inválido o expirado" };
      }

      const data = docSnap.data() as PendingRegistrationDoc;
      const now = admin.firestore.Timestamp.now();

      if (data.isUsed) {
        return { valid: false, message: "Este código ya fue utilizado" };
      }

      if (data.expiresAt < now) {
        await docRef.delete();
        return {
          valid: false,
          message: "El código ha expirado. Solicita uno nuevo",
        };
      }

      if (data.attempts >= data.maxAttempts) {
        await docRef.delete();
        return {
          valid: false,
          message: "Demasiados intentos fallidos. Solicita un nuevo código",
        };
      }

      const newAttempts = (data.attempts || 0) + 1;

      if (code !== data.code) {
        await docRef.update({ attempts: newAttempts });
        const remainingAttempts = data.maxAttempts - newAttempts;

        return {
          valid: false,
          message: `Código incorrecto. Te quedan ${remainingAttempts} intento${remainingAttempts !== 1 ? "s" : ""}`,
          remainingAttempts,
        };
      }

      await docRef.update({
        isUsed: true,
        attempts: newAttempts,
      });

      const password = decryptPendingPassword(data.passwordEncrypted);

      return {
        valid: true,
        message: "Código verificado correctamente",
        password,
        profile: {
          nombre: data.nombre,
          telefono: data.telefono,
          fechaNacimiento: data.fechaNacimiento,
          genero: data.genero,
        },
      };
    } catch (error) {
      console.error("Error verificando registro pendiente:", error);
      return { valid: false, message: "Error al verificar el código" };
    }
  }

  async deletePendingRegistration(email: string): Promise<void> {
    const normalizedEmail = this.docIdForEmail(email);
    await firestoreApp.collection(COLLECTION).doc(normalizedEmail).delete();
  }
}

export default new PendingRegistrationService();
