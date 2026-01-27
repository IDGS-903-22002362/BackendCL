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
    "../../../serviceAccountAppOficial.json",
  );

  if (fs.existsSync(serviceAccountPath)) {
    serviceAccount = require(serviceAccountPath);
  } else if (process.env.SERVICE_ACCOUNT_APP_OFICIAL) {
    serviceAccount = JSON.parse(process.env.SERVICE_ACCOUNT_APP_OFICIAL);
  } else {
    throw new Error(
      "No se encontró serviceAccountAppOficial.json ni SERVICE_ACCOUNT_APP_OFICIAL",
    );
  }
}

let appOficial = admin.apps.find((app) => app?.name === "APP_OFICIAL");

if (!appOficial) {
  const config: any = {
    projectId: "app-oficial-leon",
  };

  // Solo agregar credenciales si no estamos en Cloud Functions
  if (!isCloudFunction && serviceAccount) {
    config.credential = admin.credential.cert(serviceAccount);
  }

  appOficial = admin.initializeApp(config, "APP_OFICIAL");
}

export const firestoreApp = getFirestore(appOficial);
