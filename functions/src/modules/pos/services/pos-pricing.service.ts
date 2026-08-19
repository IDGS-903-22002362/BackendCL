/**
 * Precios del POS.
 *
 * Reutiliza el motor del ecommerce: las ofertas se evalúan con `seleccionarMejorOferta` sobre
 * `ofertasService.listarOfertasActivas()` y los códigos con `codigosPromocionService.validar`.
 * No existe un segundo motor de descuentos.
 *
 * Frontera de unidades (DEC-03): los servicios legacy trabajan en pesos con dos decimales; la
 * conversión a centavos ocurre una sola vez aquí, con `majorToMinor`. Desde este punto todo
 * el POS es entero.
 *
 * Criterio de combinabilidad: igual que el checkout, un código promocional no se combina con
 * ofertas. Si alguna línea tiene oferta aplicada, el código se rechaza con
 * `PROMOTION_CODE_NOT_COMBINABLE` en lugar de acumular dos descuentos.
 */

import { Oferta } from "../../../models/ofertas.model";
import { codigosPromocionService } from "../../../services/codigos-promocion.service";
import { ofertasService } from "../../../services/ofertas.service";
import {
  ProductoOfertaBase,
  seleccionarMejorOferta,
} from "../../../utils/ofertas-pricing.util";
import { majorToMinor, minorToMajor, multiplyMinor } from "../domain/money";
import PosProblemError from "../errors/pos-problem.error";
import type { PosProductSnapshot } from "./pos-inventory.service";

export interface PricedLineInput {
  itemId: string;
  productoId: string;
  tallaId: string | null;
  quantity: number;
}

export interface PricedLine {
  itemId: string;
  productoId: string;
  tallaId: string | null;
  quantity: number;
  unitPriceOriginalMinor: number;
  unitPriceMinor: number;
  offerDiscountMinor: number;
  lineTotalBeforeCodeMinor: number;
  offerId: string | null;
  offerTitle: string | null;
}

export interface CodeDiscountResult {
  codigoPromocionId: string;
  codigo: string;
  titulo: string | null;
  totalDiscountMinor: number;
  /** Descuento por línea, en el mismo orden que las líneas recibidas. */
  perLineMinor: number[];
}

function toOfferBase(product: PosProductSnapshot): ProductoOfertaBase {
  return {
    id: product.productoId,
    precioPublico: product.precioPublicoMajor,
    categoriaId: product.categoriaId ?? null,
    lineaId: product.lineaId ?? null,
    tallaIds: product.tallaIds,
  };
}

class PosPricingService {
  /** Ofertas vigentes. Se cargan una vez por operación y se reutilizan en la transacción. */
  async loadActiveOffers(): Promise<Oferta[]> {
    return ofertasService.listarOfertasActivas();
  }

  /**
   * Precio por línea con ofertas automáticas aplicadas. Función pura respecto a Firestore:
   * recibe productos y ofertas ya cargados, de modo que pueda ejecutarse dentro de una
   * transacción sin lecturas adicionales.
   */
  priceLines(
    lines: readonly PricedLineInput[],
    products: Map<string, PosProductSnapshot>,
    offers: readonly Oferta[],
  ): PricedLine[] {
    return lines.map((line) => {
      const product = products.get(line.productoId);
      if (!product) {
        throw new PosProblemError(
          "PRODUCT_UNAVAILABLE",
          "El producto no existe en el catálogo.",
        );
      }
      if (!product.activo) {
        throw new PosProblemError(
          "PRODUCT_UNAVAILABLE",
          `El producto ${product.clave} está inactivo.`,
        );
      }
      if (product.tallaIds.length > 0 && !line.tallaId) {
        throw new PosProblemError(
          "PRODUCT_UNAVAILABLE",
          `El producto ${product.clave} requiere talla.`,
        );
      }
      if (line.tallaId && !product.tallaIds.includes(line.tallaId)) {
        throw new PosProblemError(
          "PRODUCT_UNAVAILABLE",
          `La talla indicada no aplica a ${product.clave}.`,
        );
      }

      const unitPriceOriginalMinor = majorToMinor(product.precioPublicoMajor);
      if (unitPriceOriginalMinor <= 0) {
        throw new PosProblemError(
          "PRODUCT_UNAVAILABLE",
          `El producto ${product.clave} no tiene precio público válido.`,
        );
      }

      const best = seleccionarMejorOferta(
        [...offers],
        toOfferBase(product),
        line.tallaId ?? undefined,
      );

      const unitPriceMinor = best
        ? majorToMinor(best.precioFinal)
        : unitPriceOriginalMinor;
      const offerDiscountUnitMinor = Math.max(
        0,
        unitPriceOriginalMinor - unitPriceMinor,
      );

      return {
        itemId: line.itemId,
        productoId: line.productoId,
        tallaId: line.tallaId,
        quantity: line.quantity,
        unitPriceOriginalMinor,
        unitPriceMinor,
        offerDiscountMinor: multiplyMinor(offerDiscountUnitMinor, line.quantity),
        lineTotalBeforeCodeMinor: multiplyMinor(unitPriceMinor, line.quantity),
        offerId: best?.oferta.id ?? null,
        offerTitle: best?.oferta.titulo ?? null,
      };
    });
  }

  /**
   * Valida un código promocional contra las líneas ya valuadas con ofertas.
   * El descuento y su reparto los decide el servicio de códigos del ecommerce.
   */
  async validateCode(
    codigo: string,
    lines: readonly PricedLine[],
    products: Map<string, PosProductSnapshot>,
  ): Promise<CodeDiscountResult> {
    if (lines.length === 0) {
      throw new PosProblemError("SALE_EMPTY");
    }
    if (lines.some((line) => line.offerDiscountMinor > 0)) {
      throw new PosProblemError("PROMOTION_CODE_NOT_COMBINABLE");
    }

    const result = await codigosPromocionService.validar({
      codigo,
      items: lines.map((line) => {
        const product = products.get(line.productoId);
        return {
          productoId: line.productoId,
          cantidad: line.quantity,
          precioUnitario: minorToMajor(line.unitPriceMinor),
          categoriaId: product?.categoriaId ?? null,
          lineaId: product?.lineaId ?? null,
          ...(line.tallaId ? { tallaId: line.tallaId } : {}),
        };
      }),
    });

    if (!result.valido || !result.codigoPromocionId) {
      throw new PosProblemError(
        "PROMOTION_CODE_INVALID",
        result.mensaje || "El código promocional no es válido para esta venta.",
      );
    }

    const totalDiscountMinor = majorToMinor(result.descuentoTotal);
    if (totalDiscountMinor <= 0) {
      throw new PosProblemError(
        "PROMOTION_CODE_INVALID",
        "El código no genera descuento en esta venta.",
      );
    }

    // El servicio devuelve un resultado por producto; se reparte por línea respetando el
    // orden y la cantidad, porque una venta puede tener dos líneas del mismo producto.
    const perProductRemaining = new Map<string, number>();
    for (const item of result.items) {
      perProductRemaining.set(
        item.productoId,
        (perProductRemaining.get(item.productoId) ?? 0) +
          majorToMinor(item.descuentoTotal),
      );
    }

    const perLineMinor = lines.map((line) => {
      const remaining = perProductRemaining.get(line.productoId) ?? 0;
      if (remaining <= 0) {
        return 0;
      }
      const lineShare = Math.min(remaining, line.lineTotalBeforeCodeMinor);
      perProductRemaining.set(line.productoId, remaining - lineShare);
      return lineShare;
    });

    const allocated = perLineMinor.reduce((total, value) => total + value, 0);
    if (allocated !== totalDiscountMinor) {
      // Si el reparto no cuadra con el total informado, se usa el reparto por línea: es el
      // único que garantiza que ninguna línea quede con total negativo.
      return {
        codigoPromocionId: result.codigoPromocionId,
        codigo: result.codigo ?? codigo.trim().toUpperCase(),
        titulo: result.codigoTitulo ?? null,
        totalDiscountMinor: allocated,
        perLineMinor,
      };
    }

    return {
      codigoPromocionId: result.codigoPromocionId,
      codigo: result.codigo ?? codigo.trim().toUpperCase(),
      titulo: result.codigoTitulo ?? null,
      totalDiscountMinor,
      perLineMinor,
    };
  }

  /** Registra el uso del código tras confirmar el pago. Best-effort auditado. */
  async registerCodeUsage(codigoPromocionId: string): Promise<void> {
    await codigosPromocionService.registrarUso(codigoPromocionId, 1);
  }
}

export const posPricingService = new PosPricingService();
export default posPricingService;
