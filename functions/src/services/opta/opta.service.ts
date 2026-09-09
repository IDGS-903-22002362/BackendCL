import axios from "axios";
import { firestoreApp } from "../../config/app.firebase";
import {
  configuracionOpta,
  tieneCredencialesOpta,
  validarConfiguracionOpta,
} from "../../config/opta.config";
import { seleccionarCalendarioActivo } from "./opta.context.resolver";
import {
  estaEnVentanaDeSeguimientoStats,
  partidoDentroDeVentanaDeSilencio,
  puedePublicarseStats,
} from "./opta.datetime";
import {
  aplanarCalendariosOpta,
  esClubLeon,
  extraerListaDeFeed,
  nombresClubCoinciden,
  normalizarFixture,
  normalizarMatchStats,
} from "./opta.mapper";
import {
  ContextoOptaDoc,
  DivisionKey,
  EstadoSincronizacionOptaDoc,
  FixtureOpta,
  ResumenEjecucionOpta,
  StatsPartidoOptaDoc,
} from "./opta.types";

const COLECCIONES = {
  contextoActual: "opta_contexto_actual",
  fixturesActuales: "opta_fixtures_actuales",
  statsActuales: "opta_match_stats_actuales",
  estadoSincronizacion: "opta_estado_sincronizacion",
  calendariosLigaMx: "liga_mx_calendarios_actuales",
} as const;

interface PartidoLigaMxResumen {
  idPartido: number;
  fechaHoraPartido: string | null;
  nombreLocal: string;
  nombreVisita: string;
}

class OptaService {
  private token: { valor: string; expiraEnMs: number } | null = null;

  private async obtenerToken(): Promise<string> {
    if (this.token && Date.now() < this.token.expiraEnMs) {
      return this.token.valor;
    }

    validarConfiguracionOpta();

    const response = await axios.post<{
      access_token?: string;
      expires_in?: number;
    }>(
      configuracionOpta.urlToken,
      new URLSearchParams({
        grant_type: "client_credentials",
        client_id: configuracionOpta.clientId as string,
        client_secret: configuracionOpta.clientSecret as string,
      }),
      {
        timeout: 15000,
        params: { apikey: configuracionOpta.apiKey },
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          accept: "application/json",
        },
      },
    );

    const accessToken = response.data.access_token;

    if (!accessToken) {
      throw new Error("Stats Perform no devolvió access_token");
    }

    const expiresIn = Number(response.data.expires_in) || 1800;
    this.token = {
      valor: accessToken,
      expiraEnMs: Date.now() + Math.max(60, expiresIn - 60) * 1000,
    };

    return accessToken;
  }

  private async getJson<T>(
    path: string,
    params?: Record<string, unknown>,
    reintentoAuth = true,
  ): Promise<T> {
    validarConfiguracionOpta();
    const token = await this.obtenerToken();

    try {
      const response = await axios.get<T>(`${configuracionOpta.urlBase}${path}`, {
        timeout: 30000,
        params: {
          _fmt: "json",
          ...params,
        },
        headers: {
          accept: "application/json",
          Authorization: `Bearer ${token}`,
        },
      });

      return response.data;
    } catch (error) {
      if (reintentoAuth && axios.isAxiosError(error) && error.response?.status === 401) {
        this.token = null;
        return this.getJson<T>(path, params, false);
      }

      throw error;
    }
  }

  private pathDeFeed(recurso: string, extra = ""): string {
    return `/soccerdata/${recurso}${extra}`;
  }

  async runScheduledSync(): Promise<ResumenEjecucionOpta> {
    if (!tieneCredencialesOpta()) {
      return {
        temporadaActual: "",
        torneoActual: "",
        statsSincronizadas: 0,
        omitido: true,
        motivoOmision:
          "Faltan OPTA_API_KEY, OPTA_CLIENT_ID y OPTA_CLIENT_SECRET del PDF de activación.",
      };
    }

    const { contexto, cambioContexto } = await this.sincronizarContextoActual(false);
    let statsSincronizadas = 0;

    for (const division of contexto.divisiones) {
      const fixtures = await this.sincronizarFixturesDivision(
        division.clave,
        contexto,
        cambioContexto,
      );

      for (const fixture of fixtures) {
        await this.rematerializarStatsHaciaLigaMx(fixture);
      }

      for (const fixture of fixtures) {
        if (statsSincronizadas >= configuracionOpta.presupuestoSincronizacion.statsPorCorrida) {
          break;
        }

        const sincronizado = await this.sincronizarStatsSiCorresponde(fixture, contexto);

        if (sincronizado) {
          statsSincronizadas += 1;
        }
      }
    }

    return {
      temporadaActual: contexto.temporadaActual.nombre,
      torneoActual: contexto.torneoActual.nombre,
      statsSincronizadas,
      omitido: false,
      motivoOmision: null,
    };
  }

  private async sincronizarContextoActual(force: boolean): Promise<{
    contexto: ContextoOptaDoc;
    cambioContexto: boolean;
  }> {
    const claveEstado = "opta-contexto-actual";
    const existente = await this.obtenerContextoActual();

    if (
      !force &&
      existente &&
      !(await this.debeSincronizar(claveEstado, configuracionOpta.ttlMs.contexto))
    ) {
      return { contexto: existente, cambioContexto: false };
    }

    await this.marcarIntento(claveEstado);
    const calendariosRaw = await this.getJson<unknown>(
      this.pathDeFeed("tournamentcalendar", "/active/authorized"),
    );
    const calendarios = aplanarCalendariosOpta(calendariosRaw);
    const varonil = seleccionarCalendarioActivo(calendarios, "varonil");
    const femenil = seleccionarCalendarioActivo(calendarios, "femenil");
    const primario = varonil || femenil;

    if (!primario) {
      await this.marcarError(
        claveEstado,
        new Error("No se encontró un calendario activo de Liga MX en Opta"),
      );

      if (existente) {
        return { contexto: existente, cambioContexto: false };
      }

      throw new Error("No se encontró un calendario activo de Liga MX en Opta");
    }

    const divisiones: ContextoOptaDoc["divisiones"] = [];

    for (const candidato of [
      { clave: "varonil" as const, calendario: varonil },
      { clave: "femenil" as const, calendario: femenil },
    ]) {
      if (!candidato.calendario) {
        continue;
      }

      const fixtures = await this.obtenerFixturesDeCalendario(
        candidato.clave,
        candidato.calendario.id,
      );
      const club = this.detectarClubLeon(fixtures);

      divisiones.push({
        clave: candidato.clave,
        calendario: candidato.calendario,
        club,
      });
    }

    const contexto: ContextoOptaDoc = {
      temporadaActual: { id: primario.id, nombre: primario.nombre },
      torneoActual: {
        id: primario.id,
        nombre: primario.nombreCompetencia || primario.nombre,
      },
      divisiones,
      hashFuente: primario.id,
      actualizadoEn: new Date().toISOString(),
    };
    const cambioContexto =
      !existente ||
      existente.temporadaActual.id !== contexto.temporadaActual.id ||
      existente.torneoActual.id !== contexto.torneoActual.id;

    await firestoreApp.collection(COLECCIONES.contextoActual).doc("actual").set(contexto);
    await this.marcarExito(claveEstado, configuracionOpta.ttlMs.contexto);
    return { contexto, cambioContexto };
  }

  private detectarClubLeon(fixtures: FixtureOpta[]): ContextoOptaDoc["divisiones"][number]["club"] {
    for (const fixture of fixtures) {
      if (esClubLeon(fixture.local.nombre)) {
        return fixture.local;
      }

      if (esClubLeon(fixture.visita.nombre)) {
        return fixture.visita;
      }
    }

    return null;
  }

  private async obtenerFixturesDeCalendario(
    claveDivision: DivisionKey,
    tournamentCalendarId: string,
    contestantId?: string,
  ): Promise<FixtureOpta[]> {
    const raw = await this.getJson<unknown>(this.pathDeFeed("match"), {
      tmcl: tournamentCalendarId,
      _pgSz: 1000,
      ...(contestantId ? { ctst: contestantId } : {}),
    });
    const partidos = extraerListaDeFeed(raw, ["match", "fixture", "fixtures"]);

    return partidos
      .map((item) => normalizarFixture(item, claveDivision))
      .filter((item): item is FixtureOpta => item !== null)
      .filter(
        (item) => esClubLeon(item.local.nombre) || esClubLeon(item.visita.nombre),
      );
  }

  private async sincronizarFixturesDivision(
    claveDivision: DivisionKey,
    contexto: ContextoOptaDoc,
    cambioContexto: boolean,
  ): Promise<FixtureOpta[]> {
    const division = contexto.divisiones.find((item) => item.clave === claveDivision);

    if (!division) {
      return [];
    }

    const claveEstado = `opta-fixtures-${claveDivision}`;
    const cached = await this.obtenerFixturesActuales(claveDivision);
    const haySeguimiento = (cached || []).some((fixture) =>
      estaEnVentanaDeSeguimientoStats(fixture.fechaHoraPartido),
    );

    if (
      !cambioContexto &&
      cached &&
      !haySeguimiento &&
      !(await this.debeSincronizar(claveEstado, configuracionOpta.ttlMs.fixtures))
    ) {
      return cached;
    }

    if (
      !cambioContexto &&
      cached &&
      haySeguimiento &&
      !(await this.debeSincronizar(
        claveEstado,
        configuracionOpta.ttlMs.seguimientoResultado,
      ))
    ) {
      return cached;
    }

    await this.marcarIntento(claveEstado);
    const fixtures = await this.obtenerFixturesDeCalendario(
      claveDivision,
      division.calendario.id,
      division.club?.id,
    );
    await firestoreApp.collection(COLECCIONES.fixturesActuales).doc(claveDivision).set({
      claveDivision,
      fixtures,
      sincronizadoEn: new Date().toISOString(),
    });
    const ttl = fixtures.some((fixture) =>
      estaEnVentanaDeSeguimientoStats(fixture.fechaHoraPartido),
    )
      ? configuracionOpta.ttlMs.seguimientoResultado
      : configuracionOpta.ttlMs.fixtures;
    await this.marcarExito(claveEstado, ttl);
    return fixtures;
  }

  private async obtenerFixturesActuales(
    claveDivision: DivisionKey,
  ): Promise<FixtureOpta[] | null> {
    const snapshot = await firestoreApp
      .collection(COLECCIONES.fixturesActuales)
      .doc(claveDivision)
      .get();

    if (!snapshot.exists) {
      return null;
    }

    const data = snapshot.data() as { fixtures?: FixtureOpta[] } | undefined;
    return Array.isArray(data?.fixtures) ? (data?.fixtures ?? []) : [];
  }

  private async rematerializarStatsHaciaLigaMx(fixture: FixtureOpta): Promise<boolean> {
    const idLigaMx = await this.resolverIdPartidoLigaMx(fixture);

    if (!idLigaMx) {
      return false;
    }

    const destino = await this.obtenerStatsActuales(String(idLigaMx));

    if (destino?.comparativa.length) {
      return false;
    }

    const origen = await this.obtenerStatsActuales(fixture.fixtureUuid);

    if (!origen?.comparativa.length) {
      return false;
    }

    await firestoreApp.collection(COLECCIONES.statsActuales).doc(String(idLigaMx)).set({
      ...origen,
      id: String(idLigaMx),
      idPartidoLigaMx: idLigaMx,
    });
    return true;
  }

  private async sincronizarStatsSiCorresponde(
    fixture: FixtureOpta,
    contexto: ContextoOptaDoc,
  ): Promise<boolean> {
    if (partidoDentroDeVentanaDeSilencio(fixture.fechaHoraPartido)) {
      return false;
    }

    if (!puedePublicarseStats(fixture.fechaHoraPartido)) {
      return false;
    }

    const idLigaMx = await this.resolverIdPartidoLigaMx(fixture);
    const docId = idLigaMx ? String(idLigaMx) : fixture.fixtureUuid;
    const existente =
      (await this.obtenerStatsActuales(docId)) ||
      (await this.obtenerStatsActuales(fixture.fixtureUuid));
    const claveEstado = `opta-stats-${fixture.fixtureUuid}`;

    if (existente?.comparativa.length) {
      if (!(await this.debeSincronizar(claveEstado, configuracionOpta.ttlMs.statsPublicadas))) {
        return false;
      }
    } else if (estaEnVentanaDeSeguimientoStats(fixture.fechaHoraPartido)) {
      if (
        !(await this.debeSincronizar(
          claveEstado,
          configuracionOpta.ttlMs.seguimientoResultado,
        ))
      ) {
        return false;
      }
    } else if (existente) {
      return false;
    }

    await this.marcarIntento(claveEstado);
    const raw = await this.getJson<Record<string, unknown>>(
      this.pathDeFeed("matchstats"),
      { detailed: "yes", fx: fixture.fixtureUuid },
    );
    const payload = normalizarMatchStats({
      fixture,
      raw,
      idPartidoLigaMx: idLigaMx,
      temporadaActual: contexto.temporadaActual,
      torneoActual: contexto.torneoActual,
      sincronizadoEn: new Date().toISOString(),
    });

    if (!payload.comparativa.length && estaEnVentanaDeSeguimientoStats(fixture.fechaHoraPartido)) {
      await this.marcarExito(claveEstado, configuracionOpta.ttlMs.seguimientoResultado);
      return false;
    }

    await firestoreApp.collection(COLECCIONES.statsActuales).doc(payload.id).set(payload);
    const ttl = payload.comparativa.length
      ? configuracionOpta.ttlMs.statsPublicadas
      : configuracionOpta.ttlMs.seguimientoResultado;
    await this.marcarExito(claveEstado, ttl);
    return payload.comparativa.length > 0;
  }

  private async resolverIdPartidoLigaMx(fixture: FixtureOpta): Promise<number | null> {
    const snapshot = await firestoreApp
      .collection(COLECCIONES.calendariosLigaMx)
      .doc(fixture.claveDivision)
      .get();

    if (!snapshot.exists) {
      return null;
    }

    const data = snapshot.data() as { partidos?: Array<Record<string, unknown>> } | undefined;
    const partidos = this.mapearPartidosLigaMx(data?.partidos || []);
    const fixtureMs = fixture.fechaHoraPartido
      ? Date.parse(fixture.fechaHoraPartido)
      : Number.NaN;

    const coincidencia = partidos.find((partido) => {
      const mismoLocal = nombresClubCoinciden(partido.nombreLocal, fixture.local.nombre);
      const mismoVisita = nombresClubCoinciden(partido.nombreVisita, fixture.visita.nombre);

      if (!mismoLocal || !mismoVisita) {
        return false;
      }

      if (Number.isNaN(fixtureMs) || !partido.fechaHoraPartido) {
        return Boolean(fixture.fechaLocal && partido.fechaHoraPartido?.startsWith(fixture.fechaLocal));
      }

      const partidoMs = Date.parse(partido.fechaHoraPartido);
      return Math.abs(partidoMs - fixtureMs) <= 12 * 60 * 60 * 1000;
    });

    return coincidencia?.idPartido ?? null;
  }

  private mapearPartidosLigaMx(raw: Array<Record<string, unknown>>): PartidoLigaMxResumen[] {
    return raw.map((item) => {
      const local = (item.local && typeof item.local === "object"
        ? item.local
        : {}) as Record<string, unknown>;
      const visita = (item.visita && typeof item.visita === "object"
        ? item.visita
        : {}) as Record<string, unknown>;

      return {
        idPartido: Number(item.idPartido || item.id || 0),
        fechaHoraPartido: item.fechaHoraPartido
          ? String(item.fechaHoraPartido)
          : null,
        nombreLocal: String(local.nombre || item.clubLocal || ""),
        nombreVisita: String(visita.nombre || item.clubVisita || ""),
      };
    });
  }

  private async obtenerContextoActual(): Promise<ContextoOptaDoc | null> {
    const snapshot = await firestoreApp
      .collection(COLECCIONES.contextoActual)
      .doc("actual")
      .get();
    return snapshot.exists ? (snapshot.data() as ContextoOptaDoc) : null;
  }

  private async obtenerStatsActuales(id: string): Promise<StatsPartidoOptaDoc | null> {
    const snapshot = await firestoreApp.collection(COLECCIONES.statsActuales).doc(id).get();
    return snapshot.exists ? (snapshot.data() as StatsPartidoOptaDoc) : null;
  }

  private async obtenerEstadoSincronizacion(
    clave: string,
  ): Promise<EstadoSincronizacionOptaDoc | null> {
    const snapshot = await firestoreApp
      .collection(COLECCIONES.estadoSincronizacion)
      .doc(clave)
      .get();
    return snapshot.exists ? (snapshot.data() as EstadoSincronizacionOptaDoc) : null;
  }

  private async debeSincronizar(clave: string, ttlMs: number): Promise<boolean> {
    const estado = await this.obtenerEstadoSincronizacion(clave);

    if (!estado) {
      return true;
    }

    return Date.now() >= estado.proximaEjecucionPermitidaMs;
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
}

export default new OptaService();
