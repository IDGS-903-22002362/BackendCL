export type DivisionKey = "varonil" | "femenil";

export interface PerfilDivision {
  clave: DivisionKey;
  idDivision: number;
  idClub: number;
  nombreClub: string;
  etiqueta: string;
}

export interface ResumenTemporada {
  id: number;
  nombre: string;
}

export interface ResumenTorneo {
  id: number;
  nombre: string;
}

export interface ContextoLigaMxDoc {
  temporadaActual: ResumenTemporada;
  torneoActual: ResumenTorneo;
  divisiones: PerfilDivision[];
  hashFuente: string;
  actualizadoEn: string;
}

export interface ResumenEquipoPartido {
  id: number;
  nombre: string;
  logo: string | null;
  slug: string | null;
  goles: number | null;
  penales: number | null;
}

export interface PartidoLigaMxDoc {
  id: string;
  idPartido: number;
  claveDivision: DivisionKey;
  idDivision: number;
  nombreDivision: string;
  temporadaActual: ResumenTemporada;
  torneoActual: ResumenTorneo;
  fase: {
    id: number | null;
    nombre: string | null;
  };
  jornada: {
    id: number | null;
    nombre: string | null;
    nombreCorto: string | null;
    numero: number | null;
  };
  fechaHoraPartido: string | null;
  fecha: string | null;
  hora: string | null;
  estado: {
    id: number | null;
    idMinutoAMinuto: number | null;
    etiquetaMinutoAMinuto: string | null;
    idPublicado: number | null;
  };
  estadio: {
    id: number | null;
    nombre: string | null;
    slug: string | null;
  };
  transmision: {
    id: number | null;
    nombre: string | null;
    nombreEstadosUnidos: string | null;
    slug: string | null;
  };
  local: ResumenEquipoPartido;
  visita: ResumenEquipoPartido;
  arbitraje: {
    central: string | null;
    asistente1: string | null;
    asistente2: string | null;
    cuartoArbitro: string | null;
  };
  hashFuente: string;
  actualizadoFuente: string | null;
  sincronizadoEn: string;
}

export interface CalendarioLigaMxDoc {
  division: PerfilDivision;
  temporadaActual: ResumenTemporada;
  torneoActual: ResumenTorneo;
  partidos: PartidoLigaMxDoc[];
  totalPartidos: number;
  hashFuente: string;
  sincronizadoEn: string;
}

export interface FilaClasificacion {
  idClub: number;
  nombre: string;
  slug: string | null;
  lugar: number;
  grupo: string | null;
  lugarGrupo: number | null;
  puntos: number;
  jugados: number;
  ganados: number;
  empatados: number;
  perdidos: number;
  golesFavor: number;
  golesContra: number;
  diferenciaGoles: number;
  porcentaje: number | null;
  hashFuente: string;
}

export interface ClasificacionLigaMxDoc {
  division: PerfilDivision;
  temporadaActual: ResumenTemporada;
  torneoActual: ResumenTorneo;
  posiciones: FilaClasificacion[];
  hashFuente: string;
  sincronizadoEn: string;
}

export interface JugadorPlantilla {
  id: string;
  idJugador: number;
  idClub: number;
  nombreCompleto: string;
  nombre: string | null;
  apellidoPaterno: string | null;
  apellidoMaterno: string | null;
  nacionalidad: string | null;
  posicion: string | null;
  idPosicion: number | null;
  idPosicionPadre: number | null;
  numeroCamiseta: number | null;
  edad: number | null;
  estatura: number | null;
  foto: string | null;
  estadisticas: {
    minutosJugados: number | null;
    juegosJugados: number | null;
    goles: number | null;
    tarjetasAmarillas: number | null;
    tarjetasRojas: number | null;
    autogoles: number | null;
  };
  hashFuente: string;
}

export interface IntegranteCuerpoTecnico {
  id: string;
  idCuerpoTecnico: number;
  idClub: number;
  nombreCompleto: string;
  posicion: string | null;
  idPosicion: number | null;
  siglasPosicion: string | null;
  foto: string | null;
  hashFuente: string;
}

export interface PlantillaLigaMxDoc {
  division: PerfilDivision;
  temporadaActual: ResumenTemporada;
  torneoActual: ResumenTorneo;
  jugadores: JugadorPlantilla[];
  cuerpoTecnico: IntegranteCuerpoTecnico[];
  totalJugadores: number;
  totalCuerpoTecnico: number;
  hashFuente: string;
  sincronizadoEn: string;
}

export interface PerfilJugador {
  nacimiento: {
    dia: string | null;
    mes: string | null;
    anio: number | null;
    etiquetaEdad: string | null;
  };
  peso: number | null;
  lugarNacimiento: string | null;
  categoria: string | null;
  afiliacion: {
    id: number | null;
    etiqueta: string | null;
  };
  torneosContratado: string | null;
  partidoDebut: string | null;
  modalidad: string | null;
}

export interface JugadorLigaMxDoc extends JugadorPlantilla {
  claveDivision: DivisionKey;
  temporadaActual: ResumenTemporada;
  torneoActual: ResumenTorneo;
  nombreClub: string;
  activoEnPlantilla: boolean;
  perfil: PerfilJugador | null;
  hashPerfil: string | null;
  hashPlantilla: string;
  actualizadoPlantillaEn: string;
  actualizadoPerfilEn: string | null;
}

export interface IntegranteAlineacion {
  id: string;
  nombreCompleto: string;
  numeroCamiseta: number | null;
  posicion: string | null;
  idPosicion: number | null;
  esCapitan: boolean;
  esTitular: boolean;
  foto: string | null;
  hashFuente: string;
}

export interface IntegranteCuerpoTecnicoAlineacion {
  id: string;
  nombreCompleto: string;
  rol: string | null;
  rolCorto: string | null;
  hashFuente: string;
}

export interface LadoAlineacion {
  titulares: IntegranteAlineacion[];
  suplentes: IntegranteAlineacion[];
  cuerpoTecnico: IntegranteCuerpoTecnicoAlineacion[];
}

export interface EventoNarracion {
  id: string;
  minuto: number | null;
  minutoEtiqueta: string | null;
  tipo: string | null;
  detalle: string | null;
  fase: string | null;
  idClub: number | null;
  idJugador: string | null;
  x: number | null;
  y: number | null;
  comentario: string | null;
  videoDisponible: boolean;
  hashFuente: string;
}

export interface DetallePartidoLigaMxDoc {
  id: string;
  idPartido: number;
  claveDivision: DivisionKey;
  temporadaActual: ResumenTemporada;
  torneoActual: ResumenTorneo;
  alineaciones: {
    local: LadoAlineacion;
    visita: LadoAlineacion;
  };
  narracion: {
    tiempo: string | null;
    eventos: EventoNarracion[];
  };
  hashFuente: string;
  sincronizadoEn: string;
}

export interface EstadoSincronizacionLigaMxDoc {
  clave: string;
  proximaEjecucionPermitidaMs: number;
  ultimoIntentoMs: number;
  ultimaEjecucionExitosaMs: number | null;
  ultimoError: string | null;
}

export interface ResumenEjecucionSincronizacion {
  temporadaActual: string;
  torneoActual: string;
  divisionesProcesadas: DivisionKey[];
}