// config/firebase.admin.ts
import * as admin from "firebase-admin";
import * as path from "path";
import * as fs from "fs";

if (!admin.apps.length) {
  let serviceAccount;

  // Ruta al archivo en el workspace (GitHub Actions lo crea aquí)
  const serviceAccountPath = path.join(
    __dirname,
    "../../../serviceAccountAppOficial.json",
  );

  // Prioridad: archivo físico > variable de entorno
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

console.log(
  "🔥 Firebase apps inicializadas:",
  admin.apps.map((app) => app?.name ?? "NULL"),
);

export { admin };
