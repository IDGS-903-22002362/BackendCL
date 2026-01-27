import { admin } from "./firebase.admin";
import { getFirestore } from "firebase-admin/firestore";
import * as path from "path";
import * as fs from "fs";

let serviceAccount;

// Detectar si estamos en Cloud Functions
const isCloudFunction = process.env.FUNCTION_NAME || process.env.K_SERVICE;

if (!isCloudFunction) {
  // Solo cargar service account en desarrollo local o CI/CD
  const serviceAccountPath = path.join(
    __dirname,
    "../../../serviceAccountKey.json",
  );

  if (fs.existsSync(serviceAccountPath)) {
    serviceAccount = require(serviceAccountPath);
  } else if (process.env.SERVICE_ACCOUNT_KEY) {
    serviceAccount = JSON.parse(process.env.SERVICE_ACCOUNT_KEY);
  } else {
    throw new Error(
      "No se encontró serviceAccountKey.json ni SERVICE_ACCOUNT_KEY",
    );
  }
}

let tiendaApp = admin.apps.find((app) => app?.name === "TIENDA_APP");

if (!tiendaApp) {
  const config: any = {
    projectId: "e-comerce-leon",
    storageBucket: "e-comerce-leon.appspot.com",
  };

  // Solo agregar credenciales si no estamos en Cloud Functions
  if (!isCloudFunction && serviceAccount) {
    config.credential = admin.credential.cert(serviceAccount);
  }

  tiendaApp = admin.initializeApp(config, "TIENDA_APP");
}

export const firestoreTienda = getFirestore(tiendaApp, "tiendacl");
export const storageTienda = tiendaApp.storage();
