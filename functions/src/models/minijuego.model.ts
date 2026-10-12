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
  weight: number;
  orden: number;
  color?: string;
  imagenUrl?: string;
  descripcion?: string;
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
  weight?: number;
  descripcion?: string;
  imagenUrl?: string;
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
