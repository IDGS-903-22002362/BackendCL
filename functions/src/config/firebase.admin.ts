// config/firebase.admin.ts
import * as admin from "firebase-admin";

if (!admin.apps.length) {
  const serviceAccount = JSON.parse(
    process.env.SERVICE_ACCOUNT_APP_OFICIAL as string,
  );

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

console.log(
  "🔥 Firebase apps inicializadas:",
  admin.apps.map((app) => app?.name ?? "NULL"),
);

export { admin };
