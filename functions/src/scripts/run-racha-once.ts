import * as dotenv from "dotenv";
dotenv.config();

import { firestoreApp } from "../config/app.firebase";
import rachaService from "../services/racha.service";
import { toDayKey } from "../utils/day-key.util";

async function runOnce() {
  const db = firestoreApp;
  const testUid = process.env.TEST_UID;
  const limit = Number(process.env.TEST_LIMIT || "10");
  const tzEnv = process.env.RACHA_TIMEZONE || "America/Mexico_City";

  if (testUid) {
    console.log("Ejecutando check-in de racha para UID de prueba:", testUid);
    try {
      const res = await rachaService.checkIn(testUid, tzEnv);
      console.log("Resultado:", res);
    } catch (err) {
      console.error("Error al ejecutar checkIn para UID:", err);
    }
    return;
  }

  console.log("No TEST_UID proporcionado — procesando primeros usuarios (limit:", limit, ")");

  const snap = await db.collection("usuariosApp").limit(limit).get();
  for (const doc of snap.docs) {
    try {
      const data: any = doc.data() || {};
      const tz = data.timeZone || data.timezone || data.tz || tzEnv;
      const todayKey = toDayKey(new Date(), tz);
      console.log(`Procesando ${doc.id} (tz=${tz}) — todayKey=${todayKey} — lastDay=${data.streakLastDay}`);

      const res = await rachaService.checkIn(doc.id, tz);
      console.log(" -> resultado:", res);
    } catch (err) {
      console.error("Error procesando usuario", doc.id, err);
    }
  }
}

runOnce()
  .then(() => {
    console.log("Run finished");
    process.exit(0);
  })
  .catch((err) => {
    console.error("Run failed:", err);
    process.exit(1);
  });
