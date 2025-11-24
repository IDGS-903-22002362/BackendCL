/**
 * Punto de entrada del servidor
 * Inicializa y arranca el servidor HTTP
 */

import * as dotenv from "dotenv";
import app from "./app";

// Cargar variables de entorno
dotenv.config();

/**
 * Puerto del servidor
 * Lee de variable de entorno o usa 3000 por defecto
 */
const PORT = process.env.PORT || 3000;

/**
 * Iniciar servidor
 */
const startServer = async () => {
  try {
    // Importar configuración de Firebase para inicializarlo
    await import("./config/firebase");

    // Iniciar servidor Express
    app.listen(PORT, () => {
      console.log("\n🚀 ============================================");
      console.log(`Backend Club León - Tienda API`);
      console.log("============================================");
      console.log(`Servidor corriendo en: http://localhost:${PORT}`);
      console.log(`Ambiente: ${process.env.NODE_ENV || "development"}`);
      console.log(`Iniciado: ${new Date().toLocaleString("es-MX")}`);
      console.log("============================================");
      console.log("\n📚 Endpoints disponibles:");
      console.log(`   GET  http://localhost:${PORT}/`);
      console.log(`   GET  http://localhost:${PORT}/health`);
      console.log(`   GET  http://localhost:${PORT}/api/productos`);
      console.log(`   GET  http://localhost:${PORT}/api/productos/:id`);
      console.log(
        `   GET  http://localhost:${PORT}/api/productos/categoria/:categoriaId`
      );
      console.log(
        `   GET  http://localhost:${PORT}/api/productos/linea/:lineaId`
      );
      console.log(
        `   GET  http://localhost:${PORT}/api/productos/buscar/:termino`
      );
      console.log("============================================\n");
    });
  } catch (error) {
    console.error("Error al iniciar el servidor:", error);
    process.exit(1);
  }
};

/**
 * Manejo de errores no capturados
 */
process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection en:", promise);
  console.error("Razón:", reason);
  // No cerramos el servidor en desarrollo para facilitar debugging
  if (process.env.NODE_ENV === "production") {
    process.exit(1);
  }
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);
  process.exit(1);
});

/**
 * Manejo de señales de terminación
 */
process.on("SIGTERM", () => {
  console.log("\nSIGTERM recibido. Cerrando servidor gracefully...");
  process.exit(0);
});

process.on("SIGINT", () => {
  console.log("\nSIGINT recibido. Cerrando servidor gracefully...");
  process.exit(0);
});

// Iniciar el servidor
startServer();
