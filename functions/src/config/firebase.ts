/**
 * Configuración de Firebase Admin SDK para Cloud Functions
 * No requiere archivo serviceAccountKey.json
 */

import * as admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";

// Inicialización con configuración explícita para Storage
const isLocal = process.env.IS_LOCAL === "true";

if (isLocal) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const serviceAccount = require("../../../serviceAccountKey.json");

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    storageBucket: process.env.STORAGE_BUCKET || "e-comerce-leon.appspot.com",
    projectId: process.env.PROJECT_ID || "e-comerce-leon",
  });
} else {
  // Inicialización simple (Firebase usa credenciales internas en producción)
  admin.initializeApp({
    storageBucket: process.env.STORAGE_BUCKET || "e-comerce-leon.appspot.com",
  });
}

// Obtenemos Firestore usando la base de datos 'tiendacl'
const db = getFirestore("tiendacl");

// Opcional: Ajustes de Firestore
db.settings({
  ignoreUndefinedProperties: true,
});

// Exportamos Firestore, Storage y Admin
export const firestore = db;
export const storage = admin.storage();
export { admin };
