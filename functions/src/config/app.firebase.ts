import { admin } from "./firebase.admin";
import { getFirestore } from "firebase-admin/firestore";

const serviceAccount = require("../../../serviceAccountAppOficial.json");

let appOficial = admin.apps.find(app => app?.name === "APP_OFICIAL");

if (!appOficial) {
    appOficial = admin.initializeApp(
        {
            credential: admin.credential.cert(serviceAccount),
            projectId: "app-oficial-leon",
        },
        "APP_OFICIAL"
    );
}

export const firestoreApp = getFirestore(appOficial);
