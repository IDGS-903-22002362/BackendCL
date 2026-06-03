import { firestoreApp } from "../../config/app.firebase";
import { admin } from "../../config/firebase.admin";


const OTP_COLLECTION = "temp_verification_codes";
const OTP_EXPIRY_MINUTES = 10;
const OTP_LENGTH = 6;
const MAX_ATTEMPTS = 3;
const CLEANUP_BATCH_SIZE = 100;

/**
 * Servicio para manejar códigos OTP usando Firestore con TTL automático
 */
class OTPService {

    /**
     * Genera un código aleatorio de 6 dígitos
     */
    generateCode(): string {
        return Math.floor(100000 + Math.random() * 900000).toString();
    }

    /**
     * Almacena un código OTP en Firestore con expiración automática
     */
    async storeOTP(email: string, code?: string): Promise<{ code: string; success: boolean }> {
        try {
            const normalizedEmail = email.toLowerCase().trim();
            const otpCode = code || this.generateCode();
            const docId = `${normalizedEmail}_${Date.now()}`;

            // Calcular tiempo de expiración
            const expiresAt = new Date();
            expiresAt.setMinutes(expiresAt.getMinutes() + OTP_EXPIRY_MINUTES);

            // Crear documento en Firestore
            const otpData = {
                email: normalizedEmail,
                code: otpCode,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                expiresAt: admin.firestore.Timestamp.fromDate(expiresAt),
                attempts: 0,
                maxAttempts: MAX_ATTEMPTS,
                isUsed: false,
                usedAt: null
            };

            // Guardar en Firestore
            await firestoreApp
                .collection(OTP_COLLECTION)
                .doc(docId)
                .set(otpData);

            // Opcional: Eliminar códigos anteriores del mismo email
            await this.cleanOldCodesForEmail(normalizedEmail, docId);

            console.log(`✅ OTP almacenado para ${email}, expira en ${OTP_EXPIRY_MINUTES} minutos`);
            return { code: otpCode, success: true };

        } catch (error) {
            console.error("❌ Error almacenando OTP:", error);
            return { code: "", success: false };
        }
    }

    /**
     * Limpia códigos viejos del mismo email (opcional, TTL los eliminará eventualmente)
     */
    private async cleanOldCodesForEmail(email: string, excludeDocId: string): Promise<void> {
        try {
            const snapshot = await firestoreApp
                .collection(OTP_COLLECTION)
                .where("email", "==", email)
                .where("isUsed", "==", false)
                .get();

            const batch = firestoreApp.batch();
            let count = 0;

            snapshot.docs.forEach(doc => {
                if (doc.id !== excludeDocId) {
                    batch.delete(doc.ref);
                    count++;
                }
            });

            if (count > 0) {
                await batch.commit();
                console.log(`🗑️ Eliminados ${count} códigos OTP antiguos para ${email}`);
            }
        } catch (error) {
            console.warn("Error limpiando códigos antiguos:", error);
        }
    }

    /**
     * Verifica un código OTP
     */
    async verifyOTP(email: string, code: string): Promise<{ valid: boolean; message: string; remainingAttempts?: number }> {
        try {
            const normalizedEmail = email.toLowerCase().trim();

            // Buscar código válido no usado
            const snapshot = await firestoreApp
                .collection(OTP_COLLECTION)
                .where("email", "==", normalizedEmail)
                .where("code", "==", code)
                .where("isUsed", "==", false)
                .limit(1)
                .get();

            if (snapshot.empty) {
                return { valid: false, message: "Código inválido o expirado" };
            }

            const doc = snapshot.docs[0];
            const data = doc.data();
            const now = admin.firestore.Timestamp.now();

            // Verificar expiración
            if (data.expiresAt < now) {
                await doc.ref.delete(); // Eliminar documento expirado
                return { valid: false, message: "El código ha expirado. Solicita uno nuevo" };
            }

            // Verificar intentos
            if (data.attempts >= data.maxAttempts) {
                await doc.ref.delete();
                return { valid: false, message: "Demasiados intentos fallidos. Solicita un nuevo código" };
            }

            // Incrementar intentos
            const newAttempts = (data.attempts || 0) + 1;
            await doc.ref.update({ attempts: newAttempts });

            // Código correcto
            if (code === data.code) {
                // Marcar como usado
                await doc.ref.update({
                    isUsed: true,
                    usedAt: admin.firestore.FieldValue.serverTimestamp()
                });

                // Opcional: Programar eliminación inmediata
                setTimeout(async () => {
                    try {
                        await doc.ref.delete();
                    } catch (e) {
                        // El documento puede ya haber sido eliminado por TTL
                    }
                }, 5000);

                return { valid: true, message: "Código verificado correctamente" };
            }

            // Código incorrecto
            const remainingAttempts = data.maxAttempts - newAttempts;
            return {
                valid: false,
                message: `Código incorrecto. Te quedan ${remainingAttempts} intento${remainingAttempts !== 1 ? 's' : ''}`,
                remainingAttempts
            };

        } catch (error) {
            console.error("Error verificando OTP:", error);
            return { valid: false, message: "Error al verificar el código" };
        }
    }

    /**
     * Limpieza manual de códigos expirados (backup por si TTL no funciona)
     */
    async manualCleanup(): Promise<number> {
        try {
            const now = admin.firestore.Timestamp.now();
            let deletedCount = 0;
            let lastDoc: any = null;
            let hasMore = true;

            while (hasMore) {
                let query = firestoreApp
                    .collection(OTP_COLLECTION)
                    .where("expiresAt", "<", now)
                    .limit(CLEANUP_BATCH_SIZE);

                if (lastDoc) {
                    query = query.startAfter(lastDoc);
                }

                const snapshot = await query.get();

                if (snapshot.empty) {
                    hasMore = false;
                    break;
                }

                const batch = firestoreApp.batch();
                snapshot.docs.forEach(doc => {
                    batch.delete(doc.ref);
                    deletedCount++;
                });

                await batch.commit();
                lastDoc = snapshot.docs[snapshot.docs.length - 1];

                if (snapshot.docs.length < CLEANUP_BATCH_SIZE) {
                    hasMore = false;
                }
            }

            console.log(`🧹 Limpieza manual completada: ${deletedCount} códigos eliminados`);
            return deletedCount;

        } catch (error) {
            console.error("Error en limpieza manual:", error);
            return 0;
        }
    }

    /**
     * Obtener estadísticas de códigos activos
     */
    async getStats(): Promise<{ active: number; expired: number; total: number }> {
        try {
            const now = admin.firestore.Timestamp.now();

            const [activeSnapshot, expiredSnapshot, totalSnapshot] = await Promise.all([
                firestoreApp.collection(OTP_COLLECTION).where("expiresAt", ">", now).where("isUsed", "==", false).get(),
                firestoreApp.collection(OTP_COLLECTION).where("expiresAt", "<=", now).get(),
                firestoreApp.collection(OTP_COLLECTION).get()
            ]);

            return {
                active: activeSnapshot.size,
                expired: expiredSnapshot.size,
                total: totalSnapshot.size
            };
        } catch (error) {
            console.error("Error obteniendo estadísticas:", error);
            return { active: 0, expired: 0, total: 0 };
        }
    }

    /**
     * Forzar eliminación de todos los códigos de un email específico
     */
    async clearUserCodes(email: string): Promise<number> {
        try {
            const normalizedEmail = email.toLowerCase().trim();
            const snapshot = await firestoreApp
                .collection(OTP_COLLECTION)
                .where("email", "==", normalizedEmail)
                .get();

            const batch = firestoreApp.batch();
            snapshot.docs.forEach(doc => {
                batch.delete(doc.ref);
            });

            await batch.commit();
            console.log(`🗑️ Eliminados ${snapshot.size} códigos para ${email}`);
            return snapshot.size;

        } catch (error) {
            console.error("Error limpiando códigos del usuario:", error);
            return 0;
        }
    }
}

// Exportar instancia única
export default new OTPService();