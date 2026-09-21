import { createHash } from "crypto";
import {
  DivisionKey,
  FilaEstadisticaOpta,
  FixtureOpta,
  StatsPartidoOptaDoc,
} from "./opta.types";

const ETIQUETAS: Record<string, string> = {
  possessionPercentage: "Posesión",
  totalScoringAtt: "Tiros",
  ontargetScoringAtt: "Tiros a puerta",
  shotOffTarget: "Tiros desviados",
  blockedScoringAtt: "Tiros bloqueados",
  wonCorners: "Córners",
  cornerTaken: "Córners",
  fkFoulLost: "Faltas",
  totalOffside: "Fuera de juego",
  yellowCard: "Amarillas",
  redCard: "Rojas",
  totalPass: "Pases",
  accuratePass: "Pases precisos",
  totalTackle: "Entradas",
  wonTackle: "Entradas ganadas",
  interceptionWon: "Intercepciones",
  totalClearance: "Despejes",
  saves: "Atajadas",
  totalCross: "Centros",
  accurateCross: "Centros precisos",
  duelWon: "Duelos ganados",
};

const ORDEN_COMPARATIVA = [
  "possessionPercentage",
  "totalScoringAtt",
  "ontargetScoringAtt",
  "shotOffTarget",
  "blockedScoringAtt",
  "wonCorners",
  "cornerTaken",
  "totalPass",
  "accuratePass",
  "fkFoulLost",
  "totalOffside",
  "yellowCard",
  "redCard",
  "totalTackle",
  "wonTackle",
  "interceptionWon",
  "totalClearance",
  "saves",
  "totalCross",
  "accurateCross",
  "duelWon",
];

const aTexto = (value: unknown): string => {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value).trim();
};

const aTextoNullable = (value: unknown): string | null => {
  const texto = aTexto(value);
  return texto ? texto : null;
};

const comoLista = (value: unknown): unknown[] => {
  if (Array.isArray(value)) {
    return value;
  }

  if (value && typeof value === "object") {
    return [value];
  }

  return [];
};

const ordenarClavesProfundas = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(ordenarClavesProfundas);
  }

  if (value && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((accumulator, key) => {
        accumulator[key] = ordenarClavesProfundas(
          (value as Record<string, unknown>)[key],
        );
        return accumulator;
      }, {});
  }

  return value;
};

export const generarHashNormalizado = (value: unknown): string => {
  return createHash("sha1")
    .update(JSON.stringify(ordenarClavesProfundas(value)))
    .digest("hex");
};

const ALIAS_CLUB: Record<string, string> = {
  rayadas: "monterrey",
  rayados: "monterrey",
  chivas: "guadalajara",
  xolos: "tijuana",
  pumas: "unam",
  pumasunam: "unam",
  universidadnacional: "unam",
  tuzos: "pachuca",
  gallos: "queretaro",
  gallosblancos: "queretaro",
  bravos: "juarez",
  tigres: "uanl",
  tigresuanl: "uanl",
  sanluis: "atleticosanluis",
  atleticodesanluis: "atleticosanluis",
};

export const normalizarNombreClub = (value: string): string => {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(club|cf|fc|afc|femenil|femenino|women|womens)\b/g, "")
    .replace(/[^a-z0-9]/g, "");
};

export const canonizarNombreClub = (value: string): string => {
  const normalizado = normalizarNombreClub(value);
  return ALIAS_CLUB[normalizado] || normalizado;
};

export const nombresClubCoinciden = (left: string, right: string): boolean => {
  const a = canonizarNombreClub(left);
  const b = canonizarNombreClub(right);

  if (!a || !b) {
    return false;
  }

  return a === b || a.includes(b) || b.includes(a);
};

export const esClubLeon = (nombre: string): boolean => {
  const normalizado = normalizarNombreClub(nombre);
  return normalizado === "leon" || normalizado.endsWith("leon");
};

const extraerFechaHoraFixture = (matchInfo: Record<string, unknown>): string | null => {
  const dateTime = aTextoNullable(matchInfo.dateTime);

  if (dateTime) {
    const parsed = Date.parse(dateTime);
    return Number.isNaN(parsed) ? dateTime : new Date(parsed).toISOString();
  }

  const date = aTexto(matchInfo.date);
  const time = aTexto(matchInfo.time);

  if (date && time) {
    const combined = `${date.replace(/Z$/i, "")}T${time.replace(/Z$/i, "")}Z`;
    const parsed = Date.parse(combined);
    return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
  }

  if (date) {
    const parsed = Date.parse(date);
    return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
  }

  return null;
};

const extraerContestants = (
  matchInfo: Record<string, unknown>,
): { local: FixtureOpta["local"]; visita: FixtureOpta["visita"] } => {
  const contestants = comoLista(matchInfo.contestant) as Array<Record<string, unknown>>;
  const localRaw =
    contestants.find((item) => aTexto(item.position).toLowerCase() === "home") ||
    contestants[0] ||
    {};
  const visitaRaw =
    contestants.find((item) => aTexto(item.position).toLowerCase() === "away") ||
    contestants[1] ||
    {};

  return {
    local: { id: aTexto(localRaw.id), nombre: aTexto(localRaw.name) },
    visita: { id: aTexto(visitaRaw.id), nombre: aTexto(visitaRaw.name) },
  };
};

export const extraerColeccion = (
  payload: unknown,
  claves: string[],
): Array<Record<string, unknown>> => {
  if (Array.isArray(payload)) {
    return payload as Array<Record<string, unknown>>;
  }

  if (!payload || typeof payload !== "object") {
    return [];
  }

  const root = payload as Record<string, unknown>;

  for (const clave of claves) {
    if (Array.isArray(root[clave])) {
      return root[clave] as Array<Record<string, unknown>>;
    }
  }

  for (const clave of claves) {
    const nested = root[clave];

    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      return [nested as Record<string, unknown>];
    }
  }

  return [];
};

export const extraerListaDeFeed = (
  payload: unknown,
  claves: string[],
): Array<Record<string, unknown>> => {
  const coleccion = extraerColeccion(payload, claves);

  if (coleccion.length) {
    return coleccion;
  }

  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    return [payload as Record<string, unknown>];
  }

  return [];
};

/**
 * OT2 suele venir como competition[] → tournamentCalendar[], no como una
 * lista plana de calendarios en la raíz.
 */
export const aplanarCalendariosOpta = (
  payload: unknown,
): Array<Record<string, unknown>> => {
  const competencias = extraerColeccion(payload, ["competition", "competitions"]);

  if (!competencias.length) {
    return extraerColeccion(payload, [
      "tournamentCalendar",
      "tournamentCalendars",
      "calendars",
    ]);
  }

  const calendarios: Array<Record<string, unknown>> = [];

  competencias.forEach((competencia) => {
    const nombreCompetencia = aTexto(
      competencia.name || competencia.competitionName,
    );
    const anidados = extraerColeccion(competencia, [
      "tournamentCalendar",
      "tournamentCalendars",
      "calendars",
    ]);

    if (!anidados.length) {
      calendarios.push({
        ...competencia,
        competitionName:
          nombreCompetencia || aTexto(competencia.competitionName),
      });
      return;
    }

    anidados.forEach((calendario) => {
      calendarios.push({
        ...calendario,
        competition:
          competencia.id || competencia.name
            ? { id: competencia.id, name: nombreCompetencia }
            : calendario.competition,
        competitionName: nombreCompetencia,
      });
    });
  });

  return calendarios;
};

export const normalizarFixture = (
  raw: Record<string, unknown>,
  claveDivision: DivisionKey,
): FixtureOpta | null => {
  const matchInfo = (
    raw.matchInfo && typeof raw.matchInfo === "object"
      ? raw.matchInfo
      : raw
  ) as Record<string, unknown>;
  const fixtureUuid = aTexto(matchInfo.id || raw.id || raw.fixtureId);

  if (!fixtureUuid) {
    return null;
  }

  const equipos = extraerContestants(matchInfo);

  return {
    fixtureUuid,
    claveDivision,
    fechaHoraPartido: extraerFechaHoraFixture(matchInfo),
    fechaLocal: aTextoNullable(matchInfo.localDate),
    horaLocal: aTextoNullable(matchInfo.localTime),
    estado: aTextoNullable(
      (matchInfo.liveData as Record<string, unknown> | undefined)?.matchStatus ||
        ((raw.liveData as Record<string, unknown> | undefined)?.matchDetails as
          | Record<string, unknown>
          | undefined)?.matchStatus ||
        matchInfo.matchStatus,
    ),
    local: equipos.local,
    visita: equipos.visita,
  };
};

const mapaDeStats = (rawStats: unknown): Map<string, string> => {
  const mapa = new Map<string, string>();

  comoLista(rawStats).forEach((item) => {
    if (!item || typeof item !== "object") {
      return;
    }

    const stat = item as Record<string, unknown>;
    const clave = aTexto(stat.type || stat.name);

    if (!clave) {
      return;
    }

    mapa.set(clave, aTexto(stat.value ?? stat.fh ?? stat.sh));
  });

  return mapa;
};

const extraerStatsDeLado = (
  matchStats: Record<string, unknown>,
  contestantId: string,
): Map<string, string> => {
  const liveData = (
    matchStats.liveData && typeof matchStats.liveData === "object"
      ? matchStats.liveData
      : matchStats
  ) as Record<string, unknown>;

  const lineUps = comoLista(liveData.lineUp) as Array<Record<string, unknown>>;
  const lineUp = lineUps.find(
    (item) => aTexto(item.contestantId) === contestantId,
  );

  if (lineUp?.stat) {
    return mapaDeStats(lineUp.stat);
  }

  const contestants = comoLista(liveData.contestant).concat(
    comoLista(matchStats.contestant),
  ) as Array<Record<string, unknown>>;
  const contestant = contestants.find((item) => aTexto(item.id) === contestantId);

  if (contestant?.stat) {
    return mapaDeStats(contestant.stat);
  }

  const teamStats = comoLista(liveData.stat).concat(comoLista(matchStats.stat)) as Array<
    Record<string, unknown>
  >;
  const teamStat = teamStats.find(
    (item) => aTexto(item.contestantId || item.id) === contestantId,
  );

  if (teamStat?.stat) {
    return mapaDeStats(teamStat.stat);
  }

  return new Map();
};

export const construirComparativa = (
  statsLocal: Map<string, string>,
  statsVisita: Map<string, string>,
): FilaEstadisticaOpta[] => {
  const claves = new Set<string>([...statsLocal.keys(), ...statsVisita.keys()]);
  const filas: FilaEstadisticaOpta[] = [];
  const usadas = new Set<string>();

  const etiquetasUsadas = new Set<string>();

  const agregarFila = (clave: string): void => {
    const etiqueta = ETIQUETAS[clave] || clave;

    if (etiquetasUsadas.has(etiqueta)) {
      return;
    }

    usadas.add(clave);
    etiquetasUsadas.add(etiqueta);
    filas.push({
      clave,
      etiqueta,
      local: statsLocal.get(clave) || "0",
      visita: statsVisita.get(clave) || "0",
    });
  };

  ORDEN_COMPARATIVA.forEach((clave) => {
    if (!statsLocal.has(clave) && !statsVisita.has(clave)) {
      return;
    }

    agregarFila(clave);
  });

  claves.forEach((clave) => {
    if (usadas.has(clave) || !ETIQUETAS[clave]) {
      return;
    }

    agregarFila(clave);
  });

  return filas;
};

export const normalizarMatchStats = (input: {
  fixture: FixtureOpta;
  raw: Record<string, unknown>;
  idPartidoLigaMx: number | null;
  temporadaActual: { id: string; nombre: string };
  torneoActual: { id: string; nombre: string };
  sincronizadoEn: string;
}): StatsPartidoOptaDoc => {
  const rawMatch = Array.isArray(input.raw.match) ? input.raw.match[0] : input.raw.match;
  const matchStats = (
    input.raw.matchStats && typeof input.raw.matchStats === "object"
      ? input.raw.matchStats
      : rawMatch && typeof rawMatch === "object"
        ? rawMatch
        : input.raw
  ) as Record<string, unknown>;
  const statsLocal = extraerStatsDeLado(matchStats, input.fixture.local.id);
  const statsVisita = extraerStatsDeLado(matchStats, input.fixture.visita.id);
  const comparativa = construirComparativa(statsLocal, statsVisita);
  const liveData = (
    matchStats.liveData && typeof matchStats.liveData === "object"
      ? matchStats.liveData
      : {}
  ) as Record<string, unknown>;
  const matchDetails = (
    liveData.matchDetails && typeof liveData.matchDetails === "object"
      ? liveData.matchDetails
      : {}
  ) as Record<string, unknown>;
  const payloadSinHash: Omit<StatsPartidoOptaDoc, "hashFuente"> = {
    id: input.idPartidoLigaMx
      ? String(input.idPartidoLigaMx)
      : input.fixture.fixtureUuid,
    fixtureUuid: input.fixture.fixtureUuid,
    idPartidoLigaMx: input.idPartidoLigaMx,
    claveDivision: input.fixture.claveDivision,
    temporadaActual: input.temporadaActual,
    torneoActual: input.torneoActual,
    fechaHoraPartido: input.fixture.fechaHoraPartido,
    estado: aTextoNullable(matchDetails.matchStatus) || input.fixture.estado,
    local: input.fixture.local,
    visita: input.fixture.visita,
    comparativa,
    sincronizadoEn: input.sincronizadoEn,
  };

  return {
    ...payloadSinHash,
    hashFuente: generarHashNormalizado(payloadSinHash),
  };
};
