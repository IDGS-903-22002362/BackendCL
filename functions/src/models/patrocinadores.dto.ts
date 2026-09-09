import { PatrocinadorLogoVariante } from "./patrocinadores.model";

export interface CrearPatrocinadorDTO {
  nombre: string;
  estatus: boolean;
  exclusivo?: boolean;
}

export interface ActualizarPatrocinadorDTO {
  nombre?: string;
  estatus?: boolean;
  exclusivo?: boolean;
}

export type { PatrocinadorLogoVariante };
