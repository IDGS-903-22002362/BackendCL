import { admin } from "./firebase.admin";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { getMessaging } from "firebase-admin/messaging";
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
  }
}

const adminApps = Array.isArray(admin.apps) ? admin.apps : [];
let appOficial = adminApps.find((app) => app?.name === "APP_OFICIAL");

if (!appOficial) {
  const projectId = process.env.APP_OFICIAL_PROJECT_ID || "app-oficial-leon";
  const storageBucket =
    process.env.APP_OFICIAL_STORAGE_BUCKET ||
    `${projectId}.firebasestorage.app`;

  const config: admin.AppOptions = {
    projectId,
    storageBucket,
  };

  if (serviceAccount && typeof admin.credential?.cert === "function") {
    config.credential = admin.credential.cert(serviceAccount);
  } else if (isCloudFunction) {
    console.warn(
      "APP_OFICIAL: SERVICE_ACCOUNT_APP_OFICIAL no configurado; Firebase Auth de app-oficial puede fallar",
    );
  }

  appOficial = admin.initializeApp(config, "APP_OFICIAL");
}

export const firestoreApp = getFirestore(appOficial);
firestoreApp.settings({ ignoreUndefinedProperties: true });
export const authAppOficial = getAuth(appOficial);
export const messagingAppOficial = getMessaging(appOficial);

// Exportamos el servicio de Storage asociado a esta app
export const storageAppOficial = appOficial.storage();

console.log("🔥 App oficial inicializada:", {
  appName: appOficial.name,
  projectId: appOficial.options.projectId,
  mode: isCloudFunction ? "cloud" : "local",
  hasServiceAccount: Boolean(serviceAccount),
});
