/**
 * Configuración de Firebase Admin SDK para Cloud Functions
 * No requiere archivo serviceAccountKey.json
 */

import * as admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";

// Inicialización simple (Firebase usa credenciales internas)
admin.initializeApp();

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
