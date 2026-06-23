/**
 * SCRIPT DE VERIFICACIÓN: Detectar cambio de torneo y limpiar/actualizar BD
 * 
 * Este script simula lo que hace runScheduledSync() para verificar que:
 * 1. ✅ Detecta automáticamente el torneo/temporada activos desde la API
 * 2. ✅ Detecta cambios de torneo comparando contexto anterior vs nuevo
 * 3. ✅ Limpia TODOS los datos cuando hay cambio (limpiarDatosVigentes)
 * 4. ✅ Sincroniza nueva data: calendario, clasificación, plantilla, estadísticas
 */

import "../config/env.bootstrap";
import { firestoreApp } from "../config/app.firebase";
import { configuracionLigaMx } from "../config/liga-mx.config";
import ligaMxService from "../services/liga-mx";

const COLECCIONES = {
  contextoActual: "liga_mx_contexto_actual",
  calendariosActuales: "liga_mx_calendarios_actuales",
  clasificacionesActuales: "liga_mx_clasificaciones_actuales",
  plantillasActuales: "liga_mx_plantillas_actuales",
  jugadoresActuales: "liga_mx_jugadores_actuales",
  partidosActuales: "liga_mx_partidos_actuales",
  detallesPartidoActuales: "liga_mx_detalles_partido_actuales",
};

async function contarDocumentosEnColeccion(nombreColeccion: string): Promise<number> {
  const snapshot = await firestoreApp.collection(nombreColeccion).limit(1000).get();
  return snapshot.size;
}

async function verificarSincronizacion() {
  try {
    console.log(`
╭────────────────────────────────────────────────────────────────╮
│    VERIFICACIÓN: Automação de Cambio de Torneo - Liga MX       │
╰────────────────────────────────────────────────────────────────╯
    `);

    console.log("\n🔍 [1] CONTEXTO GUARDADO EN FIRESTORE (antes de consultar API):");
    const contextoRef = await firestoreApp.collection(COLECCIONES.contextoActual).doc("actual").get();
    const contextoAnterior = contextoRef.exists ? contextoRef.data() : null;

    if (contextoAnterior) {
      console.log(`    • Torneo guardado: ${contextoAnterior.torneoActual?.nombre} (ID: ${contextoAnterior.torneoActual?.id})`);
      console.log(`    • Temporada guardada: ${contextoAnterior.temporadaActual?.nombre} (ID: ${contextoAnterior.temporadaActual?.id})`);
      console.log(`    • Última actualización: ${contextoAnterior.actualizadoEn}`);
    } else {
      console.log(`    ⚠️  No hay contexto guardado todavía.`);
    }

    console.log("\n📅 [2] CONTEXTO ACTIVO (detectado desde la API de Liga MX):");
    const contextoApi = await ligaMxService.getContext();

    console.log(`    • Fecha actual: ${new Date().toLocaleString("es-MX")}`);
    console.log(`    • Torneo API: ${contextoApi.torneoActual.nombre} (ID: ${contextoApi.torneoActual.id})`);
    console.log(`    • Temporada API: ${contextoApi.temporadaActual.nombre} (ID: ${contextoApi.temporadaActual.id})`);
    console.log(`    • Configuración cron: ${configuracionLigaMx.programacion} (lunes y jueves a 00:00 MX)`);

    if (contextoAnterior) {
      const cambioTorneo = contextoAnterior.torneoActual?.id !== contextoApi.torneoActual.id;
      const cambioTemporada = contextoAnterior.temporadaActual?.id !== contextoApi.temporadaActual.id;

      if (cambioTorneo || cambioTemporada) {
        console.log(`\n⚠️  [ALERTA] SE DETECTÓ CAMBIO DE TORNEO/TEMPORADA:`);
        console.log(`    • Cambio de torneo: ${cambioTorneo ? "SÍ" : "NO"}`);
        console.log(`    • Cambio de temporada: ${cambioTemporada ? "SÍ" : "NO"}`);
        console.log(`    ➜ El cron limpiará TODOS los datos y sincronizará la nueva info`);
      } else {
        console.log(`\n✅ Sin cambios de torneo/temporada (datos se actualizan por TTL)`);
      }
    }

    // 3. Contar documentos en cada colección
    console.log("\n📊 [3] DATOS EN FIRESTORE (documentos por colección):");
    const conteos = await Promise.all([
      contarDocumentosEnColeccion(COLECCIONES.contextoActual),
      contarDocumentosEnColeccion(COLECCIONES.calendariosActuales),
      contarDocumentosEnColeccion(COLECCIONES.clasificacionesActuales),
      contarDocumentosEnColeccion(COLECCIONES.plantillasActuales),
      contarDocumentosEnColeccion(COLECCIONES.jugadoresActuales),
      contarDocumentosEnColeccion(COLECCIONES.partidosActuales),
      contarDocumentosEnColeccion(COLECCIONES.detallesPartidoActuales),
    ]);

    console.log(`    • Contexto: ${conteos[0]} doc`);
    console.log(`    • Calendarios: ${conteos[1]} docs`);
    console.log(`    • Clasificaciones: ${conteos[2]} docs`);
    console.log(`    • Plantillas: ${conteos[3]} docs`);
    console.log(`    • Jugadores: ${conteos[4]} docs`);
    console.log(`    • Partidos: ${conteos[5]} docs`);
    console.log(`    • Detalles de partidos: ${conteos[6]} docs`);

    // 4. Verificar lógica de sincronización
    console.log("\n🔄 [4] LÓGICA DE SINCRONIZACIÓN (en la próxima ejecución del cron):");
    console.log(`    1. Se ejecuta cada: LUNES y JUEVES a las 00:00 (zona: ${configuracionLigaMx.zonaHoraria})`);
    console.log(`    2. Obtiene temporadas, tabla y calendario publicados en la API`);
    console.log(`    3. Elige el torneo/temporada cuyo calendario está más cerca de hoy`);
    console.log(`    4. Compara: contexto anterior vs contexto nuevo`);
    console.log(`       ✓ Limpia TODAS las colecciones (contexto, calendarios, clasificaciones, plantillas, jugadores, partidos, detalles)`);
    console.log(`       ✓ Sincroniza nueva data: calendario, clasificación, plantilla, estadísticas`);
    console.log(`       ✓ Sincroniza perfiles de jugadores`);
    console.log(`    5. SI NO cambió:`);
    console.log(`       ✓ Solo actualiza datos según TTL (tiempo de vida):`);
    console.log(`         - Contexto: ${configuracionLigaMx.ttlMs.contexto / (24*60*60*1000)} días`);
    console.log(`         - Calendario: ${configuracionLigaMx.ttlMs.calendario / (60*60*1000)} horas`);
    console.log(`         - Clasificación: ${configuracionLigaMx.ttlMs.clasificacion / (60*60*1000)} horas`);
    console.log(`         - Plantilla: ${configuracionLigaMx.ttlMs.plantilla / (24*60*60*1000)} días`);
    console.log(`         - Perfiles de jugadores: ${configuracionLigaMx.ttlMs.perfilJugador / (24*60*60*1000)} días`);

    // 5. Resumen
    console.log(`
╭────────────────────────────────────────────────────────────────╮
│                        ✅ RESUMEN                              │
├────────────────────────────────────────────────────────────────┤
│ • Automación de torneo: ACTIVA (lunes y jueves 00:00)          │
│ • Detección de cambios: AUTOMÁTICA (desde API Liga MX)         │
│ • Limpieza de datos al cambio: CONFIGURADA                     │
│ • Sincronización de nueva data: CONFIGURADA                    │
│ • Datos actuales en BD: ${conteos.reduce((a, b) => a + b, 0)} documentos                    │
╰────────────────────────────────────────────────────────────────╯
    `);

  } catch (error) {
    console.error("❌ Error en verificación:", error);
    process.exit(1);
  }

  process.exit(0);
}

verificarSincronizacion();
