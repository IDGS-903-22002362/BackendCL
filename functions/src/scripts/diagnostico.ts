/**
 * Script de diagnóstico para verificar la conexión con Firebase
 */

import * as dotenv from "dotenv";
import { firestoreTienda } from "../config/firebase";

dotenv.config();

async function diagnosticar() {
  console.log("\n🔍 Diagnóstico de conexión Firebase\n");

  try {
    console.log("1. Verificando credenciales...");
    console.log(
      `   GOOGLE_APPLICATION_CREDENTIALS: ${process.env.GOOGLE_APPLICATION_CREDENTIALS}`
    );

    console.log("\n2. Intentando conectar con Firestore...");

    // Intentar una operación simple
    const testRef = firestoreTienda.collection("_test").doc("conexion");
    await testRef.set({
      timestamp: new Date(),
      mensaje: "Prueba de conexión",
    });

    console.log("Conexión exitosa!");
    console.log("Firestore está funcionando correctamente\n");

    // Limpiar documento de prueba
    await testRef.delete();

    console.log("Firestore está configurado y funcionando correctamente");

    process.exit(0);
  } catch (error: any) {
    console.error("\n❌ Error de conexión:\n");

    if (error.code === 5) {
      console.error(
        "ERROR: Firestore no está habilitado o el proyecto no existe\n"
      );
      console.error("SOLUCIONES:");
      console.error("1. Ve a https://console.firebase.google.com");
      console.error("2. Selecciona tu proyecto");
      console.error('3. Ve a "Firestore Database" en el menú lateral');
      console.error('4. Haz clic en "Crear base de datos"');
      console.error('5. Selecciona modo "Producción" o "Prueba"');
      console.error("6. Elige una ubicación (ej: us-central)");
      console.error("7. Vuelve a ejecutar este script\n");
    } else if (error.code === "ENOENT") {
      console.error(
        "⚠️  ERROR: No se encuentra el archivo serviceAccountKey.json\n"
      );
      console.error("SOLUCIONES:");
      console.error("1. Descarga las credenciales desde Firebase Console");
      console.error("2. Ve a Configuración del proyecto > Cuentas de servicio");
      console.error('3. Haz clic en "Generar nueva clave privada"');
      console.error(
        "4. Guarda el archivo como serviceAccountKey.json en la raíz del proyecto\n"
      );
    } else {
      console.error("Detalles del error:", error.message);
      console.error("\nCódigo de error:", error.code);
    }

    process.exit(1);
  }
}

diagnosticar();
