export interface CrearBeneficioDTO {
  titulo: string;
  descripcion: string;
  imagen?: string;
  estatus: boolean;
}

export interface ActualizarBeneficioDTO {
  titulo?: string;
  descripcion?: string;
  imagen?: string;
  estatus?: boolean;
}