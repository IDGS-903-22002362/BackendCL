export type TipoDescuentoCodigoPromocion = "porcentaje";

export type AplicaCodigoPromocion = "productos" | "categorias" | "lineas";

export interface CodigoPromocion {
  id: string;

  codigo: string;
  titulo: string;
  descripcion?: string | null;

  estado: boolean;

  tipoDescuento: TipoDescuentoCodigoPromocion;
  valorDescuento: number;

  aplicaA: AplicaCodigoPromocion;
  productoIds: string[];
  categoriaIds: string[];
  lineaIds: string[];
  tallaIds: string[];

  fechaInicio: Date;
  fechaFin: Date;

  hastaAgotarExistencias: boolean;
  stockLimiteCodigo: number | null;
  stockUsadoCodigo: number;

  usoMaximoTotal: number | null;
  usosActuales: number;

  usoMaximoPorUsuario: number | null;
  montoMinimoCompra: number | null;

  acumulableConOfertas: boolean;

  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date | null;
  createdBy?: string | null;
  updatedBy?: string | null;
}

export interface CreateCodigoPromocionDto {
  codigo: string;
  titulo: string;
  descripcion?: string | null;

  estado?: boolean;

  tipoDescuento?: TipoDescuentoCodigoPromocion;
  valorDescuento: number;

  aplicaA: AplicaCodigoPromocion;
  productoIds?: string[];
  categoriaIds?: string[];
  lineaIds?: string[];
  tallaIds?: string[];

  fechaInicio: string | Date;
  fechaFin: string | Date;

  hastaAgotarExistencias?: boolean;
  stockLimiteCodigo?: number | null;

  usoMaximoTotal?: number | null;
  usoMaximoPorUsuario?: number | null;
  montoMinimoCompra?: number | null;

  acumulableConOfertas?: boolean;
}

export interface UpdateCodigoPromocionDto {
  codigo?: string;
  titulo?: string;
  descripcion?: string | null;

  estado?: boolean;

  tipoDescuento?: TipoDescuentoCodigoPromocion;
  valorDescuento?: number;

  aplicaA?: AplicaCodigoPromocion;
  productoIds?: string[];
  categoriaIds?: string[];
  lineaIds?: string[];
  tallaIds?: string[];

  fechaInicio?: string | Date;
  fechaFin?: string | Date;

  hastaAgotarExistencias?: boolean;
  stockLimiteCodigo?: number | null;

  usoMaximoTotal?: number | null;
  usoMaximoPorUsuario?: number | null;
  montoMinimoCompra?: number | null;

  acumulableConOfertas?: boolean;
}

export interface CodigoPromocionFilters {
  estado?: boolean;
  codigo?: string;
  aplicaA?: AplicaCodigoPromocion;
  productoId?: string;
  categoriaId?: string;
  lineaId?: string;
  incluirEliminados?: boolean;
}

export interface ItemValidarCodigoPromocionDto {
  productoId: string;
  cantidad: number;
  precioUnitario: number;

  categoriaId?: string | null;
  lineaId?: string | null;
  tallaId?: string | null;
}

export interface ValidarCodigoPromocionDto {
  codigo: string;
  items: ItemValidarCodigoPromocionDto[];

  usuarioId?: string | null;
}

export interface PrecioCodigoPromocionCalculado {
  productoId: string;
  cantidad: number;

  precioOriginal: number;
  precioFinal: number;

  subtotalOriginal: number;
  subtotalFinal: number;

  descuentoUnitario: number;
  descuentoTotal: number;

  codigoAplicadoId: string | null;
  codigoAplicado: string | null;
  codigoTitulo: string | null;
}

export interface ResultadoValidacionCodigoPromocion {
  valido: boolean;
  codigo: string | null;
  mensaje: string;

  codigoPromocionId: string | null;
  codigoTitulo: string | null;

  subtotalOriginal: number;
  subtotalFinal: number;

  descuentoTotal: number;

  items: PrecioCodigoPromocionCalculado[];
}