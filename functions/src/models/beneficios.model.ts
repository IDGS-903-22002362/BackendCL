export type BeneficioMediaTipo = "imagen" | "video";

export const BENEFICIO_TIPOS = ["estandar", "minijuego"] as const;

export type BeneficioTipo = (typeof BENEFICIO_TIPOS)[number];

export const MINIJUEGO_TIPOS_BENEFICIO = [
  "ruleta",
  "cofre",
  "rasca",
  "cartas",
  "sobre",
] as const;

export type BeneficioMinijuegoTipo = (typeof MINIJUEGO_TIPOS_BENEFICIO)[number];

export const MAX_BENEFICIO_IMAGENES = 10;
export const MAX_BENEFICIO_PUNTOS_RECOMPENSA = 10_000;

export const BENEFICIO_DESTINOS = [
  "none",
  "home",
  "rewards",
  "plantilla",
  "calendario",
  "galeria",
  "tienda",
] as const;

export type BeneficioDestinoModulo = (typeof BENEFICIO_DESTINOS)[number];

export interface BeneficioRedireccion {
  modulo: BeneficioDestinoModulo;
}

export interface Beneficio {
  id: string;
  titulo: string;
  descripcion: string;
  /** @deprecated Usar imagenes. Se mantiene como primera imagen en respuestas. */
  imagen?: string;
  imagenes?: string[];
  video?: string;
  mediaTipo?: BeneficioMediaTipo;
  redireccion?: BeneficioRedireccion;
  /** Puntos que otorga al reclamar. 0 = sin recompensa de puntos. */
  puntosRecompensa?: number;
  /** Ausente en documentos anteriores: se trata como estandar. */
  tipo?: BeneficioTipo;
  minijuegoId?: string;
  minijuegoTipo?: BeneficioMinijuegoTipo;
  estatus: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface BeneficioReclamo {
  beneficioId: string;
  memberId: string;
  puntos: number;
  beneficioTitulo: string;
  transactionId?: string;
  claimedAt: Date;
}

export interface BeneficioClaimResult {
  alreadyClaimed: boolean;
  puntosAsignados: number;
  puntosActuales: number;
  beneficioId: string;
}
