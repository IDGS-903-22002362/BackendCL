import "./config/env.bootstrap";
import app from "./app";
import { assertAiConfig, getAiRuntimeSummary } from "./config/ai.config";

// Verificar el entorno
if (process.env.IS_LOCAL !== "true") {
  console.warn(
    "⚠️  ADVERTENCIA: Estás ejecutando el servidor de desarrollo sin IS_LOCAL=true",
  );
}

const PORT = Number(process.env.PORT) || 3000;

assertAiConfig({ requireTryOn: true });

console.log("AI runtime config validated:", getAiRuntimeSummary());

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
