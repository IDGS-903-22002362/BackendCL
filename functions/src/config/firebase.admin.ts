// config/firebase.admin.ts
import * as admin from "firebase-admin";
import * as path from "path";
import * as fs from "fs";

if (!admin.apps.length) {
  // Detectar si estamos en Cloud Functions (producción)
  const isCloudFunction = process.env.FUNCTION_NAME || process.env.K_SERVICE;

  if (isCloudFunction) {
    // En Cloud Functions, usar credenciales predeterminadas del entorno
    admin.initializeApp();
  } else {
    // En desarrollo local o CI/CD, usar archivo o variable de entorno
    let serviceAccount;

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

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  }
}

console.log(
  "🔥 Firebase apps inicializadas:",
  admin.apps.map((app) => app?.name ?? "NULL"),
);

export { admin };
