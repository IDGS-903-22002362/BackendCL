/**
 * Configuración de Firebase Admin SDK
 * Inicializa la conexión con Firestore para la app del Club León
 */

import * as admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";
import * as dotenv from "dotenv";
import * as path from "path";

// Cargar variables de entorno
dotenv.config();

// Ruta al archivo de credenciales de la cuenta de servicio
const serviceAccountPath = path.resolve(
  process.cwd(),
  process.env.GOOGLE_APPLICATION_CREDENTIALS || "./serviceAccountKey.json"
);

try {
  // Importar las credenciales
  const serviceAccount = require(serviceAccountPath);

  // Inicializar Firebase Admin SDK
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: `https://${serviceAccount.project_id}.firebaseio.com`,
    storageBucket: `${serviceAccount.project_id}.firebasestorage.app`,
  });

  console.log("✅ Firebase Admin SDK inicializado correctamente");
} catch (error) {
  console.error("Error al inicializar Firebase Admin SDK:", error);
  process.exit(1);
}

// Obtener instancia de Firestore con el ID de la base de datos personalizada
const databaseId = process.env.FIRESTORE_DATABASE_ID;
const db = databaseId ? getFirestore(databaseId) : getFirestore();

db.settings({
  ignoreUndefinedProperties: true, // Ignora propiedades undefined en lugar de fallar
});

export const firestore = db;

// Obtener instancia de Storage
export const storage = admin.storage();

// Exportar admin para uso de Timestamp y otros tipos
export { admin };
