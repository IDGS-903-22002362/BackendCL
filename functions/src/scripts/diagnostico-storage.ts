/**
 * Script para diagnosticar y obtener información del Storage Bucket
 */

import * as admin from "firebase-admin";
import * as path from "path";
import * as dotenv from "dotenv";

dotenv.config();

const serviceAccountPath = path.resolve(
  process.cwd(),
  process.env.GOOGLE_APPLICATION_CREDENTIALS || "./serviceAccountKey.json"
);

const serviceAccount = require(serviceAccountPath);

console.log("🔍 Diagnóstico de Firebase Storage\n");
console.log("=====================================");
console.log(`Proyecto ID: ${serviceAccount.project_id}`);
console.log("=====================================\n");

// Inicializar sin especificar bucket
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const storage = admin.storage();

console.log("📋 Información del Storage:");
console.log(`Bucket por defecto: ${storage.bucket().name}`);
console.log("\n💡 Usa este nombre de bucket en tu configuración\n");

console.log("🧪 Probando acceso al bucket...");
storage
  .bucket()
  .getMetadata()
  .then((data) => {
    const metadata = data[0];
    console.log("✅ Bucket accesible!");
    console.log(`Nombre: ${metadata.name || metadata.id}`);
    console.log(`Ubicación: ${metadata.location}`);
    console.log(`Clase de almacenamiento: ${metadata.storageClass}`);
    console.log("\n✨ Configuración recomendada:");
    console.log(`storageBucket: "${metadata.name || metadata.id}"`);
    process.exit(0);
  })
  .catch((error) => {
    console.error("❌ Error al acceder al bucket:");
    console.error(error.message);
    console.log("\n🔧 Posibles soluciones:");
    console.log("1. Ve a Firebase Console → Storage");
    console.log("2. Habilita Firebase Storage si no está activado");
    console.log("3. Verifica que el bucket existe");
    console.log("4. Revisa los permisos de la Service Account");
    process.exit(1);
  });
