/**
 * Sincronización manual de estadísticas Opta (MA2).
 * No toca el flujo de Liga MX.
 */

import "../config/env.bootstrap";
import optaService from "../services/opta";

async function runSync() {
  try {
    console.log(`
╭────────────────────────────────────────────────────────────────╮
│         EJECUTANDO: Sincronización Manual - Opta MA2            │
╰────────────────────────────────────────────────────────────────╯
    `);

    const resultado = await optaService.runScheduledSync();

    if (resultado.omitido) {
      console.log(`\n⚠️  ${resultado.motivoOmision}\n`);
      process.exit(1);
    }

    console.log(`
✅ OPTA COMPLETADA
   • Temporada: ${resultado.temporadaActual}
   • Torneo: ${resultado.torneoActual}
   • Stats sincronizadas: ${resultado.statsSincronizadas}
    `);
  } catch (error) {
    console.error("\n❌ Error durante sincronización Opta:", error instanceof Error ? error.message : error);
    process.exit(1);
  }

  process.exit(0);
}

runSync();
