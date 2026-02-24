import { admin } from "./firebase.admin";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import * as path from "path";
import * as fs from "fs";

let serviceAccount;

// Detectar si estamos en Cloud Functions
const isCloudFunction = process.env.FUNCTION_NAME || process.env.K_SERVICE;

// Permitir credencial desde variable de entorno en cualquier entorno
if (process.env.SERVICE_ACCOUNT_APP_OFICIAL) {
  serviceAccount = JSON.parse(process.env.SERVICE_ACCOUNT_APP_OFICIAL);
} else if (!isCloudFunction) {
  // Solo cargar archivo local en desarrollo o CI/CD
  const serviceAccountPath = path.join(
    __dirname,
    "../../../serviceAccountAppOficial.json",
  );

  if (fs.existsSync(serviceAccountPath)) {
    serviceAccount = require(serviceAccountPath);
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
export const authAppOficial = getAuth(appOficial);

console.log("🔥 App oficial inicializada:", {
  appName: appOficial.name,
  projectId: appOficial.options.projectId,
  mode: isCloudFunction ? "cloud" : "local",
});
