import {
  AlcanceOferta,
  Oferta,
  TipoDescuento,
} from "../models/ofertas.model";

export interface ProductoOfertaBase {
  id: string;
  precioPublico: number;

  categoriaId?: string | null;
  categoriaIds?: string[];

  lineaId?: string | null;
  lineaIds?: string[];

  /**
   * Tallas del producto. Se usa para evaluar ofertas con alcance por talla
   * cuando NO se evalúa una talla concreta (catálogo/ficha): la oferta aplica si
   * alguna talla del producto califica.
   */
  tallaIds?: string[];
}

export interface OfertaPrecioEvaluada {
  oferta: Oferta;
  precioFinal: number;
  ahorro: number;
}

type FechaCompatible =
  | Date
  | string
  | number
  | {
      toDate: () => Date;
    }
  | null
  | undefined;

function convertirADate(value: FechaCompatible): Date | null {
  if (!value) return null;

  if (value instanceof Date) {
    return value;
  }

  if (typeof value === "string" || typeof value === "number") {
    const fecha = new Date(value);
    return Number.isNaN(fecha.getTime()) ? null : fecha;
  }

  if (typeof value.toDate === "function") {
    return value.toDate();
  }

  return null;
}

export function redondearPrecio(value: number): number {
  return Math.round(value * 100) / 100;
}

export function calcularPrecioFinal(
  precioPublico: number,
  tipoDescuento: TipoDescuento,
  valorDescuento: number
): number {
  let precioCalculado = precioPublico;

  if (tipoDescuento === "precio_fijo") {
    precioCalculado = valorDescuento;
  }

  if (tipoDescuento === "porcentaje") {
    precioCalculado = precioPublico - (precioPublico * valorDescuento) / 100;
  }

  if (tipoDescuento === "monto") {
    precioCalculado = precioPublico - valorDescuento;
  }

  const precioProtegido = Math.max(0, precioCalculado);

  return redondearPrecio(precioProtegido);
}

export function tieneStockOferta(oferta: Oferta): boolean {
  const stockLimiteOferta = oferta.stockLimiteOferta;

  if (typeof stockLimiteOferta !== "number") {
    return true;
  }

  const stockVendido =
    typeof oferta.stockVendidoOferta === "number"
      ? oferta.stockVendidoOferta
      : 0;

  return stockVendido < stockLimiteOferta;
}

export function esOfertaVigente(
  oferta: Oferta,
  fechaReferencia: Date = new Date()
): boolean {
  if (!oferta.estado) {
    return false;
  }

  const fechaInicio = convertirADate(oferta.fechaInicio);
  const fechaFin = convertirADate(oferta.fechaFin);

  if (!fechaInicio || !fechaFin) {
    return false;
  }

  const ahora = fechaReferencia.getTime();

  return ahora >= fechaInicio.getTime() && ahora <= fechaFin.getTime();
}

/**
 * Busca, dentro de un conjunto de ofertas ya existentes, una oferta vigente que
 * cubra el producto indicado por alcance "productos". Se usa para impedir que un
 * mismo producto quede cubierto por más de una oferta activa a la vez.
 *
 * - Solo considera ofertas con alcance `aplicaA === "productos"` que listan el
 *   producto en `productoIds` (caso documentado y soportado).
 * - Excluye la propia oferta cuando se está editando (`ofertaIdActual`).
 * - Reutiliza `esOfertaVigente` para mantener el mismo criterio de
 *   estado + vigencia que el resto del sistema.
 */
export function encontrarOfertaActivaEnConflicto(
  productoId: string,
  ofertasExistentes: Oferta[],
  opciones: { ofertaIdActual?: string; fechaReferencia?: Date } = {}
): Oferta | null {
  const { ofertaIdActual, fechaReferencia } = opciones;

  if (!productoId) {
    return null;
  }

  const conflicto = ofertasExistentes.find(
    (oferta) =>
      oferta.id !== ofertaIdActual &&
      !oferta.deletedAt &&
      oferta.aplicaA === "productos" &&
      Array.isArray(oferta.productoIds) &&
      oferta.productoIds.includes(productoId) &&
      esOfertaVigente(oferta, fechaReferencia)
  );

  return conflicto ?? null;
}

export function puedeEliminarOferta(
  oferta: Pick<Oferta, "estado" | "fechaInicio" | "fechaFin">,
  fechaReferencia: Date = new Date(),
): boolean {
  if (!oferta.estado) {
    return true;
  }

  const fechaFin = convertirADate(oferta.fechaFin);

  if (fechaFin && fechaReferencia.getTime() > fechaFin.getTime()) {
    return true;
  }

  return false;
}

function contieneId(
  lista: string[] | undefined,
  id: string | null | undefined
): boolean {
  if (!id) return false;
  return Array.isArray(lista) && lista.includes(id);
}

function contieneAlgunId(
  listaOferta: string[] | undefined,
  listaProducto: string[] | undefined
): boolean {
  if (!Array.isArray(listaOferta) || !Array.isArray(listaProducto)) {
    return false;
  }

  return listaProducto.some((id) => listaOferta.includes(id));
}

export function esOfertaAplicableATalla(
  oferta: Oferta,
  tallaId?: string
): boolean {
  const tallaIds = oferta.tallaIds ?? [];

  if (tallaIds.length === 0) {
    return true;
  }

  if (!tallaId) {
    return false;
  }

  return tallaIds.includes(tallaId);
}

/**
 * Evalúa si una oferta con alcance por talla aplica a un producto.
 *
 * - Si la oferta no restringe tallas, aplica siempre.
 * - Si se pasa una talla concreta (línea de carrito/checkout), se valida de forma
 *   estricta que esa talla esté incluida en la oferta.
 * - Si NO se pasa talla (catálogo/ficha, donde aún no se eligió una talla), la
 *   oferta aplica cuando alguna de las tallas del producto califica.
 */
export function esOfertaAplicableATallaProducto(
  oferta: Oferta,
  producto: ProductoOfertaBase,
  tallaId?: string
): boolean {
  const ofertaTallaIds = oferta.tallaIds ?? [];

  if (ofertaTallaIds.length === 0) {
    return true;
  }

  if (tallaId) {
    return ofertaTallaIds.includes(tallaId);
  }

  const productoTallaIds = producto.tallaIds ?? [];

  if (productoTallaIds.length === 0) {
    return false;
  }

  return productoTallaIds.some((talla) => ofertaTallaIds.includes(talla));
}

export function esOfertaAplicableAProducto(
  oferta: Oferta,
  producto: ProductoOfertaBase
): boolean {
  const alcance: AlcanceOferta = oferta.aplicaA;

  if (alcance === "todo") {
    return true;
  }

  if (alcance === "productos") {
    return contieneId(oferta.productoIds, producto.id);
  }

  if (alcance === "categorias") {
    return (
      contieneId(oferta.categoriaIds, producto.categoriaId) ||
      contieneAlgunId(oferta.categoriaIds, producto.categoriaIds)
    );
  }

  if (alcance === "lineas") {
    return (
      contieneId(oferta.lineaIds, producto.lineaId) ||
      contieneAlgunId(oferta.lineaIds, producto.lineaIds)
    );
  }

  return false;
}

export function evaluarOfertaParaProducto(
  oferta: Oferta,
  producto: ProductoOfertaBase,
  tallaId?: string
): OfertaPrecioEvaluada | null {
  if (!esOfertaVigente(oferta)) {
    return null;
  }

  if (!tieneStockOferta(oferta)) {
    return null;
  }

  if (!esOfertaAplicableAProducto(oferta, producto)) {
    return null;
  }

  if (!esOfertaAplicableATallaProducto(oferta, producto, tallaId)) {
    return null;
  }

  const precioFinal = calcularPrecioFinal(
    producto.precioPublico,
    oferta.tipoDescuento,
    oferta.valorDescuento
  );

  const ahorro = redondearPrecio(producto.precioPublico - precioFinal);

  if (ahorro <= 0) {
    return null;
  }

  return {
    oferta,
    precioFinal,
    ahorro,
  };
}

export function seleccionarMejorOferta(
  ofertas: Oferta[],
  producto: ProductoOfertaBase,
  tallaId?: string
): OfertaPrecioEvaluada | null {
  const ofertasValidas = ofertas
    .map((oferta) => evaluarOfertaParaProducto(oferta, producto, tallaId))
    .filter((resultado): resultado is OfertaPrecioEvaluada => resultado !== null);

  if (ofertasValidas.length === 0) {
    return null;
  }

  ofertasValidas.sort((a, b) => {
    if (b.oferta.prioridad !== a.oferta.prioridad) {
      return b.oferta.prioridad - a.oferta.prioridad;
    }

    return a.precioFinal - b.precioFinal;
  });

  return ofertasValidas[0];
}

export function calcularSubtotal(
  precioUnitario: number,
  cantidad: number
): number {
  return redondearPrecio(precioUnitario * cantidad);
}