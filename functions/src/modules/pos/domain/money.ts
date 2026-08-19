/**
 * Aritmética monetaria del POS: enteros en centavos MXN.
 *
 * Ninguna función usa `toFixed()` ni acumula flotantes. La única frontera con pesos es la
 * conversión explícita con los servicios legacy de pricing (`majorToMinor`).
 */

import PosProblemError from "../errors/pos-problem.error";

/** Máximo representable con seguridad como entero en centavos (~90 mil millones de pesos). */
export const MAX_MINOR = Number.MAX_SAFE_INTEGER;

export function isValidMinor(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    Math.abs(value) <= MAX_MINOR
  );
}

export function assertMinor(value: unknown, field: string): number {
  if (!isValidMinor(value)) {
    throw new PosProblemError(
      "POS_VALIDATION_ERROR",
      `El campo ${field} debe ser un entero de centavos válido.`,
    );
  }
  return value;
}

export function assertNonNegativeMinor(value: unknown, field: string): number {
  const parsed = assertMinor(value, field);
  if (parsed < 0) {
    throw new PosProblemError(
      "POS_VALIDATION_ERROR",
      `El campo ${field} no puede ser negativo.`,
    );
  }
  return parsed;
}

/**
 * Convierte pesos (float) a centavos (entero).
 *
 * Se usa exclusivamente para adaptar la salida de los servicios de pricing del ecommerce,
 * que trabajan en pesos con dos decimales. `Math.round` sobre el valor escalado evita el
 * error clásico de `0.145 * 100`.
 */
export function majorToMinor(pesos: number): number {
  if (!Number.isFinite(pesos)) {
    throw new PosProblemError(
      "POS_VALIDATION_ERROR",
      "Importe en pesos inválido al convertir a centavos.",
    );
  }
  return Math.round((pesos + Number.EPSILON) * 100);
}

/** Convierte centavos a pesos. Solo para presentación o para llamar servicios legacy. */
export function minorToMajor(minor: number): number {
  return assertMinor(minor, "minor") / 100;
}

export function sumMinor(values: readonly number[]): number {
  let total = 0;
  for (const value of values) {
    total += assertMinor(value, "monto");
  }
  return total;
}

export function multiplyMinor(unitMinor: number, quantity: number): number {
  assertMinor(unitMinor, "unitMinor");
  if (!Number.isInteger(quantity) || quantity < 0) {
    throw new PosProblemError(
      "POS_VALIDATION_ERROR",
      "La cantidad debe ser un entero no negativo.",
    );
  }
  return unitMinor * quantity;
}

/** Aplica un porcentaje entero o decimal a un importe, redondeando al centavo más cercano. */
export function percentOfMinor(amountMinor: number, percent: number): number {
  assertMinor(amountMinor, "amountMinor");
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
    throw new PosProblemError(
      "POS_VALIDATION_ERROR",
      "El porcentaje debe estar entre 0 y 100.",
    );
  }
  return Math.round((amountMinor * percent) / 100);
}

export function clampMinor(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Reparte un importe entre pesos relativos sin perder ni inventar centavos.
 *
 * Usa el método del resto mayor: primero el suelo de cada parte, luego distribuye los
 * centavos restantes a los residuos más grandes (empates por orden estable).
 */
export function allocateMinor(
  totalMinor: number,
  weights: readonly number[],
): number[] {
  assertNonNegativeMinor(totalMinor, "totalMinor");
  if (weights.length === 0) {
    if (totalMinor !== 0) {
      throw new PosProblemError(
        "POS_VALIDATION_ERROR",
        "No hay destinos para repartir el importe.",
      );
    }
    return [];
  }

  const totalWeight = weights.reduce((acc, weight) => {
    if (!Number.isFinite(weight) || weight < 0) {
      throw new PosProblemError(
        "POS_VALIDATION_ERROR",
        "Los pesos de reparto deben ser números no negativos.",
      );
    }
    return acc + weight;
  }, 0);

  if (totalWeight === 0) {
    const equal = Math.floor(totalMinor / weights.length);
    const parts = weights.map(() => equal);
    let remainder = totalMinor - equal * weights.length;
    for (let index = 0; remainder > 0; index = (index + 1) % weights.length) {
      parts[index] += 1;
      remainder -= 1;
    }
    return parts;
  }

  const exact = weights.map((weight) => (totalMinor * weight) / totalWeight);
  const floors = exact.map((value) => Math.floor(value));
  let remainder = totalMinor - floors.reduce((acc, value) => acc + value, 0);

  const order = exact
    .map((value, index) => ({ index, residue: value - floors[index] }))
    .sort((a, b) => b.residue - a.residue || a.index - b.index);

  for (const entry of order) {
    if (remainder <= 0) break;
    floors[entry.index] += 1;
    remainder -= 1;
  }

  return floors;
}

export function formatMinorAsMxn(minor: number): string {
  const sign = minor < 0 ? "-" : "";
  const absolute = Math.abs(assertMinor(minor, "minor"));
  const pesos = Math.floor(absolute / 100);
  const cents = absolute % 100;
  const groupedPesos = String(pesos).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}$${groupedPesos}.${String(cents).padStart(2, "0")}`;
}
