import type {
  CodigoPromocion,
  ItemValidarCodigoPromocionDto,
  PrecioCodigoPromocionCalculado,
  ResultadoValidacionCodigoPromocion,
} from "../models/codigos-promocion.model";

function redondearPrecio(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function normalizarCodigoPromocion(codigo: string): string {
  return codigo.trim().toUpperCase();
}

export function toDateValue(value: unknown): Date | null {
  if (!value) return null;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  if (
    typeof value === "object" &&
    value !== null &&
    "toDate" in value &&
    typeof (value as { toDate?: unknown }).toDate === "function"
  ) {
    const date = (value as { toDate: () => Date }).toDate();
    return Number.isNaN(date.getTime()) ? null : date;
  }

  return null;
}

export function esCodigoPromocionVigente(
  codigoPromocion: CodigoPromocion,
  now = new Date(),
): boolean {
  if (!codigoPromocion.estado) return false;
  if (codigoPromocion.deletedAt) return false;

  const fechaInicio = toDateValue(codigoPromocion.fechaInicio);
  const fechaFin = toDateValue(codigoPromocion.fechaFin);

  if (!fechaInicio || !fechaFin) return false;

  return fechaInicio <= now && fechaFin >= now;
}

export function puedeEliminarCodigoPromocion(
  codigoPromocion: Pick<CodigoPromocion, "estado" | "fechaInicio" | "fechaFin">,
  now = new Date(),
): boolean {
  if (!codigoPromocion.estado) {
    return true;
  }

  const fechaFin = toDateValue(codigoPromocion.fechaFin);

  if (fechaFin && now.getTime() > fechaFin.getTime()) {
    return true;
  }

  return false;
}

export function tieneStockCodigoPromocion(
  codigoPromocion: CodigoPromocion,
): boolean {
  if (codigoPromocion.hastaAgotarExistencias) return true;

  const stockLimite = codigoPromocion.stockLimiteCodigo;

  if (typeof stockLimite !== "number") return true;

  const stockUsado =
    typeof codigoPromocion.stockUsadoCodigo === "number"
      ? codigoPromocion.stockUsadoCodigo
      : 0;

  return stockUsado < stockLimite;
}

export function obtenerStockRestanteCodigoPromocion(
  codigoPromocion: CodigoPromocion,
): number | null {
  if (codigoPromocion.hastaAgotarExistencias) return null;

  const stockLimite = codigoPromocion.stockLimiteCodigo;

  if (typeof stockLimite !== "number") return null;

  const stockUsado =
    typeof codigoPromocion.stockUsadoCodigo === "number"
      ? codigoPromocion.stockUsadoCodigo
      : 0;

  return Math.max(stockLimite - stockUsado, 0);
}

export function tieneUsosDisponiblesCodigoPromocion(
  codigoPromocion: CodigoPromocion,
): boolean {
  const usoMaximoTotal = codigoPromocion.usoMaximoTotal;

  if (typeof usoMaximoTotal !== "number") return true;

  const usosActuales =
    typeof codigoPromocion.usosActuales === "number"
      ? codigoPromocion.usosActuales
      : 0;

  return usosActuales < usoMaximoTotal;
}

function getItemCategoriaIds(
  item: ItemValidarCodigoPromocionDto & { categoriaIds?: string[] },
): string[] {
  const ids = new Set<string>();

  if (typeof item.categoriaId === "string" && item.categoriaId.trim()) {
    ids.add(item.categoriaId.trim());
  }

  if (Array.isArray(item.categoriaIds)) {
    for (const categoriaId of item.categoriaIds) {
      if (typeof categoriaId === "string" && categoriaId.trim()) {
        ids.add(categoriaId.trim());
      }
    }
  }

  return [...ids];
}

function getItemLineaIds(
  item: ItemValidarCodigoPromocionDto & { lineaIds?: string[] },
): string[] {
  const ids = new Set<string>();

  if (typeof item.lineaId === "string" && item.lineaId.trim()) {
    ids.add(item.lineaId.trim());
  }

  if (Array.isArray(item.lineaIds)) {
    for (const lineaId of item.lineaIds) {
      if (typeof lineaId === "string" && lineaId.trim()) {
        ids.add(lineaId.trim());
      }
    }
  }

  return [...ids];
}

export function codigoPromocionAplicaAItem(
  codigoPromocion: CodigoPromocion,
  item: ItemValidarCodigoPromocionDto & {
    categoriaIds?: string[];
    lineaIds?: string[];
  },
): boolean {
  if (codigoPromocion.tallaIds.length > 0) {
    if (!item.tallaId) return false;
    if (!codigoPromocion.tallaIds.includes(item.tallaId)) return false;
  }

  if (codigoPromocion.aplicaA === "productos") {
    return codigoPromocion.productoIds.includes(item.productoId);
  }

  if (codigoPromocion.aplicaA === "categorias") {
    const itemCategoriaIds = getItemCategoriaIds(item);

    if (itemCategoriaIds.length === 0) return false;

    return itemCategoriaIds.some((categoriaId) =>
      codigoPromocion.categoriaIds.includes(categoriaId),
    );
  }

  if (codigoPromocion.aplicaA === "lineas") {
    const itemLineaIds = getItemLineaIds(item);

    if (itemLineaIds.length === 0) return false;

    return itemLineaIds.some((lineaId) =>
      codigoPromocion.lineaIds.includes(lineaId),
    );
  }

  return false;
}

export function calcularPrecioFinalCodigoPromocion(
  precioUnitario: number,
  valorDescuento: number,
): {
  precioOriginal: number;
  precioFinal: number;
  descuentoUnitario: number;
} {
  const precioOriginal = redondearPrecio(precioUnitario);

  const descuentoUnitario = redondearPrecio(
    precioOriginal * (valorDescuento / 100),
  );

  const precioFinal = redondearPrecio(
    Math.max(precioOriginal - descuentoUnitario, 0),
  );

  return {
    precioOriginal,
    precioFinal,
    descuentoUnitario: redondearPrecio(precioOriginal - precioFinal),
  };
}

export function calcularSubtotalCodigoPromocion(
  precioUnitario: number,
  cantidad: number,
): number {
  return redondearPrecio(precioUnitario * cantidad);
}

export function calcularCantidadElegibleCodigoPromocion(
  codigoPromocion: CodigoPromocion,
  items: ItemValidarCodigoPromocionDto[],
): number {
  return items.reduce((total, item) => {
    if (!codigoPromocionAplicaAItem(codigoPromocion, item)) {
      return total;
    }

    return total + item.cantidad;
  }, 0);
}

export function calcularPreciosConCodigoPromocion(
  codigoPromocion: CodigoPromocion,
  items: ItemValidarCodigoPromocionDto[],
): ResultadoValidacionCodigoPromocion {
  const codigoNormalizado = normalizarCodigoPromocion(codigoPromocion.codigo);

  if (!esCodigoPromocionVigente(codigoPromocion)) {
    return {
      valido: false,
      codigo: codigoNormalizado,
      mensaje: "El código promocional no está vigente.",
      codigoPromocionId: codigoPromocion.id,
      codigoTitulo: codigoPromocion.titulo,
      subtotalOriginal: 0,
      subtotalFinal: 0,
      descuentoTotal: 0,
      items: [],
    };
  }

  if (!tieneStockCodigoPromocion(codigoPromocion)) {
    return {
      valido: false,
      codigo: codigoNormalizado,
      mensaje: "El código promocional ya no tiene stock disponible.",
      codigoPromocionId: codigoPromocion.id,
      codigoTitulo: codigoPromocion.titulo,
      subtotalOriginal: 0,
      subtotalFinal: 0,
      descuentoTotal: 0,
      items: [],
    };
  }

  if (!tieneUsosDisponiblesCodigoPromocion(codigoPromocion)) {
    return {
      valido: false,
      codigo: codigoNormalizado,
      mensaje: "El código promocional alcanzó su límite de usos.",
      codigoPromocionId: codigoPromocion.id,
      codigoTitulo: codigoPromocion.titulo,
      subtotalOriginal: 0,
      subtotalFinal: 0,
      descuentoTotal: 0,
      items: [],
    };
  }

  const cantidadElegible = calcularCantidadElegibleCodigoPromocion(
    codigoPromocion,
    items,
  );

  if (cantidadElegible <= 0) {
    return {
      valido: false,
      codigo: codigoNormalizado,
      mensaje: "El código no aplica a los productos del carrito.",
      codigoPromocionId: codigoPromocion.id,
      codigoTitulo: codigoPromocion.titulo,
      subtotalOriginal: calcularSubtotalOriginalItems(items),
      subtotalFinal: calcularSubtotalOriginalItems(items),
      descuentoTotal: 0,
      items: construirItemsSinDescuento(items),
    };
  }

  const stockRestante = obtenerStockRestanteCodigoPromocion(codigoPromocion);

  if (typeof stockRestante === "number" && cantidadElegible > stockRestante) {
    return {
      valido: false,
      codigo: codigoNormalizado,
      mensaje: `El código solo tiene ${stockRestante} pieza(s) disponibles para descuento.`,
      codigoPromocionId: codigoPromocion.id,
      codigoTitulo: codigoPromocion.titulo,
      subtotalOriginal: calcularSubtotalOriginalItems(items),
      subtotalFinal: calcularSubtotalOriginalItems(items),
      descuentoTotal: 0,
      items: construirItemsSinDescuento(items),
    };
  }

  const calculatedItems: PrecioCodigoPromocionCalculado[] = items.map((item) => {
    const aplicaCodigo = codigoPromocionAplicaAItem(codigoPromocion, item);

    if (!aplicaCodigo) {
      const subtotalOriginal = calcularSubtotalCodigoPromocion(
        item.precioUnitario,
        item.cantidad,
      );

      return {
        productoId: item.productoId,
        cantidad: item.cantidad,
        precioOriginal: redondearPrecio(item.precioUnitario),
        precioFinal: redondearPrecio(item.precioUnitario),
        subtotalOriginal,
        subtotalFinal: subtotalOriginal,
        descuentoUnitario: 0,
        descuentoTotal: 0,
        codigoAplicadoId: null,
        codigoAplicado: null,
        codigoTitulo: null,
      };
    }

    const { precioOriginal, precioFinal, descuentoUnitario } =
      calcularPrecioFinalCodigoPromocion(
        item.precioUnitario,
        codigoPromocion.valorDescuento,
      );

    const subtotalOriginal = calcularSubtotalCodigoPromocion(
      precioOriginal,
      item.cantidad,
    );

    const subtotalFinal = calcularSubtotalCodigoPromocion(
      precioFinal,
      item.cantidad,
    );

    return {
      productoId: item.productoId,
      cantidad: item.cantidad,
      precioOriginal,
      precioFinal,
      subtotalOriginal,
      subtotalFinal,
      descuentoUnitario,
      descuentoTotal: redondearPrecio(subtotalOriginal - subtotalFinal),
      codigoAplicadoId: codigoPromocion.id,
      codigoAplicado: codigoNormalizado,
      codigoTitulo: codigoPromocion.titulo,
    };
  });

  const subtotalOriginal = redondearPrecio(
    calculatedItems.reduce((total, item) => total + item.subtotalOriginal, 0),
  );

  const subtotalFinal = redondearPrecio(
    calculatedItems.reduce((total, item) => total + item.subtotalFinal, 0),
  );

  const descuentoTotal = redondearPrecio(subtotalOriginal - subtotalFinal);

  return {
    valido: descuentoTotal > 0,
    codigo: codigoNormalizado,
    mensaje:
      descuentoTotal > 0
        ? "Código aplicado correctamente."
        : "El código no generó descuento en el carrito.",
    codigoPromocionId: codigoPromocion.id,
    codigoTitulo: codigoPromocion.titulo,
    subtotalOriginal,
    subtotalFinal,
    descuentoTotal,
    items: calculatedItems,
  };
}

export function calcularSubtotalOriginalItems(
  items: ItemValidarCodigoPromocionDto[],
): number {
  return redondearPrecio(
    items.reduce(
      (total, item) => total + item.precioUnitario * item.cantidad,
      0,
    ),
  );
}

export function construirItemsSinDescuento(
  items: ItemValidarCodigoPromocionDto[],
): PrecioCodigoPromocionCalculado[] {
  return items.map((item) => {
    const precioOriginal = redondearPrecio(item.precioUnitario);
    const subtotalOriginal = calcularSubtotalCodigoPromocion(
      precioOriginal,
      item.cantidad,
    );

    return {
      productoId: item.productoId,
      cantidad: item.cantidad,
      precioOriginal,
      precioFinal: precioOriginal,
      subtotalOriginal,
      subtotalFinal: subtotalOriginal,
      descuentoUnitario: 0,
      descuentoTotal: 0,
      codigoAplicadoId: null,
      codigoAplicado: null,
      codigoTitulo: null,
    };
  });
}