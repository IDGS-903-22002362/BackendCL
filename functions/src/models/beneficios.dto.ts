import {
  BeneficioDestinoModulo,
  BeneficioRedireccion,
} from "./beneficios.model";

export interface CrearBeneficioDTO {
  titulo: string;
  descripcion: string;
  redireccion?: BeneficioRedireccion;
  puntosRecompensa?: number;
  estatus: boolean;
}

export interface ActualizarBeneficioDTO {
  titulo?: string;
  descripcion?: string;
  redireccion?: BeneficioRedireccion;
  puntosRecompensa?: number;
  estatus?: boolean;
}

export type { BeneficioDestinoModulo, BeneficioRedireccion };
