import { admin } from "./firebase.admin";
import { getFirestore } from "firebase-admin/firestore";

const serviceAccount = JSON.parse(process.env.SERVICE_ACCOUNT_KEY as string);

let tiendaApp = admin.apps.find((app) => app?.name === "TIENDA_APP");

if (!tiendaApp) {
  tiendaApp = admin.initializeApp(
    {
      credential: admin.credential.cert(serviceAccount),
      projectId: "e-comerce-leon",
      storageBucket: "e-comerce-leon.appspot.com",
    },
    "TIENDA_APP",
  );
}

export const firestoreTienda = getFirestore(tiendaApp, "tiendacl");
export const storageTienda = tiendaApp.storage();
