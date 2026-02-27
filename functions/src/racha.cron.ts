import * as functions from "firebase-functions/v1";
import { firestoreApp } from "./config/app.firebase";
import { admin } from "./config/firebase.admin";
import rachaService from "./services/racha.service";
import { toDayKey } from "./utils/day-key.util";

const USERS_COLLECTION = "usuariosApp";
const SYSTEM_NOTIFICATIONS_COLLECTION = "notificacionesSistema";

// Ejecuta a medianoche según la zona configurada
export const processDailyRachas = functions.pubsub
  .schedule("0 0 * * *")
  .timeZone(process.env.RACHA_TIMEZONE || "America/Mexico_City")
  .onRun(async () => {
    const db = firestoreApp;
    const pageSize = 500;
    let lastDoc: any = null;
    let processed = 0;

    const serverNow = new Date();

    try {
      while (true) {
        let q: any = db.collection(USERS_COLLECTION).orderBy("__name__").limit(pageSize);
        if (lastDoc) q = q.startAfter(lastDoc);

        const snap = await q.get();
        if (snap.empty) break;

        for (const doc of snap.docs) {
          try {
            const data: any = doc.data() || {};

            const tz: string =
              data.timeZone || data.timezone || data.tz || process.env.RACHA_TIMEZONE || "America/Mexico_City";

            const userTodayKey = toDayKey(serverNow, tz);
            const lastDay = data.streakLastDay ?? null;

            // Saltar si ya tiene check-in para su fecha local
            if (lastDay === userTodayKey) continue;

            // Llamada atómica/idempotente al servicio existente
            const result = await rachaService.checkIn(doc.id, tz);

            // Si hubo nuevo check-in, crear notificación in-app para que cliente reaccione
            if (result && !result.alreadyCheckedIn) {
              const nowTs = admin.firestore.Timestamp.now();
              await firestoreApp.collection(SYSTEM_NOTIFICATIONS_COLLECTION).add({
                tipo: "racha_checkin",
                canal: "in_app",
                destinatarioUid: doc.id,
                titulo: "¡Racha actualizada!",
                mensaje: `Tu racha ahora es de ${result.streakCount} día(s).`,
                leida: false,
                payload: {
                  streakCount: result.streakCount,
                  streakBest: result.streakBest,
                  fecha: userTodayKey,
                },
                createdAt: nowTs,
                updatedAt: nowTs,
              });
            }

            processed += 1;
          } catch (err) {
            console.error("Error procesando racha usuario", doc.id, err);
          }
        }

        lastDoc = snap.docs[snap.docs.length - 1];
        if (snap.size < pageSize) break;
      }

      console.log(`Rachas procesadas: ${processed}`);
    } catch (err) {
      console.error("Fallo en cron de rachas:", err);
    }

    return null;
  });
