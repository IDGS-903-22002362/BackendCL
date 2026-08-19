/**
 * Totales de una venta POS. Dominio puro: sin Firestore, sin fechas, sin I/O.
 *
 * Orden de aplicación de descuentos (mismo criterio que el checkout ecommerce):
 *
 * 1. precio público del catálogo,
 * 2. oferta automática vigente,
 * 3. código promocional (no combinable con ofertas),
 * 4. descuento manual autorizado, repartido entre líneas.
 *
 * Los impuestos son informativos: los precios del catálogo ya los incluyen, así que
 * `taxMinor` es 0 y se conserva en el modelo para no romper el contrato del ticket ni de los
 * reportes si en el futuro se desglosa IVA.
 */

import PosProblemError from "../errors/pos-problem.error";
import type { PosSaleTotals } from "../models/pos.types";
import { allocateMinor, sumMinor } from "./money";

export interface SaleLineForTotals {
  itemId: string;
  quantity: number;
  unitPriceOriginalMinor: number;
  unitPriceMinor: number;
  offerDiscountMinor: number;
  codeDiscountMinor: number;
}

export interface SaleLineTotalsResult {
  itemId: string;
  manualDiscountMinor: number;
  taxMinor: number;
  lineTotalMinor: number;
}

export interface SaleTotalsResult {
  lines: SaleLineTotalsResult[];
  totals: PosSaleTotals;
}

/**
 * Calcula los totales y el reparto del descuento manual.
 *
 * El descuento manual se distribuye proporcionalmente al importe de cada línea tras ofertas
 * y código, con el método del resto mayor, de modo que la suma de las líneas sea exactamente
 * igual al total y ninguna línea quede en negativo.
 */
export function computeSaleTotals(
  lines: readonly SaleLineForTotals[],
  manualDiscountMinor = 0,
): SaleTotalsResult {
  const subtotalOriginalMinor = sumMinor(
    lines.map((line) => line.unitPriceOriginalMinor * line.quantity),
  );
  const offerDiscountMinor = sumMinor(
    lines.map((line) => line.offerDiscountMinor),
  );
  const codeDiscountMinor = sumMinor(lines.map((line) => line.codeDiscountMinor));

  const afterCodePerLine = lines.map((line) => {
    const value =
      line.unitPriceMinor * line.quantity - line.codeDiscountMinor;
    if (value < 0) {
      throw new PosProblemError(
        "POS_VALIDATION_ERROR",
        "El descuento de una línea no puede exceder su importe.",
      );
    }
    return value;
  });

  const subtotalAfterCodeMinor = sumMinor(afterCodePerLine);
  if (manualDiscountMinor < 0 || manualDiscountMinor > subtotalAfterCodeMinor) {
    throw new PosProblemError(
      "MANUAL_DISCOUNT_LIMIT_EXCEEDED",
      "El descuento manual no puede exceder el importe de la venta.",
    );
  }

  const manualPerLine =
    manualDiscountMinor === 0
      ? lines.map(() => 0)
      : allocateMinor(manualDiscountMinor, afterCodePerLine);

  const resultLines: SaleLineTotalsResult[] = lines.map((line, index) => ({
    itemId: line.itemId,
    manualDiscountMinor: manualPerLine[index],
    taxMinor: 0,
    lineTotalMinor: afterCodePerLine[index] - manualPerLine[index],
  }));

  const subtotalMinor = sumMinor(
    resultLines.map((line) => line.lineTotalMinor),
  );
  const discountMinor =
    offerDiscountMinor + codeDiscountMinor + manualDiscountMinor;

  return {
    lines: resultLines,
    totals: {
      subtotalOriginalMinor,
      offerDiscountMinor,
      codeDiscountMinor,
      manualDiscountMinor,
      discountMinor,
      subtotalMinor,
      taxMinor: 0,
      totalMinor: subtotalMinor,
    },
  };
}

/** Importe pendiente de cobro. Nunca negativo. */
export function pendingAmountMinor(
  totalMinor: number,
  approvedPaidMinor: number,
): number {
  return Math.max(0, totalMinor - approvedPaidMinor);
}
