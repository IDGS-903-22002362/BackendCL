import { Timestamp } from "firebase-admin/firestore";

export type AdminProductStatusFilter = "activo" | "inactivo" | "todos";

export interface AdminProductsQuery {
  estado: AdminProductStatusFilter;
}

export interface AdminProductListItemDTO {
  id: string;
  clave: string;
  descripcion: string;
  slug: string;
  lineaId: string;
  categoriaId: string;
  precioPublico: number;
  existencias: number;
  disponible: boolean;
  destacado: boolean;
  activo: boolean;
  imagenPrincipal: string | null;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}
