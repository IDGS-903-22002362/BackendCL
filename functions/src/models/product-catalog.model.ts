export type CatalogSort =
  | "destacados"
  | "populares"
  | "mas_comprados"
  | "precio_asc"
  | "precio_desc"
  | "recientes"
  | "nombre_asc"
  | "ofertas_populares"
  | "ofertas_mas_compradas"
  | "ofertas_recientes";

export interface CatalogQuery {
  limit: number;
  cursor?: string;
  category?: string;
  categoria?: string;
  line?: string;
  linea?: string;
  talla?: string;
  minPrice?: number;
  maxPrice?: number;
  sort: CatalogSort;
  q?: string;
  onlyOffers: boolean;
  onlyAvailable: boolean;
}

export interface CatalogCursor {
  v: 1;
  sort: CatalogSort;
  filters: {
    category?: string;
    line?: string;
    talla?: string;
    minPrice?: number;
    maxPrice?: number;
    q?: string;
    onlyOffers: boolean;
    onlyAvailable: boolean;
  };
  last: {
    value: string | number | boolean | null;
    id: string;
  };
}

export interface CatalogProductCardDTO {
  id: string;
  slug: string;
  nombre: string;
  categoria: string;
  categoriaLabel: string;
  linea: string;
  lineaLabel: string;
  precioOriginal: number;
  precioFinal: number;
  tieneOferta: boolean;
  ofertaAplicadaId: string | null;
  ofertaTitulo: string | null;
  descuentoTotal: number;
  porcentajeDescuento: number;
  imagenPrincipal: string | null;
  imagenes?: string[];
  stockTotal: number;
  /** Stock físico en almacén (puede ser > stockTotal si hay reservas activas). */
  stockFisico: number;
  disponible: boolean;
  destacado: boolean;
}

export interface CatalogResponse {
  items: CatalogProductCardDTO[];
  nextCursor: string | null;
  hasMore: boolean;
}
