export type PatrocinadorLogoVariante = "blanca" | "negra" | "exclusiva";

export interface Patrocinador {
  id: string;
  nombre: string;
  imagenBlanca?: string;
  imagenNegra?: string;
  /** Logo unico del patrocinador exclusivo, o logo legado. */
  imagen?: string;
  exclusivo: boolean;
  estatus: boolean;
  createdAt: Date;
  updatedAt: Date;
}
