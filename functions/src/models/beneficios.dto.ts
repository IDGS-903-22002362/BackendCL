export interface CrearBeneficioDTO {
  titulo: string;
  descripcion: string;
  estatus: boolean;
}

export interface ActualizarBeneficioDTO {
  titulo?: string;
  descripcion?: string;
  estatus?: boolean;
}