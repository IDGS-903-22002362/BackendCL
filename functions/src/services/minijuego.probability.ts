/**
 * Probabilidades porcentuales de los premios de minijuegos.
 *
 * Representación interna: unidades enteras con precisión de 0.001 %.
 *   1 unidad   = 0.001 %
 *   300        = 0.3 %
 *   100_000    = 100 %
 *
 * Trabajar con enteros evita errores de punto flotante al validar que la
 * suma sea exactamente 100 % y permite sortear con crypto.randomInt sin
 * redondeos ni sesgos.
 */

export const PROBABILITY_DECIMALS = 3;
export const PROBABILITY_SCALE = 10 ** PROBABILITY_DECIMALS;
export const PROBABILITY_TOTAL_UNITS = 100 * PROBABILITY_SCALE;

const SCALE_TOLERANCE = 1e-6;

/**
 * Convierte un porcentaje (p. ej. 0.3) a unidades enteras (300).
 * Devuelve null si no es finito, está fuera de [0, 100] o tiene más de
 * PROBABILITY_DECIMALS decimales.
 */
export function percentToUnits(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value < 0 || value > 100) return null;
  const scaled = value * PROBABILITY_SCALE;
  const units = Math.round(scaled);
  if (Math.abs(scaled - units) > SCALE_TOLERANCE) return null;
  if (units < 0 || units > PROBABILITY_TOTAL_UNITS) return null;
  return units;
}

/** Convierte unidades enteras al porcentaje que se guarda y se muestra. */
export function unitsToPercent(units: number): number {
  return Number((units / PROBABILITY_SCALE).toFixed(PROBABILITY_DECIMALS));
}

/** Texto legible sin ceros sobrantes: 300 -> "0.3", 100000 -> "100". */
export function formatUnits(units: number): string {
  return String(unitsToPercent(units));
}

export type ProbabilityTotalStatus = "valid" | "missing" | "exceeded";

export function describeProbabilityTotal(totalUnits: number): {
  status: ProbabilityTotalStatus;
  message: string;
} {
  const total = formatUnits(totalUnits);
  if (totalUnits === PROBABILITY_TOTAL_UNITS) {
    return {
      status: "valid",
      message: `Probabilidad total: ${total}%. Configuración válida.`,
    };
  }
  if (totalUnits < PROBABILITY_TOTAL_UNITS) {
    return {
      status: "missing",
      message: `Probabilidad total: ${total}%. Falta asignar ${formatUnits(
        PROBABILITY_TOTAL_UNITS - totalUnits,
      )}%.`,
    };
  }
  return {
    status: "exceeded",
    message: `Probabilidad total: ${total}%. Excedes el límite por ${formatUnits(
      totalUnits - PROBABILITY_TOTAL_UNITS,
    )}%.`,
  };
}

/**
 * Convierte pesos relativos antiguos a unidades porcentuales que suman
 * exactamente PROBABILITY_TOTAL_UNITS (método del mayor residuo).
 *
 * - Cada peso positivo recibe al menos 1 unidad (0.001 %) para que ningún
 *   premio que antes podía salir quede deshabilitado por redondeo.
 * - Las unidades sobrantes se asignan a los mayores residuos; los empates se
 *   resuelven por posición, así el resultado es determinista.
 * - El error por premio frente a la proporción original es menor a 1 unidad
 *   (0.001 %), salvo los premios elevados al mínimo de 1 unidad.
 */
export function weightsToUnits(weights: number[]): number[] {
  const safe = weights.map((weight) =>
    Number.isFinite(weight) && weight > 0 ? Math.floor(weight) : 0,
  );
  const totalWeight = safe.reduce((sum, weight) => sum + weight, 0);
  if (totalWeight <= 0) return safe.map(() => 0);

  const rows = safe.map((weight, index) => {
    const numerator = weight * PROBABILITY_TOTAL_UNITS;
    const base = Math.floor(numerator / totalWeight);
    return {
      index,
      weight,
      units: weight > 0 ? Math.max(1, base) : 0,
      remainder: numerator - base * totalWeight,
    };
  });

  let assigned = rows.reduce((sum, row) => sum + row.units, 0);

  if (assigned < PROBABILITY_TOTAL_UNITS) {
    const byRemainder = rows
      .filter((row) => row.weight > 0)
      .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
    let cursor = 0;
    while (assigned < PROBABILITY_TOTAL_UNITS && byRemainder.length > 0) {
      byRemainder[cursor % byRemainder.length].units += 1;
      assigned += 1;
      cursor += 1;
    }
  }

  while (assigned > PROBABILITY_TOTAL_UNITS) {
    // Solo ocurre cuando varios premios mínimos se elevaron a 1 unidad:
    // se descuenta del premio con más unidades, que apenas cambia.
    const largest = rows.reduce((best, row) =>
      row.units > best.units ? row : best,
    );
    largest.units -= 1;
    assigned -= 1;
  }

  return rows.map((row) => row.units);
}

export type WeightMigrationRow = {
  id: string;
  pesoOriginal: number;
  /** Proporción exacta del peso original, en porcentaje. */
  porcentajeExacto: number;
  /** Porcentaje asignado con precisión de 0.001 %. */
  probabilidad: number;
  unidades: number;
  /** probabilidad - porcentajeExacto, en puntos porcentuales. */
  desviacion: number;
};

/**
 * Plan de migración de un minijuego basado en pesos.
 * Función pura: no lee ni escribe Firestore.
 */
export function planWeightMigration(
  premios: Array<{ id: string; weight: number }>,
): { rows: WeightMigrationRow[]; totalUnits: number; maxDesviacion: number } {
  const pesos = premios.map((premio) =>
    Number.isFinite(premio.weight) && premio.weight >= 1
      ? Math.floor(premio.weight)
      : 1,
  );
  const totalPeso = pesos.reduce((sum, peso) => sum + peso, 0);
  const units = weightsToUnits(pesos);

  const rows = premios.map((premio, index) => {
    const porcentajeExacto = (pesos[index] / totalPeso) * 100;
    const probabilidad = unitsToPercent(units[index]);
    return {
      id: premio.id,
      pesoOriginal: pesos[index],
      porcentajeExacto,
      probabilidad,
      unidades: units[index],
      desviacion: probabilidad - porcentajeExacto,
    };
  });

  return {
    rows,
    totalUnits: units.reduce((sum, value) => sum + value, 0),
    maxDesviacion: rows.reduce(
      (max, row) => Math.max(max, Math.abs(row.desviacion)),
      0,
    ),
  };
}
