export interface Beneficio {
  id: string;
  titulo: string;
  descripcion: string;
  imagen?: string;
  estatus: boolean;
  createdAt: Date;
  updatedAt: Date;
}