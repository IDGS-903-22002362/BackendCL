// src/services/racha.service.ts

import { firestoreApp } from "../config/app.firebase";
import { admin } from "../config/firebase.admin";
import { toDayKey, previousDayKey } from "../utils/day-key.util";
import { RachaCheckInResult } from "../models/racha.model";

export class RachaService {
    private usersCollection = firestoreApp.collection("usuariosApp");

    /**
     * Check-in de racha: solo 1 vez por día.
     * - Si ya hizo check-in hoy => no cambia.
     * - Si su último día fue ayer => incrementa.
     * - Si se saltó días => reinicia a 1.
     */
    async checkIn(uid: string, timeZone = "America/Mexico_City"): Promise<RachaCheckInResult> {
        const userRef = this.usersCollection.doc(uid);

        return await firestoreApp.runTransaction(async (tx) => {
            const snap = await tx.get(userRef);

            if (!snap.exists) {
                throw new Error(`Usuario con UID ${uid} no encontrado`);
            }

            const data = snap.data() || {};

            const nowTs = admin.firestore.Timestamp.now(); // hora del servidor
            const todayKey = toDayKey(nowTs.toDate(), timeZone);
            const prevKey = previousDayKey(todayKey);

            const lastDay: string | null = data.streakLastDay ?? null;
            let streakCount: number = Number(data.streakCount ?? 0);
            let streakBest: number = Number(data.streakBest ?? 0);

            // 1) Ya hizo check-in hoy
            if (lastDay === todayKey) {
                return {
                    todayKey,
                    alreadyCheckedIn: true,
                    streakCount,
                    streakBest,
                };
            }

            // 2) Si venía de ayer => sube
            if (lastDay === prevKey) {
                streakCount = streakCount + 1;
            } else {
                // 3) Si no, reinicia en 0 (primera marca es día 0)
                streakCount = 0;
            }

            streakBest = Math.max(streakBest, streakCount);

            tx.update(userRef, {
                streakCount,
                streakBest,
                streakLastDay: todayKey,
                streakUpdatedAt: nowTs,
            });

            return {
                todayKey,
                alreadyCheckedIn: false,
                streakCount,
                streakBest,
            };
        });
    }

    /**
     * Solo para mostrar info sin modificar (útil para el perfil)
     */
    async getRacha(uid: string) {
        const doc = await this.usersCollection.doc(uid).get();
        if (!doc.exists) return null;
        const data = doc.data() || {};
        return {
            streakCount: Number(data.streakCount ?? 0),
            streakBest: Number(data.streakBest ?? 0),
            streakLastDay: data.streakLastDay ?? null,
            streakUpdatedAt: data.streakUpdatedAt ?? null,
        };
    }
}

export default new RachaService();