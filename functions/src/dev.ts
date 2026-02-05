import * as dotenv from "dotenv";
// Cargar variables de entorno desde el archivo .env una sola vez
dotenv.config();

import app from "./app";

// Verificar el entorno
if (process.env.IS_LOCAL !== "true") {
  console.warn(
    "⚠️  ADVERTENCIA: Estás ejecutando el servidor de desarrollo sin IS_LOCAL=true",
  );
}

const PORT = Number(process.env.PORT) || 3000;

app.listen(PORT, () => {
  console.log(`
  ╭────────────────────────────────────────────────────────╮
  │                                                        │
  │   🚀 Servidor de Desarrollo Local Club León Activo     │
  │                                                        │
  │   📡 API URL:   http://localhost:${PORT}/api              │
  │   📝 Swagger:   http://localhost:${PORT}/api-docs      │
  │   👤 Admin SDK: Inicializado                           │
  │                                                        │
  ╰────────────────────────────────────────────────────────╯
  `);
});
