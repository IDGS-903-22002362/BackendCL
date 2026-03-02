import cron from "node-cron";
import instagramService from "../services/instagram.service";
import { firestoreApp } from "../config/app.firebase";

export const startInstagramSyncJob = () => {


    cron.schedule("0 */2 * * *", async () => {
        console.log("⏰ Ejecutando sync automático Instagram...");

        try {
            const postsMapeados =
                await instagramService.obtenerPublicaciones();

            const batch = firestoreApp.batch();
            const noticiasRef = firestoreApp.collection("noticias");

            for (const data of postsMapeados) {
                if (!data.contenido) continue;

                const docRef = noticiasRef.doc(data.id);
                batch.set(docRef, data, { merge: true });
            }

            await batch.commit();

            console.log(
                `✅ Sync Instagram completado (${postsMapeados.length} posts)`
            );
        } catch (error) {
            console.error("❌ Error en cron Instagram:", error);
        }
    });

    console.log("🚀 Instagram Sync Job iniciado (cada 2 horas)");
};