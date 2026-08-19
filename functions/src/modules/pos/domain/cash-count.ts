/**
 * Arqueo por denominaciones o por total declarado.
 *
 * Si el cliente envía denominaciones, el backend recalcula el total desde las piezas.
 * Si solo envía `countedCashMinor`, se acepta ese entero (nunca totales de venta).
 */

import PosProblemError from "../errors/pos-problem.error";
import type { PosCashCountDenomination } from "../models/pos.types";

export interface DenominationInput {
  denominationMinor: number;
  pieces: number;
}

export interface CashCountComputation {
  denominations: PosCashCountDenomination[];
  countedCashMinor: number;
}

const MAX_PIECES_PER_DENOMINATION = 10_000;

/**
 * Resuelve el efectivo contado: preferir denominaciones recalculadas; si no hay,
 * aceptar un total entero no negativo en centavos.
 */
export function resolveCountedCash(input: {
  denominations?: readonly DenominationInput[];
  countedCashMinor?: number;
  allowedDenominationsMinor: readonly number[];
}): CashCountComputation {
  const hasDenoms = (input.denominations?.length ?? 0) > 0;
  if (hasDenoms) {
    return computeCashCount(
      input.denominations!,
      input.allowedDenominationsMinor,
    );
  }
  if (
    typeof input.countedCashMinor === "number" &&
    Number.isInteger(input.countedCashMinor) &&
    input.countedCashMinor >= 0
  ) {
    return { denominations: [], countedCashMinor: input.countedCashMinor };
  }
  throw new PosProblemError(
    "POS_VALIDATION_ERROR",
    "Envía el efectivo contado o un desglose por denominaciones.",
  );
}

/**
 * Valida las denominaciones contra el catálogo configurado y recalcula subtotales y total.
 *
 * Reglas: denominación conocida, piezas enteras no negativas, sin duplicados, y al menos
 * una denominación declarada (un conteo de cero se expresa con piezas en 0).
 */
export function computeCashCount(
  input: readonly DenominationInput[],
  allowedDenominationsMinor: readonly number[],
): CashCountComputation {
  if (input.length === 0) {
    throw new PosProblemError(
      "POS_VALIDATION_ERROR",
      "El conteo debe incluir al menos una denominación.",
    );
  }

  const allowed = new Set(allowedDenominationsMinor);
  const seen = new Set<number>();
  const denominations: PosCashCountDenomination[] = [];
  let countedCashMinor = 0;

  for (const entry of input) {
    if (!Number.isInteger(entry.denominationMinor) || entry.denominationMinor <= 0) {
      throw new PosProblemError(
        "POS_VALIDATION_ERROR",
        "Cada denominación debe ser un entero positivo de centavos.",
      );
    }
    if (!allowed.has(entry.denominationMinor)) {
      throw new PosProblemError(
        "POS_VALIDATION_ERROR",
        `La denominación ${entry.denominationMinor} no está configurada para este establecimiento.`,
      );
    }
    if (seen.has(entry.denominationMinor)) {
      throw new PosProblemError(
        "POS_VALIDATION_ERROR",
        `La denominación ${entry.denominationMinor} está duplicada en el conteo.`,
      );
    }
    if (
      !Number.isInteger(entry.pieces) ||
      entry.pieces < 0 ||
      entry.pieces > MAX_PIECES_PER_DENOMINATION
    ) {
      throw new PosProblemError(
        "POS_VALIDATION_ERROR",
        `El número de piezas debe ser un entero entre 0 y ${MAX_PIECES_PER_DENOMINATION}.`,
      );
    }

    seen.add(entry.denominationMinor);
    const subtotalMinor = entry.denominationMinor * entry.pieces;
    countedCashMinor += subtotalMinor;
    denominations.push({
      denominationMinor: entry.denominationMinor,
      pieces: entry.pieces,
      subtotalMinor,
    });
  }

  denominations.sort((a, b) => b.denominationMinor - a.denominationMinor);

  return { denominations, countedCashMinor };
}

/**
 * Diferencia de arqueo: contado − esperado.
 *
 * Cero = sin diferencia. Positivo = sobrante. Negativo = faltante.
 */
export function cashDifferenceMinor(
  countedCashMinor: number,
  expectedCashMinor: number,
): number {
  return countedCashMinor - expectedCashMinor;
}
