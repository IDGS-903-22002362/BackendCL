import { PatrocinadorLogoVariante } from "./patrocinadores.model";

export interface CrearPatrocinadorDTO {
  nombre: string;
  estatus: boolean;
  exclusivo?: boolean;
  url?: string;
}

export interface ActualizarPatrocinadorDTO {
  nombre?: string;
  estatus?: boolean;
  exclusivo?: boolean;
  url?: string;
}

export type { PatrocinadorLogoVariante };
