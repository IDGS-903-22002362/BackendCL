const admin = require("firebase-admin");
const sa = require("../../serviceAccountAppOficial.json");

const EMULATOR_HOST = "127.0.0.1:8080";

function prodApp() {
  return admin.initializeApp(
    {
      credential: admin.credential.cert(sa),
      projectId: "app-oficial-leon",
    },
    "prod-seed",
  );
}

function emulatorApp() {
  process.env.FIRESTORE_EMULATOR_HOST = EMULATOR_HOST;
  return admin.initializeApp({ projectId: "app-oficial-leon" }, "emu-seed");
}

async function copyCollection(source, target) {
  const pageSize = 300;
  let copied = 0;
  let last = null;
  for (;;) {
    let query = source.orderBy(admin.firestore.FieldPath.documentId()).limit(pageSize);
    if (last) query = query.startAfter(last);
    const snap = await query.get();
    if (snap.empty) break;
    const batch = target.firestore.batch();
    for (const doc of snap.docs) {
      batch.set(target.doc(doc.id), doc.data());
    }
    await batch.commit();
    copied += snap.size;
    last = snap.docs[snap.docs.length - 1];
    if (snap.size < pageSize) break;
  }
  return copied;
}

(async () => {
  const prod = prodApp();
  const prodDb = admin.firestore(prod);
  prodDb.settings({ ignoreUndefinedProperties: true });

  const minis = await prodDb.collection("minijuegos").get();
  const beneficios = await prodDb.collection("beneficios").get();
  console.log("prod.minijuegos", minis.size);
  console.log("prod.beneficios", beneficios.size);
  for (const doc of minis.docs) {
    const data = doc.data();
    const audiencia = data.audiencia || {};
    console.log(
      "prod.minijuego",
      doc.id,
      data.tipo || "",
      audiencia.visibilidad || "",
    );
  }

  const emu = emulatorApp();
  const emuDb = admin.firestore(emu);
  emuDb.settings({ ignoreUndefinedProperties: true });
  await emuDb.collection("_emulator_probe").doc("ok").set({ at: Date.now() });
  const leaked = await prodDb.collection("_emulator_probe").doc("ok").get();
  if (leaked.exists) {
    throw new Error("El cliente del emulador escribió en Firestore real. Seed abortado.");
  }
  const users = await copyCollection(
    prodDb.collection("usuariosApp"),
    emuDb.collection("usuariosApp"),
  );
  const emuUsers = await emuDb.collection("usuariosApp").count().get();
  const emuGames = await emuDb.collection("minijuegos").count().get();
  console.log("emulator.usuariosApp", users, "count", emuUsers.data().count);
  console.log("emulator.minijuegos", emuGames.data().count);
  process.exit(0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
