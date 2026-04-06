import axios from "axios";
import { firestoreApp } from "../../config/app.firebase";
import {
  configuracionLigaMx,
  obtenerPerfilDivision,
  resolverIdTorneoActual,
  validarConfiguracionLigaMx,
} from "../../config/liga-mx.config";
import {
  construirCalendarioActual,
  construirClasificacionActual,
  construirContextoActual,
  construirPlantillaActual,
  esMarcadorOficial,
  esPartidoConcluido,
  normalizarDetallePartido,
  normalizarFilaClasificacion,
  normalizarCuerpoTecnico,
  normalizarJugadorPlantilla,
  normalizarPartidoCalendario,
  normalizarPerfilJugador,
  partidoDentroDeVentanaEnVivo,
} from "./liga-mx.mapper";
import {
  CalendarioLigaMxDoc,
  ClasificacionLigaMxDoc,
  ContextoLigaMxDoc,
  DetallePartidoLigaMxDoc,
  DivisionKey,
  EstadoSincronizacionLigaMxDoc,
  JugadorLigaMxDoc,
  PartidoLigaMxDoc,
  PlantillaLigaMxDoc,
  ResumenEjecucionSincronizacion,
} from "./liga-mx.types";

const COLECCIONES = {
  contextoActual: "liga_mx_contexto_actual",
  calendariosActuales: "liga_mx_calendarios_actuales",
  clasificacionesActuales: "liga_mx_clasificaciones_actuales",
  plantillasActuales: "liga_mx_plantillas_actuales",
  jugadoresActuales: "liga_mx_jugadores_actuales",
  partidosActuales: "liga_mx_partidos_actuales",
  detallesPartidoActuales: "liga_mx_detalles_partido_actuales",
  estadoSincronizacion: "liga_mx_estado_sincronizacion",
} as const;

const COLECCIONES_LEGADO = [
  "lmx_context",
  "lmx_calendars",
  "lmx_standings",
  "lmx_rosters",
  "lmx_players",
  "lmx_matches",
  "lmx_match_details",
  "lmx_sync_state",
] as const;

class LigaMxService {
  private async getJson<T>(path: string, params?: Record<string, unknown>): Promise<T> {
    validarConfiguracionLigaMx();

    const response = await axios.get<T>(`${configuracionLigaMx.urlBase}${path}`, {
      timeout: 30000,
      params,
      headers: {
        accept: "application/json",
        "Content-Type": "application/json",
        "x-api-key": configuracionLigaMx.apiKey,
      },
    });

    return response.data;
  }

  async runScheduledSync(): Promise<ResumenEjecucionSincronizacion> {
    await this.limpiarColeccionesLegado();
    const { contexto, cambioContexto } = await this.sincronizarContextoActual(false);

    if (cambioContexto) {
      await this.limpiarDatosVigentes();
      await firestoreApp.collection(COLECCIONES.contextoActual).doc("actual").set(contexto);
    }

    for (const divisionKey of ["varonil", "femenil"] as DivisionKey[]) {
      const calendarioExistente = await this.obtenerCalendarioActual(divisionKey);
      const clasificacionExistente = await this.obtenerClasificacionActual(divisionKey);
      const plantillaExistente = await this.obtenerPlantillaActual(divisionKey);
      const requiereCargaInicial =
        !calendarioExistente || !clasificacionExistente || !plantillaExistente;
      const partidoPendienteDeCierre = this.obtenerPartidoPendienteDeCierre(
        calendarioExistente?.partidos ?? [],
      );
      const debeMonitorearCierre =
        cambioContexto ||
        requiereCargaInicial ||
        (await this.debeConsultarResultadosDivision(
          divisionKey,
          partidoPendienteDeCierre,
        ));

      if (!debeMonitorearCierre) {
        continue;
      }

      const calendario = await this.sincronizarCalendarioActual(divisionKey, contexto, true);

      if (cambioContexto || requiereCargaInicial) {
        await this.sincronizarClasificacionActual(divisionKey, contexto, true);
        await this.sincronizarPlantillaActual(divisionKey, contexto, true);
        await this.sincronizarPerfilesPendientes(divisionKey, contexto);
        continue;
      }

      const partidosRecienFinalizados = this.obtenerPartidosRecienFinalizados(
        calendarioExistente.partidos,
        calendario.partidos,
      );

      if (!partidosRecienFinalizados.length) {
        continue;
      }

      await this.sincronizarClasificacionActual(divisionKey, contexto, true);

      for (const partido of partidosRecienFinalizados) {
        await this.sincronizarDetallePartido(partido, true);
      }
    }

    return {
      temporadaActual: contexto.temporadaActual.nombre,
      torneoActual: contexto.torneoActual.nombre,
      divisionesProcesadas: ["varonil", "femenil"],
    };
  }

  async getContext(): Promise<ContextoLigaMxDoc> {
    const existente = await this.obtenerContextoActual();
    const idTorneoActual = resolverIdTorneoActual();

    if (existente && existente.torneoActual.id === idTorneoActual) {
      return existente;
    }

    return (await this.sincronizarContextoActual(true)).contexto;
  }

  async getCalendar(divisionKey: DivisionKey): Promise<CalendarioLigaMxDoc> {
    const contexto = await this.getContext();
    let existente = await this.obtenerCalendarioActual(divisionKey);

    if (existente) {
      const partidoPendienteDeCierre = this.obtenerPartidoPendienteDeCierre(
        existente.partidos,
      );

      if (
        await this.debeConsultarResultadosDivision(
          divisionKey,
          partidoPendienteDeCierre,
        )
      ) {
        existente = await this.sincronizarCalendarioActual(
          divisionKey,
          contexto,
          true,
          configuracionLigaMx.ttlMs.seguimientoResultado,
        );
      }
    }

    if (
      existente &&
      existente.temporadaActual.id === contexto.temporadaActual.id &&
      existente.torneoActual.id === contexto.torneoActual.id
    ) {
      return existente;
    }

    return this.sincronizarCalendarioActual(divisionKey, contexto, true);
  }

  async getStandings(divisionKey: DivisionKey): Promise<ClasificacionLigaMxDoc> {
    const contexto = await this.getContext();
    const existente = await this.obtenerClasificacionActual(divisionKey);

    if (
      existente &&
      existente.temporadaActual.id === contexto.temporadaActual.id &&
      existente.torneoActual.id === contexto.torneoActual.id
    ) {
      return existente;
    }

    return this.sincronizarClasificacionActual(divisionKey, contexto, true);
  }

  async getRoster(divisionKey: DivisionKey): Promise<PlantillaLigaMxDoc> {
    const contexto = await this.getContext();
    const existente = await this.obtenerPlantillaActual(divisionKey);

    if (
      existente &&
      existente.temporadaActual.id === contexto.temporadaActual.id &&
      existente.torneoActual.id === contexto.torneoActual.id
    ) {
      return existente;
    }

    return this.sincronizarPlantillaActual(divisionKey, contexto, true);
  }

  async getPlayer(id: string): Promise<JugadorLigaMxDoc | null> {
    let jugador = await this.obtenerJugadorActual(id);

    if (!jugador) {
      await Promise.all([this.getRoster("varonil"), this.getRoster("femenil")]);
      jugador = await this.obtenerJugadorActual(id);
    }

    if (!jugador) {
      return null;
    }

    const debeRefrescarPerfil =
      !jugador.actualizadoPerfilEn ||
      Date.now() - new Date(jugador.actualizadoPerfilEn).getTime() >=
        configuracionLigaMx.ttlMs.perfilJugador;

    if (!debeRefrescarPerfil) {
      return jugador;
    }

    return this.sincronizarPerfilJugador(jugador, true);
  }

  async getMatch(id: string): Promise<PartidoLigaMxDoc | null> {
    let partido = await this.obtenerPartidoActual(id);

    if (partido && !(await this.esMarcadorPendienteDeCierre(partido))) {
      return partido;
    }

    if (partido && (await this.esMarcadorPendienteDeCierre(partido))) {
      const contexto = await this.getContext();

      if (
        await this.debeConsultarResultadosDivision(partido.claveDivision, partido)
      ) {
        await this.sincronizarCalendarioActual(
          partido.claveDivision,
          contexto,
          true,
          configuracionLigaMx.ttlMs.seguimientoResultado,
        );
        partido = await this.obtenerPartidoActual(id);
      }
    }

    if (!partido) {
      await Promise.all([this.getCalendar("varonil"), this.getCalendar("femenil")]);
      partido = await this.obtenerPartidoActual(id);
    }

    return partido;
  }

  async getMatchDetail(id: string): Promise<DetallePartidoLigaMxDoc | null> {
    const partido = await this.getMatch(id);

    if (!partido) {
      return null;
    }

    return this.sincronizarDetallePartido(partido, true);
  }

  private async sincronizarContextoActual(force: boolean): Promise<{
    contexto: ContextoLigaMxDoc;
    cambioContexto: boolean;
  }> {
    const ref = firestoreApp.collection(COLECCIONES.contextoActual).doc("actual");
    const claveEstado = "contexto-actual";
    const existente = await this.obtenerContextoActual();

    if (
      !force &&
      existente &&
      !(await this.debeSincronizar(claveEstado, configuracionLigaMx.ttlMs.contexto))
    ) {
      return { contexto: existente, cambioContexto: false };
    }

    try {
      await this.marcarIntento(claveEstado);
      const temporadas = await this.getJson<Array<{ idTemporada: number; nombre: string }>>(
        "/v2/temporadas",
      );
      const contexto = construirContextoActual(
        temporadas,
        resolverIdTorneoActual(),
        new Date().toISOString(),
      );
      const cambioContexto =
        !existente ||
        existente.temporadaActual.id !== contexto.temporadaActual.id ||
        existente.torneoActual.id !== contexto.torneoActual.id;

      await ref.set(contexto);
      await this.marcarExito(claveEstado, configuracionLigaMx.ttlMs.contexto);
      return { contexto, cambioContexto };
    } catch (error) {
      await this.marcarError(claveEstado, error);
      throw error;
    }
  }

  private async sincronizarCalendarioActual(
    divisionKey: DivisionKey,
    contexto: ContextoLigaMxDoc,
    force: boolean,
    ttlOverrideMs?: number,
  ): Promise<CalendarioLigaMxDoc> {
    const claveEstado = `calendario-actual-${divisionKey}`;
    const ref = firestoreApp.collection(COLECCIONES.calendariosActuales).doc(divisionKey);
    const existente = await this.obtenerCalendarioActual(divisionKey);

    if (
      !force &&
      existente &&
      !(await this.debeSincronizar(claveEstado, configuracionLigaMx.ttlMs.calendario))
    ) {
      return existente;
    }

    try {
      await this.marcarIntento(claveEstado);
      const perfilDivision = obtenerPerfilDivision(divisionKey);
      const partidosRaw = await this.getJson<Array<Record<string, unknown>>>(
        "/v2/club/partidosClub",
        {
          idTemporada: contexto.temporadaActual.id,
          idTorneo: contexto.torneoActual.id,
          idDivision: perfilDivision.idDivision,
          idClub: perfilDivision.idClub,
        },
      );
      const sincronizadoEn = new Date().toISOString();
      const partidos = partidosRaw
        .map((item) => normalizarPartidoCalendario(item, divisionKey, sincronizadoEn))
        .sort((left, right) => {
          const leftDate = left.fechaHoraPartido ? new Date(left.fechaHoraPartido).getTime() : 0;
          const rightDate = right.fechaHoraPartido ? new Date(right.fechaHoraPartido).getTime() : 0;
          return leftDate - rightDate;
        });
      const payload = construirCalendarioActual(
        divisionKey,
        contexto.temporadaActual,
        contexto.torneoActual,
        partidos,
        sincronizadoEn,
      );

      await ref.set(payload);
      await this.sincronizarPartidosActuales(divisionKey, payload.partidos);
      await this.marcarExito(
        claveEstado,
        ttlOverrideMs ?? configuracionLigaMx.ttlMs.calendario,
      );
      return payload;
    } catch (error) {
      await this.marcarError(claveEstado, error);
      throw error;
    }
  }

  private async sincronizarClasificacionActual(
    divisionKey: DivisionKey,
    contexto: ContextoLigaMxDoc,
    force: boolean,
  ): Promise<ClasificacionLigaMxDoc> {
    const claveEstado = `clasificacion-actual-${divisionKey}`;
    const ref = firestoreApp.collection(COLECCIONES.clasificacionesActuales).doc(divisionKey);
    const existente = await this.obtenerClasificacionActual(divisionKey);

    if (
      !force &&
      existente &&
      !(await this.debeSincronizar(claveEstado, configuracionLigaMx.ttlMs.clasificacion))
    ) {
      return existente;
    }

    try {
      await this.marcarIntento(claveEstado);
      const perfilDivision = obtenerPerfilDivision(divisionKey);
      const posicionesRaw = await this.getJson<Array<Record<string, unknown>>>(
        "/v2/tablaGeneral",
        {
          idTemporada: contexto.temporadaActual.id,
          idTorneo: contexto.torneoActual.id,
          idDivision: perfilDivision.idDivision,
        },
      );
      const payload = construirClasificacionActual(
        divisionKey,
        contexto.temporadaActual,
        contexto.torneoActual,
        posicionesRaw.map((item) => normalizarFilaClasificacion(item)),
        new Date().toISOString(),
      );

      await ref.set(payload);
      await this.marcarExito(claveEstado, configuracionLigaMx.ttlMs.clasificacion);
      return payload;
    } catch (error) {
      await this.marcarError(claveEstado, error);
      throw error;
    }
  }

  private async sincronizarPlantillaActual(
    divisionKey: DivisionKey,
    contexto: ContextoLigaMxDoc,
    force: boolean,
  ): Promise<PlantillaLigaMxDoc> {
    const claveEstado = `plantilla-actual-${divisionKey}`;
    const ref = firestoreApp.collection(COLECCIONES.plantillasActuales).doc(divisionKey);
    const existente = await this.obtenerPlantillaActual(divisionKey);

    if (
      !force &&
      existente &&
      !(await this.debeSincronizar(claveEstado, configuracionLigaMx.ttlMs.plantilla))
    ) {
      return existente;
    }

    try {
      await this.marcarIntento(claveEstado);
      const perfilDivision = obtenerPerfilDivision(divisionKey);
      const plantillaRaw = await this.getJson<{
        jugadores: Array<Record<string, unknown>>;
        cuerpoTecnico: Array<Record<string, unknown>>;
      }>(`/v2/${contexto.torneoActual.id}/plantel/${perfilDivision.idClub}`);
      const sincronizadoEn = new Date().toISOString();
      const payload = construirPlantillaActual(
        divisionKey,
        contexto.temporadaActual,
        contexto.torneoActual,
        Array.isArray(plantillaRaw.jugadores)
          ? plantillaRaw.jugadores.map((item) => normalizarJugadorPlantilla(item))
          : [],
        Array.isArray(plantillaRaw.cuerpoTecnico)
          ? plantillaRaw.cuerpoTecnico.map((item) => normalizarCuerpoTecnico(item))
          : [],
        sincronizadoEn,
      );

      await ref.set(payload);
      await this.sincronizarJugadoresActuales(divisionKey, payload, sincronizadoEn);
      await this.marcarExito(claveEstado, configuracionLigaMx.ttlMs.plantilla);
      return payload;
    } catch (error) {
      await this.marcarError(claveEstado, error);
      throw error;
    }
  }

  private async sincronizarDetallePartido(
    partido: PartidoLigaMxDoc,
    force: boolean,
  ): Promise<DetallePartidoLigaMxDoc> {
    const claveEstado = `detalle-partido-${partido.id}`;
    const ttlMs = this.obtenerTtlDetallePartido(partido);
    const ref = firestoreApp.collection(COLECCIONES.detallesPartidoActuales).doc(partido.id);
    const existente = await this.obtenerDetallePartidoActual(partido.id);

    if (!force && existente && !(await this.debeSincronizar(claveEstado, ttlMs))) {
      return existente;
    }

    try {
      await this.marcarIntento(claveEstado);
      const [alineacionesRaw, narracionRaw] = await Promise.all([
        this.getJson<Record<string, unknown>>(`/v2/alineaciones/${partido.id}`),
        this.getJson<Record<string, unknown>>(`/v2/minutoaminuto/${partido.id}/narracion`),
      ]);
      const payload = normalizarDetallePartido(
        partido,
        alineacionesRaw,
        narracionRaw,
        new Date().toISOString(),
      );

      await ref.set(payload);
      await this.marcarExito(claveEstado, ttlMs);
      return payload;
    } catch (error) {
      await this.marcarError(claveEstado, error);
      throw error;
    }
  }

  private async sincronizarPerfilJugador(
    jugadorBase: JugadorLigaMxDoc,
    force: boolean,
  ): Promise<JugadorLigaMxDoc> {
    const claveEstado = `perfil-jugador-${jugadorBase.id}`;

    if (!force && !(await this.debeSincronizar(claveEstado, configuracionLigaMx.ttlMs.perfilJugador))) {
      return jugadorBase;
    }

    try {
      await this.marcarIntento(claveEstado);
      const response = await this.getJson<Array<Record<string, unknown>>>(
        "/v2/afiliado/datosAfiliado",
        { idAfiliado: jugadorBase.id },
      );
      const perfilRaw = Array.isArray(response) ? response[0] : null;

      if (!perfilRaw) {
        await this.marcarExito(claveEstado, configuracionLigaMx.ttlMs.perfilJugador);
        return jugadorBase;
      }

      const payload = normalizarPerfilJugador(perfilRaw, jugadorBase);
      const finalPayload: JugadorLigaMxDoc = {
        ...payload,
        actualizadoPerfilEn: new Date().toISOString(),
      };

      await firestoreApp.collection(COLECCIONES.jugadoresActuales).doc(jugadorBase.id).set(finalPayload);
      await this.marcarExito(claveEstado, configuracionLigaMx.ttlMs.perfilJugador);
      return finalPayload;
    } catch (error) {
      await this.marcarError(claveEstado, error);
      throw error;
    }
  }

  private async sincronizarPerfilesPendientes(
    divisionKey: DivisionKey,
    contexto: ContextoLigaMxDoc,
  ): Promise<void> {
    const plantilla = await this.getRoster(divisionKey);
    let procesados = 0;

    for (const jugador of plantilla.jugadores) {
      if (procesados >= configuracionLigaMx.presupuestoSincronizacion.perfilesJugadorPorCorrida) {
        break;
      }

      const jugadorActual = await this.obtenerJugadorActual(jugador.id);

      if (!jugadorActual) {
        continue;
      }

      const debeRefrescar =
        !jugadorActual.actualizadoPerfilEn ||
        jugadorActual.temporadaActual.id !== contexto.temporadaActual.id ||
        jugadorActual.torneoActual.id !== contexto.torneoActual.id ||
        Date.now() - new Date(jugadorActual.actualizadoPerfilEn).getTime() >= configuracionLigaMx.ttlMs.perfilJugador;

      if (!debeRefrescar) {
        continue;
      }

      await this.sincronizarPerfilJugador(jugadorActual, false);
      procesados += 1;
    }
  }

  private async sincronizarPartidosActuales(
    divisionKey: DivisionKey,
    partidosActuales: PartidoLigaMxDoc[],
  ): Promise<void> {
    const batch = firestoreApp.batch();
    const snapshotExistente = await firestoreApp
      .collection(COLECCIONES.partidosActuales)
      .where("claveDivision", "==", divisionKey)
      .get();
    const existentes = new Map(snapshotExistente.docs.map((doc) => [doc.id, doc.data() as PartidoLigaMxDoc]));
    const idsNuevos = new Set(partidosActuales.map((partido) => partido.id));

    partidosActuales.forEach((partido) => {
      const existente = existentes.get(partido.id);
      if (!existente || existente.hashFuente !== partido.hashFuente) {
        batch.set(firestoreApp.collection(COLECCIONES.partidosActuales).doc(partido.id), partido);
      }
    });

    snapshotExistente.docs.forEach((doc) => {
      if (!idsNuevos.has(doc.id)) {
        batch.delete(doc.ref);
        batch.delete(firestoreApp.collection(COLECCIONES.detallesPartidoActuales).doc(doc.id));
      }
    });

    await batch.commit();
  }

  private async sincronizarJugadoresActuales(
    divisionKey: DivisionKey,
    plantilla: PlantillaLigaMxDoc,
    sincronizadoEn: string,
  ): Promise<void> {
    const batch = firestoreApp.batch();
    const snapshotExistente = await firestoreApp
      .collection(COLECCIONES.jugadoresActuales)
      .where("claveDivision", "==", divisionKey)
      .get();
    const existentes = new Map(snapshotExistente.docs.map((doc) => [doc.id, doc.data() as JugadorLigaMxDoc]));
    const idsNuevos = new Set(plantilla.jugadores.map((jugador) => jugador.id));

    plantilla.jugadores.forEach((jugador) => {
      const existente = existentes.get(jugador.id);
      const payload: JugadorLigaMxDoc = {
        ...(existente || {
          perfil: null,
          hashPerfil: null,
          actualizadoPerfilEn: null,
        }),
        ...jugador,
        claveDivision: plantilla.division.clave,
        temporadaActual: plantilla.temporadaActual,
        torneoActual: plantilla.torneoActual,
        nombreClub: plantilla.division.nombreClub,
        activoEnPlantilla: true,
        hashPlantilla: jugador.hashFuente,
        actualizadoPlantillaEn: sincronizadoEn,
      };

      if (
        !existente ||
        existente.hashPlantilla !== jugador.hashFuente ||
        !existente.activoEnPlantilla ||
        existente.temporadaActual.id !== plantilla.temporadaActual.id ||
        existente.torneoActual.id !== plantilla.torneoActual.id
      ) {
        batch.set(firestoreApp.collection(COLECCIONES.jugadoresActuales).doc(jugador.id), payload);
      }
    });

    snapshotExistente.docs.forEach((doc) => {
      if (!idsNuevos.has(doc.id)) {
        batch.delete(doc.ref);
      }
    });

    await batch.commit();
  }

  private async limpiarDatosVigentes(): Promise<void> {
    for (const collectionName of Object.values(COLECCIONES)) {
      await this.vaciarColeccion(collectionName);
    }
  }

  private async limpiarColeccionesLegado(): Promise<void> {
    for (const collectionName of COLECCIONES_LEGADO) {
      await this.vaciarColeccion(collectionName);
    }
  }

  private async vaciarColeccion(collectionName: string): Promise<void> {
    const snapshot = await firestoreApp.collection(collectionName).get();

    if (snapshot.empty) {
      return;
    }

    const batch = firestoreApp.batch();
    snapshot.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
  }

  private async obtenerContextoActual(): Promise<ContextoLigaMxDoc | null> {
    const snapshot = await firestoreApp.collection(COLECCIONES.contextoActual).doc("actual").get();
    return snapshot.exists ? (snapshot.data() as ContextoLigaMxDoc) : null;
  }

  private async obtenerCalendarioActual(divisionKey: DivisionKey): Promise<CalendarioLigaMxDoc | null> {
    const snapshot = await firestoreApp.collection(COLECCIONES.calendariosActuales).doc(divisionKey).get();
    return snapshot.exists ? (snapshot.data() as CalendarioLigaMxDoc) : null;
  }

  private async obtenerClasificacionActual(divisionKey: DivisionKey): Promise<ClasificacionLigaMxDoc | null> {
    const snapshot = await firestoreApp.collection(COLECCIONES.clasificacionesActuales).doc(divisionKey).get();
    return snapshot.exists ? (snapshot.data() as ClasificacionLigaMxDoc) : null;
  }

  private async obtenerPlantillaActual(divisionKey: DivisionKey): Promise<PlantillaLigaMxDoc | null> {
    const snapshot = await firestoreApp.collection(COLECCIONES.plantillasActuales).doc(divisionKey).get();
    return snapshot.exists ? (snapshot.data() as PlantillaLigaMxDoc) : null;
  }

  private async obtenerJugadorActual(id: string): Promise<JugadorLigaMxDoc | null> {
    const snapshot = await firestoreApp.collection(COLECCIONES.jugadoresActuales).doc(id).get();
    return snapshot.exists ? (snapshot.data() as JugadorLigaMxDoc) : null;
  }

  private async obtenerPartidoActual(id: string): Promise<PartidoLigaMxDoc | null> {
    const snapshot = await firestoreApp.collection(COLECCIONES.partidosActuales).doc(id).get();
    return snapshot.exists ? (snapshot.data() as PartidoLigaMxDoc) : null;
  }

  private async obtenerDetallePartidoActual(id: string): Promise<DetallePartidoLigaMxDoc | null> {
    const snapshot = await firestoreApp.collection(COLECCIONES.detallesPartidoActuales).doc(id).get();
    return snapshot.exists ? (snapshot.data() as DetallePartidoLigaMxDoc) : null;
  }

  private async obtenerEstadoSincronizacion(clave: string): Promise<EstadoSincronizacionLigaMxDoc | null> {
    const snapshot = await firestoreApp.collection(COLECCIONES.estadoSincronizacion).doc(clave).get();
    return snapshot.exists ? (snapshot.data() as EstadoSincronizacionLigaMxDoc) : null;
  }

  private async debeSincronizar(clave: string, ttlMs: number): Promise<boolean> {
    const estado = await this.obtenerEstadoSincronizacion(clave);

    if (!estado) {
      return true;
    }

    return Date.now() >= estado.proximaEjecucionPermitidaMs;
  }

  private async debeConsultarResultadosDivision(
    divisionKey: DivisionKey,
    partidoPendienteDeCierre: PartidoLigaMxDoc | null,
  ): Promise<boolean> {
    if (!partidoPendienteDeCierre) {
      return false;
    }

    return this.debeSincronizar(
      `seguimiento-resultado-${divisionKey}-${partidoPendienteDeCierre.id}`,
      configuracionLigaMx.ttlMs.seguimientoResultado,
    );
  }

  private async esMarcadorPendienteDeCierre(
    partido: PartidoLigaMxDoc,
    ahoraMs = Date.now(),
  ): Promise<boolean> {
    if (!partido.fechaHoraPartido || esMarcadorOficial(partido.estado)) {
      return false;
    }

    const fechaPartidoMs = new Date(partido.fechaHoraPartido).getTime();

    if (Number.isNaN(fechaPartidoMs)) {
      return false;
    }

    if (esPartidoConcluido(partido.estado)) {
      return true;
    }

    return (
      ahoraMs >=
      fechaPartidoMs + configuracionLigaMx.ventanaSeguimientoResultadoInicioMs
    );
  }

  private obtenerPartidoPendienteDeCierre(
    partidos: PartidoLigaMxDoc[],
    ahoraMs = Date.now(),
  ): PartidoLigaMxDoc | null {
    const candidatos = partidos.filter((partido) => {
      if (!partido.fechaHoraPartido || esMarcadorOficial(partido.estado)) {
        return false;
      }

      const fechaPartidoMs = new Date(partido.fechaHoraPartido).getTime();

      if (Number.isNaN(fechaPartidoMs)) {
        return false;
      }

      return (
        ahoraMs >=
        fechaPartidoMs + configuracionLigaMx.ventanaSeguimientoResultadoInicioMs
      );
    });

    if (!candidatos.length) {
      return null;
    }

    return candidatos.sort((left, right) => {
      const leftMs = new Date(left.fechaHoraPartido || 0).getTime();
      const rightMs = new Date(right.fechaHoraPartido || 0).getTime();
      return leftMs - rightMs;
    })[0];
  }

  private obtenerPartidosRecienFinalizados(
    partidosAnteriores: PartidoLigaMxDoc[],
    partidosActuales: PartidoLigaMxDoc[],
  ): PartidoLigaMxDoc[] {
    const anterioresPorId = new Map(
      partidosAnteriores.map((partido) => [partido.id, partido]),
    );

    return partidosActuales.filter((partidoActual) => {
      if (!esMarcadorOficial(partidoActual.estado)) {
        return false;
      }

      const partidoAnterior = anterioresPorId.get(partidoActual.id);

      if (!partidoAnterior) {
        return true;
      }

      return !esMarcadorOficial(partidoAnterior.estado);
    });
  }

  private async marcarIntento(clave: string): Promise<void> {
    await firestoreApp.collection(COLECCIONES.estadoSincronizacion).doc(clave).set(
      {
        clave,
        ultimoIntentoMs: Date.now(),
      },
      { merge: true },
    );
  }

  private async marcarExito(clave: string, ttlMs: number): Promise<void> {
    const ahora = Date.now();
    await firestoreApp.collection(COLECCIONES.estadoSincronizacion).doc(clave).set(
      {
        clave,
        ultimoIntentoMs: ahora,
        ultimaEjecucionExitosaMs: ahora,
        proximaEjecucionPermitidaMs: ahora + ttlMs,
        ultimoError: null,
      },
      { merge: true },
    );
  }

  private async marcarError(clave: string, error: unknown): Promise<void> {
    const mensaje = error instanceof Error ? error.message : "Error desconocido";
    await firestoreApp.collection(COLECCIONES.estadoSincronizacion).doc(clave).set(
      {
        clave,
        ultimoIntentoMs: Date.now(),
        ultimoError: mensaje,
      },
      { merge: true },
    );
  }

  private obtenerTtlDetallePartido(partido: PartidoLigaMxDoc): number {
    if (
      partidoDentroDeVentanaEnVivo(
        partido.fechaHoraPartido,
        configuracionLigaMx.ventanaEnVivoAntesMs,
        configuracionLigaMx.ventanaEnVivoDespuesMs,
      )
    ) {
      return configuracionLigaMx.ttlMs.detalleEnVivo;
    }

    const fechaPartidoMs = partido.fechaHoraPartido ? new Date(partido.fechaHoraPartido).getTime() : Number.NaN;

    if (!Number.isNaN(fechaPartidoMs) && fechaPartidoMs > Date.now()) {
      return configuracionLigaMx.ttlMs.detalleProgramado;
    }

    if (!esMarcadorOficial(partido.estado)) {
      return configuracionLigaMx.ttlMs.seguimientoResultado;
    }

    return configuracionLigaMx.ttlMs.detalleFinalizado;
  }
}

export default new LigaMxService();