/**
 * Script para ejecutar la sincronización de Liga MX manualmente
 * Esto simula lo que haría el cron programado (lunes y jueves 00:00)
 */

import "../config/env.bootstrap";
import { loadMissingLocalSecrets } from "../config/load-local-runtime-secrets";
import { LIGA_MX_SECRETS } from "../config/runtime-secrets";

async function runSync() {
  try {
    loadMissingLocalSecrets(LIGA_MX_SECRETS);
    const { default: ligaMxService } = await import("../services/liga-mx");

    console.log(`
╭────────────────────────────────────────────────────────────────╮
│         EJECUTANDO: Sincronización Manual - Liga MX             │
╰────────────────────────────────────────────────────────────────╯
    `);

    console.log("\n⏳ Sincronizando datos de Liga MX...");
    console.log("   Esto puede tomar 30-60 segundos...\n");

    const inicio = Date.now();
    const resultado = await ligaMxService.runScheduledSync();
    const duracion = ((Date.now() - inicio) / 1000).toFixed(2);

    console.log(`
✅ SINCRONIZACIÓN COMPLETADA en ${duracion}s

📊 Resultado:
   • Temporada procesada: ${resultado.temporadaActual}
   • Torneo procesado: ${resultado.torneoActual}
   • Divisiones procesadas: ${resultado.divisionesProcesadas.join(", ")}

🎯 Siguientes pasos:
   1. Ejecuta nuevamente el verificador:
      $ node scripts/verify-torneo-automation.js
      
   2. Prueba los endpoints:
      $ curl http://localhost:3000/api/liga-mx/plantilla?division=varonil
      $ curl http://localhost:3000/api/liga-mx/clasificacion?division=varonil
      $ curl http://localhost:3000/api/liga-mx/calendario?division=varonil
    `);

  } catch (error) {
    console.error("\n❌ Error durante sincronización:", error instanceof Error ? error.message : error);
    console.log("\nVerifica:");
    console.log("  • LMX_API_KEY configurada correctamente");
    console.log("  • La API de Liga MX está disponible");
    console.log("  • Tienes acceso a escribir en Firestore");
    process.exit(1);
  }

  process.exit(0);
}

runSync();
