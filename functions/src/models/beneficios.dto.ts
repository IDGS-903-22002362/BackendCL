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
  /** Solo permite volver un minijuego a beneficio estándar sin borrar su configuración. */
  tipo?: "estandar";
}

export type { BeneficioDestinoModulo, BeneficioRedireccion };
