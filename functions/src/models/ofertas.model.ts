export type TipoDescuento =
  | "precio_fijo"
  | "porcentaje"
  | "monto";

export type AlcanceOferta =
  | "productos"
  | "categorias"
  | "lineas"
  | "todo";

export interface Oferta {
  id: string;

  titulo: string;
  descripcion?: string;

  estado: boolean;
  tallaIds?: string[];

  tipoDescuento: TipoDescuento;
  valorDescuento: number;

  aplicaA: AlcanceOferta;

  productoIds?: string[];
  categoriaIds?: string[];
  lineaIds?: string[];

  fechaInicio: Date;
  fechaFin: Date;

  hastaAgotarExistencias: boolean;
  stockLimiteOferta?: number | null;
  stockVendidoOferta: number;

  prioridad: number;
  combinable: boolean;

  badgeTexto?: string;
  mostrarBadge: boolean;

  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date | null;

  createdBy?: string;
  updatedBy?: string;
}

export interface CreateOfertaDto {
  titulo: string;
  descripcion?: string;

  estado?: boolean;
  tallaIds?: string[];

  tipoDescuento: TipoDescuento;
  valorDescuento: number;

  aplicaA: AlcanceOferta;

  productoIds?: string[];
  categoriaIds?: string[];
  lineaIds?: string[];

  fechaInicio: string;
  fechaFin: string;

  hastaAgotarExistencias?: boolean;
  stockLimiteOferta?: number | null;

  prioridad?: number;
  combinable?: boolean;

  badgeTexto?: string;
  mostrarBadge?: boolean;
}

export interface UpdateOfertaDto {
  titulo?: string;
  descripcion?: string;

  estado?: boolean;
  tallaIds?: string[];

  tipoDescuento?: TipoDescuento;
  valorDescuento?: number;

  aplicaA?: AlcanceOferta;

  productoIds?: string[];
  categoriaIds?: string[];
  lineaIds?: string[];

  fechaInicio?: string;
  fechaFin?: string;

  hastaAgotarExistencias?: boolean;
  stockLimiteOferta?: number | null;

  prioridad?: number;
  combinable?: boolean;

  badgeTexto?: string;
  mostrarBadge?: boolean;
}

export interface CalcularPrecioOfertaItemDto {
  productoId: string;
  cantidad: number;
  tallaId?: string;
}

export interface CalcularPreciosOfertaDto {
  items: CalcularPrecioOfertaItemDto[];
}

export interface PrecioOfertaCalculado {
  productoId: string;
  cantidad: number;

  precioOriginal: number;
  precioFinal: number;

  subtotalOriginal: number;
  subtotalFinal: number;

  ofertaAplicadaId?: string | null;
  ofertaTitulo?: string | null;
}

export interface ResultadoCalculoOfertas {
  items: PrecioOfertaCalculado[];

  subtotalOriginal: number;
  subtotalFinal: number;
  ahorroTotal: number;
}