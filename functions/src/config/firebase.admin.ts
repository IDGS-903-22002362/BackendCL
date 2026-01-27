// config/firebase.admin.ts
import * as admin from "firebase-admin";

if (!admin.apps.length) {
  let serviceAccount;

  // Priorizar variable de entorno, luego archivo local
  if (process.env.SERVICE_ACCOUNT_APP_OFICIAL) {
    serviceAccount = JSON.parse(process.env.SERVICE_ACCOUNT_APP_OFICIAL);
  } else {
    serviceAccount = require("../../../serviceAccountAppOficial.json");
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
