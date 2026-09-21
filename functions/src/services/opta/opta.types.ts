export type DivisionKey = "varonil" | "femenil";

export interface ResumenCalendarioOpta {
  id: string;
  nombre: string;
  nombreCompetencia: string;
  fechaInicio: string | null;
  fechaFin: string | null;
}

export interface ResumenContestantOpta {
  id: string;
  nombre: string;
}

export interface ContextoOptaDoc {
  temporadaActual: { id: string; nombre: string };
  torneoActual: { id: string; nombre: string };
  divisiones: Array<{
    clave: DivisionKey;
    calendario: ResumenCalendarioOpta;
    club: ResumenContestantOpta | null;
  }>;
  hashFuente: string;
  actualizadoEn: string;
}

export interface FixtureOpta {
  fixtureUuid: string;
  claveDivision: DivisionKey;
  fechaHoraPartido: string | null;
  fechaLocal: string | null;
  horaLocal: string | null;
  estado: string | null;
  local: ResumenContestantOpta;
  visita: ResumenContestantOpta;
}

export interface FilaEstadisticaOpta {
  clave: string;
  etiqueta: string;
  local: string;
  visita: string;
}

export interface StatsPartidoOptaDoc {
  id: string;
  fixtureUuid: string;
  idPartidoLigaMx: number | null;
  claveDivision: DivisionKey;
  temporadaActual: { id: string; nombre: string };
  torneoActual: { id: string; nombre: string };
  fechaHoraPartido: string | null;
  estado: string | null;
  local: { id: string; nombre: string };
  visita: { id: string; nombre: string };
  comparativa: FilaEstadisticaOpta[];
  hashFuente: string;
  sincronizadoEn: string;
}

export interface EstadoSincronizacionOptaDoc {
  clave: string;
  proximaEjecucionPermitidaMs: number;
  ultimoIntentoMs: number;
  ultimaEjecucionExitosaMs: number | null;
  ultimoError: string | null;
}

export interface ResumenEjecucionOpta {
  temporadaActual: string;
  torneoActual: string;
  statsSincronizadas: number;
  omitido: boolean;
  motivoOmision: string | null;
}
