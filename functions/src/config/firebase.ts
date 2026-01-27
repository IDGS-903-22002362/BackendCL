import { admin } from "./firebase.admin";
import { getFirestore } from "firebase-admin/firestore";
import * as path from "path";
import * as fs from "fs";

let serviceAccount;

const serviceAccountPath = path.join(
  __dirname,
  "../../../serviceAccountKey.json",
);

// Prioridad: archivo físico > variable de entorno
if (fs.existsSync(serviceAccountPath)) {
  serviceAccount = require(serviceAccountPath);
} else if (process.env.SERVICE_ACCOUNT_KEY) {
  serviceAccount = JSON.parse(process.env.SERVICE_ACCOUNT_KEY);
} else {
  throw new Error(
    "No se encontró serviceAccountKey.json ni SERVICE_ACCOUNT_KEY",
  );
}

let tiendaApp = admin.apps.find((app) => app?.name === "TIENDA_APP");

if (!tiendaApp) {
  tiendaApp = admin.initializeApp(
    {
      credential: admin.credential.cert(serviceAccount),
      projectId: "e-comerce-leon",
      storageBucket: "e-comerce-leon.appspot.com",
    },
    "TIENDA_APP",
  );
}

export const firestoreTienda = getFirestore(tiendaApp, "tiendacl");
export const storageTienda = tiendaApp.storage();
