const parsePositiveInt = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
};

/** Minutos que una reserva de checkout permanece activa antes de expirar. */
export const INVENTORY_RESERVATION_TTL_MINUTES = parsePositiveInt(
  process.env.INVENTORY_RESERVATION_TTL_MINUTES,
  30,
);

/** Diferencia máxima (unidades) que un empleado puede ajustar sin aprobación admin. */
export const INVENTORY_EMPLOYEE_ADJUSTMENT_LIMIT = parsePositiveInt(
  process.env.INVENTORY_EMPLOYEE_ADJUSTMENT_LIMIT,
  5,
);
