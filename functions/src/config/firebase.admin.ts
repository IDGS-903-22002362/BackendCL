// config/firebase.admin.ts
import * as admin from "firebase-admin";

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(
            require("../../../serviceAccountAppOficial.json")
        ),
    });
}

console.log(
    "🔥 Firebase apps inicializadas:",
    admin.apps.map(app => app?.name ?? "NULL")
);

export { admin };
