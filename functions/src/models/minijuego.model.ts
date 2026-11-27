export const MINIJUEGO_TIPOS = [
  "ruleta",
  "cofre",
  "rasca",
  "cartas",
  "sobre",
] as const;

export type MinijuegoTipo = (typeof MINIJUEGO_TIPOS)[number];

export const PRIZE_TYPES = [
  "points",
  "coupon",
  "physical",
  "digital",
  "none",
] as const;

export type PrizeType = (typeof PRIZE_TYPES)[number];

export const MINIJUEGO_VISIBILIDADES = ["publico", "restringido"] as const;

export type MinijuegoVisibilidad = (typeof MINIJUEGO_VISIBILIDADES)[number];

export const MINIJUEGO_PLAY_STATUSES = ["pending_reward", "completed"] as const;

export type MinijuegoPlayStatus = (typeof MINIJUEGO_PLAY_STATUSES)[number];

/**
 * Tope técnico de premios por minijuego (incluye el especial). Lo comparten
 * el validador, la lógica y el panel: play() lee todos los premios en su
 * transacción y la edición los reescribe todos en la suya.
 */
export const MAX_PREMIOS_MINIJUEGO = 50;

/**
 * Diseño de la carta que se copia al ganar el premio especial:
 * - personalizada: la carta usa cartaImagenUrl como arte.
 * - predeterminada: la carta genérica, sin depender del nombre del premio.
 * Los registros anteriores no tienen marcador (la app usa su lógica antigua).
 */
export const CARTA_DISENOS = ["personalizada", "predeterminada"] as const;

export type CartaDiseno = (typeof CARTA_DISENOS)[number];

export interface MinijuegoAudiencia {
  visibilidad: MinijuegoVisibilidad;
  usuariosPermitidos: string[];
}

export interface Minijuego {
  id: string;
  beneficioId: string;
  tipo: MinijuegoTipo;
  estatus: boolean;
  fechaInicio?: Date;
  fechaFin?: Date;
  intentosPorUsuario: number;
  audiencia: MinijuegoAudiencia;
  createdAt: Date;
  updatedAt: Date;
}

export interface MinijuegoPremio {
  id: string;
  minijuegoId: string;
  nombre: string;
  tipo: PrizeType;
  valor?: number;
  stock: number | null;
  /**
   * Peso relativo usado por el sorteo. En premios guardados con porcentaje
   * vale lo mismo que la probabilidad en unidades de 0.001 % (30 % = 30000),
   * así el sorteo antiguo y el nuevo producen la misma distribución.
   */
  weight: number;
  /**
   * Probabilidad configurada en porcentaje (0 a 100). 0 % = guardado pero
   * deshabilitado: nunca sale. Ausente en premios antiguos.
   */
  probabilidad?: number;
  orden: number;
  color?: string;
  imagenUrl?: string;
  /** Arte de la carta coleccionable. Solo en el premio especial. */
  cartaImagenUrl?: string;
  descripcion?: string;
  terminos?: string;
  validoDesde?: Date;
  caducaEl?: Date;
  especial?: boolean;
  maxGanadores?: number;
}

export interface MinijuegoEstado {
  intentosUsados: number;
  ultimaPlayId?: string;
  claves: Record<string, string>;
}

export interface MinijuegoPlay {
  id: string;
  minijuegoId: string;
  userId: string;
  prizeId: string;
  prizeType: PrizeType;
  prizeName: string;
  prizeDescription?: string;
  prizeValue?: number;
  prizeImageUrl?: string;
  /**
   * Copia inmutable del arte de la carta al ganar el especial (null = sin
   * arte propio). Ausente en jugadas que no son del especial o anteriores.
   */
  cartaImagenUrl?: string | null;
  /** Marcador de diseño copiado al ganar el especial (ver CARTA_DISENOS). */
  cartaDiseno?: string;
  status: MinijuegoPlayStatus;
  idempotencyKey: string;
  revelado: boolean;
  createdAt: Date;
  transactionId?: string;
  alreadyPlayed: boolean;
}

export interface MinijuegoSegment {
  id: string;
  label: string;
  imageUrl?: string;
  color?: string;
}

export interface PremioInput {
  id?: string;
  nombre: string;
  tipo: PrizeType;
  valor?: number;
  stock?: number | null;
  /** Obsoleto: se ignora al guardar. Usar probabilidad. */
  weight?: number;
  /** Probabilidad en porcentaje, con hasta 3 decimales. */
  probabilidad?: number;
  descripcion?: string;
  terminos?: string;
  validoDesde?: string | null;
  caducaEl?: string | null;
  imagenUrl?: string;
  /**
   * Solo premio especial. Ausente = conservar la del mismo premio al editar
   * (sin carta al crear); null o '' = sin carta; URL = la subida al bucket.
   */
  cartaImagenUrl?: string | null;
  color?: string;
  especial?: boolean;
  maxGanadores?: number;
}

export interface GuardarMinijuegoInput {
  beneficio: {
    titulo: string;
    descripcion: string;
    estatus: boolean;
  };
  minijuego: {
    tipo: MinijuegoTipo;
    fechaInicio?: string | null;
    fechaFin?: string | null;
    intentosPorUsuario: number;
    audiencia: {
      visibilidad: MinijuegoVisibilidad;
      usuariosPermitidos: string[];
    };
  };
  premios: PremioInput[];
}
