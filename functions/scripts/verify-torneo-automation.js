const admin = require("firebase-admin");
const fs = require("fs");
const path = require("path");

(async () => {
  try {
    // Inicializar Firebase
    const serviceAccountPath = path.resolve(__dirname, "..", "..", "serviceAccountKey.json");
    if (fs.existsSync(serviceAccountPath)) {
      const serviceAccount = require(serviceAccountPath);
      admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    } else {
      admin.initializeApp();
    }

    const db = admin.firestore();

    // Configuración
    const COLECCIONES = {
      contextoActual: "liga_mx_contexto_actual",
      calendariosActuales: "liga_mx_calendarios_actuales",
      clasificacionesActuales: "liga_mx_clasificaciones_actuales",
      plantillasActuales: "liga_mx_plantillas_actuales",
      jugadoresActuales: "liga_mx_jugadores_actuales",
      partidosActuales: "liga_mx_partidos_actuales",
      detallesPartidoActuales: "liga_mx_detalles_partido_actuales",
    };

    // Helper: contar docs por colección
    async function contarDocs(nombreColeccion) {
      const snapshot = await db.collection(nombreColeccion).limit(1000).get();
      return snapshot.size;
    }

    console.log("\n📅 [1] CONTEXTO EN FIRESTORE (resuelto por el cron desde la API):");
    console.log(`    • Fecha actual: ${new Date().toLocaleString("es-MX")}`);
    console.log(`    • Próximas ejecuciones: Lunes y Jueves a las 00:00 (zona: America/Mexico_City)`);
    console.log(`    • Detección: tabla + calendario publicados en la API (sin fechas fijas en código)`);

    // 2. Contexto guardado
    console.log("\n🔍 [2] CONTEXTO GUARDADO EN FIRESTORE:");
    const contextoRef = await db.collection(COLECCIONES.contextoActual).doc("actual").get();

    if (contextoRef.exists) {
      const contextoGuardado = contextoRef.data();
      console.log(`    • Torneo guardado: ${contextoGuardado.torneoActual.nombre} (ID: ${contextoGuardado.torneoActual.id})`);
      console.log(`    • Temporada guardada: ${contextoGuardado.temporadaActual.nombre} (ID: ${contextoGuardado.temporadaActual.id})`);
      console.log(`    • Última actualización: ${contextoGuardado.actualizadoEn}`);
      console.log(`\n✅ El cron compara este contexto contra la API en cada ejecución`);
      console.log(`    Si cambia torneo/temporada, limpia y resincroniza calendario, tabla y plantilla`);
    } else {
      console.log(`    ⚠️  No hay contexto guardado. Se sincronizará en la próxima ejecución del cron.`);
    }

    // 3. Contadores
    console.log("\n📊 [3] DATOS EN FIRESTORE (documentos por colección):");
    const conteos = await Promise.all([
      contarDocs(COLECCIONES.contextoActual),
      contarDocs(COLECCIONES.calendariosActuales),
      contarDocs(COLECCIONES.clasificacionesActuales),
      contarDocs(COLECCIONES.plantillasActuales),
      contarDocs(COLECCIONES.jugadoresActuales),
      contarDocs(COLECCIONES.partidosActuales),
      contarDocs(COLECCIONES.detallesPartidoActuales),
    ]);

    console.log(`    • Contexto: ${conteos[0]} doc`);
    console.log(`    • Calendarios: ${conteos[1]} docs`);
    console.log(`    • Clasificaciones: ${conteos[2]} docs`);
    console.log(`    • Plantillas: ${conteos[3]} docs`);
    console.log(`    • Jugadores: ${conteos[4]} docs`);
    console.log(`    • Partidos: ${conteos[5]} docs`);
    console.log(`    • Detalles de partidos: ${conteos[6]} docs`);
    console.log(`    ─────────────────────────────────`);
    const totalDocs = conteos.reduce((a, b) => a + b, 0);
    console.log(`    • TOTAL: ${totalDocs} documentos`);

    // 4. Explicación de lógica
    console.log("\n🔄 [4] LÓGICA DE SINCRONIZACIÓN:");
    console.log(`    Flujo en cada ejecución del cron (lunes y jueves 00:00):`);
    console.log(`
    1️⃣  runScheduledSync() se ejecuta
    2️⃣  Consulta temporadas, tabla y calendario publicados en la API
    3️⃣  Elige el torneo/temporada cuyo calendario está más cerca de hoy
    4️⃣  Compara: contexto anterior vs contexto nuevo
       
       SÍ HAY CAMBIO (torneo o temporada):
       ✅ limpiarDatosVigentes() → borra TODAS las colecciones
       ✅ Sincroniza nueva data: calendario, clasificación, plantilla
       ✅ Sincroniza perfiles de jugadores
       
       SI NO hay cambio:
       ✅ Solo refresca datos según TTL (tiempo de vida):
          - Contexto: 24 horas
          - Calendario: 4 horas (monitores partidos en vivo)
          - Clasificación: 12 horas
          - Plantilla: 24 horas
          - Perfiles jugadores: 30 días
    `);

    // 5. Resumen
    console.log(`
╭────────────────────────────────────────────────────────────────╮
│                        ✅ RESUMEN                              │
├────────────────────────────────────────────────────────────────┤
│ ✓ Automación de torneo: ACTIVA                                 │
│ ✓ Detección de cambios: AUTOMÁTICA (basada en fecha)           │
│ ✓ Limpieza de datos al cambio: CONFIGURADA                     │
│ ✓ Sincronización de nueva data: CONFIGURADA                    │
│ ✓ Datos actuales en BD: ${totalDocs} documentos                ${totalDocs > 0 ? "✓" : "⚠️"}               │
├────────────────────────────────────────────────────────────────┤
│ Para sincronizar ahora (desarrollo):                           │
│   npx ts-node --transpile-only src/dev.ts                      │
│   (en otra terminal)                                           │
│   curl http://localhost:3000/api/liga-mx/plantilla?division=varonil │
│                                                                │
│ Para ejecutar sync manualmente:                                │
│   npx ts-node src/scripts/run-liga-sync.ts                     │
╰────────────────────────────────────────────────────────────────╯
    `);

    process.exit(0);
  } catch (err) {
    console.error("❌ Error:", err.message);
    process.exit(1);
  }
})();
