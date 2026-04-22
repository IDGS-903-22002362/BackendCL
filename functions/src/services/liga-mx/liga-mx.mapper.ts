import { createHash } from "crypto";
import {
  obtenerNombreTorneo,
  obtenerPerfilDivision,
  resolverNombreTemporadaActual,
} from "../../config/liga-mx.config";
import {
  CalendarioLigaMxDoc,
  ClasificacionLigaMxDoc,
  ContextoLigaMxDoc,
  DetallePartidoLigaMxDoc,
  DivisionKey,
  EventoNarracion,
  FilaClasificacion,
  IntegranteAlineacion,
  IntegranteCuerpoTecnico,
  IntegranteCuerpoTecnicoAlineacion,
  JugadorLigaMxDoc,
  JugadorPlantilla,
  LadoAlineacion,
  PartidoLigaMxDoc,
  PerfilJugador,
  PlantillaLigaMxDoc,
  ResumenTemporada,
  ResumenTorneo,
} from "./liga-mx.types";

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

const normalizarEtiquetaEstado = (value: string | null | undefined): string => {
  return (value || "").trim().toLowerCase();
};

export const esPartidoConcluido = (estado: {
  idMinutoAMinuto: number | null;
  etiquetaMinutoAMinuto: string | null;
}): boolean => {
  const etiqueta = normalizarEtiquetaEstado(estado.etiquetaMinutoAMinuto);

  return (
    estado.idMinutoAMinuto === 7 ||
    etiqueta.includes("oficial") ||
    etiqueta.includes("final") ||
    etiqueta.includes("conclu") ||
    etiqueta.includes("penales")
  );
};

export const esMarcadorOficial = (estado: {
  idMinutoAMinuto: number | null;
  etiquetaMinutoAMinuto: string | null;
}): boolean => {
  const etiqueta = normalizarEtiquetaEstado(estado.etiquetaMinutoAMinuto);

  return (
    estado.idMinutoAMinuto === 7 ||
    etiqueta.includes("oficial") ||
    etiqueta.includes("penales")
  );
};

const debeOcultarMarcadorTemporal = (input: {
  estado: {
    idMinutoAMinuto: number | null;
    etiquetaMinutoAMinuto: string | null;
  };
  localGoles: number | null;
  visitaGoles: number | null;
  localPenales: number | null;
  visitaPenales: number | null;
}): boolean => {
  if (esMarcadorOficial(input.estado) || !esPartidoConcluido(input.estado)) {
    return false;
  }

  return (
    input.localGoles === 0 &&
    input.visitaGoles === 0 &&
    (input.localPenales === null || input.localPenales === 0) &&
    (input.visitaPenales === null || input.visitaPenales === 0)
  );
};

const aNumeroNullable = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const aTextoNullable = (value: unknown): string | null => {
  if (value === null || value === undefined) {
    return null;
  }

  const trimmed = String(value).trim();
  return trimmed ? trimmed : null;
};

const aIsoString = (value: unknown): string | null => {
  const normalized = aTextoNullable(value);

  if (!normalized) {
    return null;
  }

  const candidate = normalized.includes("T")
    ? normalized
    : normalized.replace(" ", "T");
  const date = new Date(candidate);

  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const normalizarTextoComparacion = (value: string | null | undefined): string => {
  return (value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
};

const esFasePrimerTiempo = (fase: string | null | undefined): boolean => {
  const faseNormalizada = normalizarTextoComparacion(fase);

  return (
    faseNormalizada.includes("primer tiempo") ||
    faseNormalizada.includes("1er tiempo") ||
    faseNormalizada.includes("final del primer tiempo") ||
    faseNormalizada.includes("medio tiempo") ||
    faseNormalizada.includes("descanso")
  );
};

const formatearMinutoNarracion = (
  minuto: number | null,
  fase: string | null | undefined,
): string | null => {
  if (minuto === null) {
    return null;
  }

  if (esFasePrimerTiempo(fase) && minuto > 45) {
    return `45+${minuto - 45}`;
  }

  if (minuto > 90) {
    return `90+${minuto - 90}`;
  }

  return String(minuto);
};

const construirResumenTorneo = (idTorneo: number): ResumenTorneo => ({
  id: idTorneo,
  nombre: obtenerNombreTorneo(idTorneo),
});

export const seleccionarTemporadaActual = (
  seasons: Array<{ idTemporada: number; nombre: string }>,
  now = new Date(),
): ResumenTemporada => {
  const nombreObjetivo = resolverNombreTemporadaActual(now);
  const exacta = seasons.find((season) => season.nombre === nombreObjetivo);

  if (exacta) {
    return { id: exacta.idTemporada, nombre: exacta.nombre };
  }

  const conAnio = seasons.find((season) =>
    season.nombre.includes(String(now.getFullYear())),
  );

  if (conAnio) {
    return { id: conAnio.idTemporada, nombre: conAnio.nombre };
  }

  const fallback = [...seasons].sort(
    (left, right) => right.idTemporada - left.idTemporada,
  )[0];

  return { id: fallback.idTemporada, nombre: fallback.nombre };
};

export const construirContextoActual = (
  seasons: Array<{ idTemporada: number; nombre: string }>,
  idTorneoActual: number,
  actualizadoEn: string,
  now = new Date(),
): ContextoLigaMxDoc => {
  const temporadaActual = seleccionarTemporadaActual(seasons, now);
  const payloadSinHash = {
    temporadaActual,
    torneoActual: construirResumenTorneo(idTorneoActual),
    divisiones: [obtenerPerfilDivision("varonil"), obtenerPerfilDivision("femenil")],
    actualizadoEn,
  };

  return {
    ...payloadSinHash,
    hashFuente: generarHashNormalizado(payloadSinHash),
  };
};

export const normalizarPartidoCalendario = (
  raw: Record<string, unknown>,
  divisionKey: DivisionKey,
  sincronizadoEn: string,
): PartidoLigaMxDoc => {
  const estado = {
    id: aNumeroNullable(raw.idEstatusPartido),
    idMinutoAMinuto: aNumeroNullable(raw.idEstatusMinutoAMinuto),
    etiquetaMinutoAMinuto: aTextoNullable(raw.estatusMinutoAMinuto),
    idPublicado: aNumeroNullable(raw.idEstatusPublicado),
  };
  const localGoles = aNumeroNullable(raw.golLocal);
  const visitaGoles = aNumeroNullable(raw.golVisita);
  const localPenales = aNumeroNullable(raw.penalLocal);
  const visitaPenales = aNumeroNullable(raw.penalVisita);
  const ocultarMarcadorTemporal = debeOcultarMarcadorTemporal({
    estado,
    localGoles,
    visitaGoles,
    localPenales,
    visitaPenales,
  });
  const payloadSinHash: Omit<PartidoLigaMxDoc, "hashFuente"> = {
    id: String(raw.idPartido),
    idPartido: Number(raw.idPartido),
    claveDivision: divisionKey,
    idDivision: Number(raw.idDivision ?? obtenerPerfilDivision(divisionKey).idDivision),
    nombreDivision: aTextoNullable(raw.division) || obtenerPerfilDivision(divisionKey).etiqueta,
    temporadaActual: {
      id: Number(raw.idTemporada),
      nombre: aTextoNullable(raw.temporada) || "",
    },
    torneoActual: {
      id: Number(raw.idTorneo),
      nombre: aTextoNullable(raw.torneo) || obtenerNombreTorneo(Number(raw.idTorneo)),
    },
    fase: {
      id: aNumeroNullable(raw.idFase),
      nombre: aTextoNullable(raw.fase),
    },
    jornada: {
      id: aNumeroNullable(raw.idJornada),
      nombre: aTextoNullable(raw.jornada),
      nombreCorto: aTextoNullable(raw.jornadaAbreviada),
      numero: aNumeroNullable(raw.numeroJornada),
    },
    fechaHoraPartido:
      aIsoString(raw.matchDate) || aIsoString(`${raw.fecha} ${raw.horaLocal}`),
    fecha: aTextoNullable(raw.fecha),
    hora: aTextoNullable(raw.hora),
    estado,
    estadio: {
      id: aNumeroNullable(raw.idEstadio),
      nombre: aTextoNullable(raw.estadio),
      slug: aTextoNullable(raw.estadioUrl),
    },
    transmision: {
      id: aNumeroNullable(raw.idCanaldeTV),
      nombre: aTextoNullable(raw.canaldeTV),
      nombreEstadosUnidos: aTextoNullable(raw.canaldeTVUSA),
      slug: aTextoNullable(raw.canalTvUrl),
    },
    local: {
      id: Number(raw.idClubLocal),
      nombre: aTextoNullable(raw.clubLocal) || "",
      logo: aTextoNullable(raw.clubLocalLogo),
      slug: aTextoNullable(raw.clubLocalUrl),
      goles: ocultarMarcadorTemporal ? null : localGoles,
      penales: ocultarMarcadorTemporal ? null : localPenales,
    },
    visita: {
      id: Number(raw.idClubVisita),
      nombre: aTextoNullable(raw.clubVisita) || "",
      logo: aTextoNullable(raw.clubVisitaLogo),
      slug: aTextoNullable(raw.clubVisitaUrl),
      goles: ocultarMarcadorTemporal ? null : visitaGoles,
      penales: ocultarMarcadorTemporal ? null : visitaPenales,
    },
    arbitraje: {
      central: aTextoNullable(raw.arbitroCentral),
      asistente1: aTextoNullable(raw.arbitroAsistente1),
      asistente2: aTextoNullable(raw.arbitroAsistente2),
      cuartoArbitro: aTextoNullable(raw.cuartoArbitro),
    },
    actualizadoFuente: aIsoString(raw.mrcdFchaMdfc),
    sincronizadoEn,
  };

  return {
    ...payloadSinHash,
    hashFuente: generarHashNormalizado(payloadSinHash),
  };
};

export const construirCalendarioActual = (
  divisionKey: DivisionKey,
  temporadaActual: ResumenTemporada,
  torneoActual: ResumenTorneo,
  partidos: PartidoLigaMxDoc[],
  sincronizadoEn: string,
): CalendarioLigaMxDoc => {
  const payloadSinHash = {
    division: obtenerPerfilDivision(divisionKey),
    temporadaActual,
    torneoActual,
    partidos,
    totalPartidos: partidos.length,
    sincronizadoEn,
  };

  return {
    ...payloadSinHash,
    hashFuente: generarHashNormalizado(payloadSinHash),
  };
};

export const normalizarFilaClasificacion = (
  raw: Record<string, unknown>,
): FilaClasificacion => {
  const payloadSinHash: Omit<FilaClasificacion, "hashFuente"> = {
    idClub: Number(raw.idClub),
    nombre: aTextoNullable(raw.nombreClub) || "",
    slug: aTextoNullable(raw.nombreClubUrl),
    lugar: Number(raw.lugarTorneo),
    grupo: aTextoNullable(raw.grupo),
    lugarGrupo: aNumeroNullable(raw.lugarGrupo),
    puntos: Number(raw.puntos ?? 0),
    jugados: Number(raw.jj ?? 0),
    ganados: Number(raw.jg ?? 0),
    empatados: Number(raw.je ?? 0),
    perdidos: Number(raw.jp ?? 0),
    golesFavor: Number(raw.gf ?? 0),
    golesContra: Number(raw.gc ?? 0),
    diferenciaGoles: Number(raw.diferencia ?? 0),
    porcentaje: aNumeroNullable(raw.porcentaje),
  };

  return {
    ...payloadSinHash,
    hashFuente: generarHashNormalizado(payloadSinHash),
  };
};

export const construirClasificacionActual = (
  divisionKey: DivisionKey,
  temporadaActual: ResumenTemporada,
  torneoActual: ResumenTorneo,
  posiciones: FilaClasificacion[],
  sincronizadoEn: string,
): ClasificacionLigaMxDoc => {
  const payloadSinHash = {
    division: obtenerPerfilDivision(divisionKey),
    temporadaActual,
    torneoActual,
    posiciones,
    sincronizadoEn,
  };

  return {
    ...payloadSinHash,
    hashFuente: generarHashNormalizado(payloadSinHash),
  };
};

export const normalizarJugadorPlantilla = (
  raw: Record<string, unknown>,
): JugadorPlantilla => {
  const payloadSinHash: Omit<JugadorPlantilla, "hashFuente"> = {
    id: String(raw.idJugador),
    idJugador: Number(raw.idJugador),
    idClub: Number(raw.idClub),
    nombreCompleto: aTextoNullable(raw.nombreCompletojugador) || "",
    nombre: aTextoNullable(raw.nombreJugador),
    apellidoPaterno: aTextoNullable(raw.paternoJugador),
    apellidoMaterno: aTextoNullable(raw.maternoJugador),
    nacionalidad: aTextoNullable(raw.nacionalidad),
    posicion: aTextoNullable(raw.posicion),
    idPosicion: aNumeroNullable(raw.idPosicion),
    idPosicionPadre: aNumeroNullable(raw.idPosicionPadre),
    numeroCamiseta: aNumeroNullable(raw.numeroCamiseta),
    edad: aNumeroNullable(raw.edad),
    estatura: aNumeroNullable(raw.estatura),
    foto: aTextoNullable(raw.foto),
    estadisticas: {
      minutosJugados: aNumeroNullable(raw.minutosJugados),
      juegosJugados: aNumeroNullable(raw.juegosJugados),
      goles: aNumeroNullable(raw.goles),
      tarjetasAmarillas: aNumeroNullable(raw.tarjetasAmarillas),
      tarjetasRojas: aNumeroNullable(raw.tarjetasRojas),
      autogoles: aNumeroNullable(raw.autogoles),
    },
  };

  return {
    ...payloadSinHash,
    hashFuente: generarHashNormalizado(payloadSinHash),
  };
};

export const normalizarCuerpoTecnico = (
  raw: Record<string, unknown>,
): IntegranteCuerpoTecnico => {
  const payloadSinHash: Omit<IntegranteCuerpoTecnico, "hashFuente"> = {
    id: String(raw.idCuerpoTecnico),
    idCuerpoTecnico: Number(raw.idCuerpoTecnico),
    idClub: Number(raw.idClub),
    nombreCompleto: `${aTextoNullable(raw.nombreTecnico) || ""} ${aTextoNullable(raw.apellido) || ""}`.trim(),
    posicion: aTextoNullable(raw.posicion),
    idPosicion: aNumeroNullable(raw.idPosicion),
    siglasPosicion: aTextoNullable(raw.siglasPosicion),
    foto: aTextoNullable(raw.foto),
  };

  return {
    ...payloadSinHash,
    hashFuente: generarHashNormalizado(payloadSinHash),
  };
};

export const construirPlantillaActual = (
  divisionKey: DivisionKey,
  temporadaActual: ResumenTemporada,
  torneoActual: ResumenTorneo,
  jugadores: JugadorPlantilla[],
  cuerpoTecnico: IntegranteCuerpoTecnico[],
  sincronizadoEn: string,
): PlantillaLigaMxDoc => {
  const payloadSinHash = {
    division: obtenerPerfilDivision(divisionKey),
    temporadaActual,
    torneoActual,
    jugadores,
    cuerpoTecnico,
    totalJugadores: jugadores.length,
    totalCuerpoTecnico: cuerpoTecnico.length,
    sincronizadoEn,
  };

  return {
    ...payloadSinHash,
    hashFuente: generarHashNormalizado(payloadSinHash),
  };
};

export const normalizarPerfilJugador = (
  raw: Record<string, unknown>,
  jugadorBase: JugadorLigaMxDoc,
): JugadorLigaMxDoc => {
  const perfil: PerfilJugador = {
    nacimiento: {
      dia: aTextoNullable(raw.diaNacimiento),
      mes: aTextoNullable(raw.mesNacimiento),
      anio: aNumeroNullable(raw.anioNacimiento),
      etiquetaEdad: aTextoNullable(raw.edad),
    },
    peso: aNumeroNullable(raw.peso),
    lugarNacimiento: aTextoNullable(raw.lugarDeNacimiento),
    categoria: aTextoNullable(raw.categoriaJugador),
    afiliacion: {
      id: aNumeroNullable(raw.idestatusAfiliacion),
      etiqueta: aTextoNullable(raw.estatusAfiliacion),
    },
    torneosContratado: aTextoNullable(raw.torneosContratado),
    partidoDebut: aTextoNullable(raw.partidoDebut),
    modalidad: aTextoNullable(raw.modalidad),
  };

  return {
    ...jugadorBase,
    nombreClub: aTextoNullable(raw.nombreClub) || jugadorBase.nombreClub,
    nombreCompleto: aTextoNullable(raw.nombreJugador) || jugadorBase.nombreCompleto,
    nacionalidad: aTextoNullable(raw.nacionalidad) || jugadorBase.nacionalidad,
    posicion: aTextoNullable(raw.posicion) || jugadorBase.posicion,
    numeroCamiseta: aNumeroNullable(raw.numero) || jugadorBase.numeroCamiseta,
    estatura: aNumeroNullable(raw.estatura) || jugadorBase.estatura,
    perfil,
    hashPerfil: generarHashNormalizado(perfil),
  };
};

const normalizarIntegranteAlineacion = (
  raw: Record<string, unknown>,
  esTitular: boolean,
): IntegranteAlineacion => {
  const payloadSinHash: Omit<IntegranteAlineacion, "hashFuente"> = {
    id: String(raw.idJugador),
    nombreCompleto: [
      aTextoNullable(raw.nombreJugador),
      aTextoNullable(raw.apellidoPaterno),
      aTextoNullable(raw.apellidoMaterno),
    ]
      .filter(Boolean)
      .join(" "),
    numeroCamiseta: aNumeroNullable(raw.numeroCamiseta),
    posicion: aTextoNullable(raw.posicion),
    idPosicion: aNumeroNullable(raw.idposicion ?? raw.idPosicionPadre),
    esCapitan: Number(raw.capitan ?? 0) === 1,
    esTitular,
    foto: aTextoNullable(raw.foto),
  };

  return {
    ...payloadSinHash,
    hashFuente: generarHashNormalizado(payloadSinHash),
  };
};

const normalizarIntegranteCuerpoTecnicoAlineacion = (
  raw: Record<string, unknown>,
): IntegranteCuerpoTecnicoAlineacion => {
  const payloadSinHash: Omit<IntegranteCuerpoTecnicoAlineacion, "hashFuente"> = {
    id: String(raw.idCuerpoTecnico),
    nombreCompleto: [
      aTextoNullable(raw.nombreCuerpoTecnico),
      aTextoNullable(raw.apellidoPaterno),
      aTextoNullable(raw.apellidoMaterno),
    ]
      .filter(Boolean)
      .join(" "),
    rol: aTextoNullable(raw.posicion),
    rolCorto: aTextoNullable(raw.siglasCT),
  };

  return {
    ...payloadSinHash,
    hashFuente: generarHashNormalizado(payloadSinHash),
  };
};

const normalizarLadoAlineacion = (
  raw: Record<string, unknown> | null | undefined,
): LadoAlineacion => {
  const lado = raw || {};

  return {
    titulares: Array.isArray(lado.titulares)
      ? lado.titulares.map((item) =>
          normalizarIntegranteAlineacion(item as Record<string, unknown>, true),
        )
      : [],
    suplentes: Array.isArray(lado.suplentes)
      ? lado.suplentes.map((item) =>
          normalizarIntegranteAlineacion(item as Record<string, unknown>, false),
        )
      : [],
    cuerpoTecnico: Array.isArray(lado.cuerpotecnico)
      ? lado.cuerpotecnico.map((item) =>
          normalizarIntegranteCuerpoTecnicoAlineacion(item as Record<string, unknown>),
        )
      : [],
  };
};

export const normalizarEventoNarracion = (
  raw: Record<string, unknown>,
): EventoNarracion => {
  const minuto = aNumeroNullable(raw.min);
  const fase = aTextoNullable(raw.fase);

  const payloadSinHash: Omit<EventoNarracion, "hashFuente"> = {
    id: String(raw.idEvento),
    minuto,
    minutoEtiqueta: formatearMinutoNarracion(minuto, fase),
    tipo: aTextoNullable(raw.tipo),
    detalle: aTextoNullable(raw.detalle),
    fase,
    idClub: aNumeroNullable(raw.idClub),
    idJugador: aTextoNullable(raw.idJugador),
    x: aNumeroNullable(raw.x),
    y: aNumeroNullable(raw.y),
    comentario: aTextoNullable(raw.comentario),
    videoDisponible: Number(raw.esttVdeo ?? 0) === 1,
  };

  return {
    ...payloadSinHash,
    hashFuente: generarHashNormalizado(payloadSinHash),
  };
};

export const normalizarDetallePartido = (
  partido: PartidoLigaMxDoc,
  alineacionesRaw: Record<string, unknown>,
  narracionRaw: Record<string, unknown>,
  sincronizadoEn: string,
): DetallePartidoLigaMxDoc => {
  const alineacionLocal = alineacionesRaw.local as Record<string, unknown> | undefined;
  const alineacionVisita =
    (alineacionesRaw.visita as Record<string, unknown> | undefined) ||
    (alineacionesRaw.visitante as Record<string, unknown> | undefined);

  const payloadSinHash = {
    id: partido.id,
    idPartido: partido.idPartido,
    claveDivision: partido.claveDivision,
    temporadaActual: partido.temporadaActual,
    torneoActual: partido.torneoActual,
    alineaciones: {
      local: normalizarLadoAlineacion(alineacionLocal),
      visita: normalizarLadoAlineacion(alineacionVisita),
    },
    narracion: {
      tiempo: aTextoNullable(narracionRaw.time),
      eventos: Array.isArray(narracionRaw.coordenadas)
        ? narracionRaw.coordenadas.map((item) =>
            normalizarEventoNarracion(item as Record<string, unknown>),
          )
        : [],
    },
    sincronizadoEn,
  };

  return {
    ...payloadSinHash,
    hashFuente: generarHashNormalizado(payloadSinHash),
  };
};

export const partidoDentroDeVentanaEnVivo = (
  fechaHoraPartido: string | null,
  ventanaAntesMs: number,
  ventanaDespuesMs: number,
  ahoraMs = Date.now(),
): boolean => {
  if (!fechaHoraPartido) {
    return false;
  }

  const fechaMs = new Date(fechaHoraPartido).getTime();

  if (Number.isNaN(fechaMs)) {
    return false;
  }

  return fechaMs - ventanaAntesMs <= ahoraMs && ahoraMs <= fechaMs + ventanaDespuesMs;
};