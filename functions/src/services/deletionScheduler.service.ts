import { admin } from "../config/firebase.admin";
import { firestoreApp } from "../config/app.firebase";

export class DeletionSchedulerService {
    /**
     * Procesa todas las solicitudes de eliminación cuya fechaProgramada ya pasó.
     * Elimina el usuario de Firebase Auth y el documento de Firestore.
     * Opcionalmente guarda un respaldo en colección "usuariosEliminados".
     */
    async processPendingDeletions(): Promise<void> {
        const now = admin.firestore.Timestamp.now();

        // Buscar usuarios con solicitud pendiente y fechaProgramada <= ahora
        const snapshot = await firestoreApp
            .collection("usuariosApp")
            .where("solicitudEliminacion.estado", "==", "pendiente")
            .where("solicitudEliminacion.fechaProgramada", "<=", now)
            .get();

        if (snapshot.empty) {
            console.log("No hay eliminaciones pendientes por procesar");
            return;
        }

        console.log(`Procesando ${snapshot.size} cuentas para eliminación definitiva`);

        for (const doc of snapshot.docs) {
            const uid = doc.id;

            try {
                // 1. Eliminar usuario de Firebase Authentication
                await admin.auth().deleteUser(uid);
                console.log(`Usuario ${uid} eliminado de Firebase Auth`);

                // 3. Eliminar documento de Firestore
                await doc.ref.delete();
                console.log(`Documento de usuario ${uid} eliminado de Firestore`);

            } catch (error) {
                console.error(`Error al eliminar usuario ${uid}:`, error);
                // Marcar como error para reintentar en la próxima ejecución
                await doc.ref.update({
                    "solicitudEliminacion.estado": "error",
                    "solicitudEliminacion.error": String(error),
                });
            }
        }
    }
}

export default new DeletionSchedulerService();