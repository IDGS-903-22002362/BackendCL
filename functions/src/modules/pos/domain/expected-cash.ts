/**
 * Cálculo del efectivo esperado a partir del ledger de movimientos.
 *
 * El ledger (`posCashMovements`) es la fuente de verdad. Este módulo es puro: recibe los
 * movimientos ya leídos y devuelve el esperado más el desglose necesario para el corte.
 * Las proyecciones almacenadas (`posShifts.totals`, `posCuts.totals`) siempre se pueden
 * reconstruir con esta función.
 *
 * Fórmula:
 *
 *   fondo inicial
 *   + ventas en efectivo confirmadas
 *   + entradas de efectivo aprobadas
 *   + reposiciones aprobadas
 *   + transferencias recibidas
 *   + ajustes autorizados de entrada
 *   − reembolsos en efectivo
 *   − salidas aprobadas
 *   − retiros de seguridad completados
 *   − transferencias enviadas
 *   − entregas de turno
 *   − ajustes autorizados de salida
 *
 * No se incluye: ventas con tarjeta, pagos rechazados, ventas canceladas antes del pago,
 * movimientos pendientes o rechazados, ni transferencias despachadas pero no recibidas.
 */

import {
  PosCashMovementStatus,
  PosCashMovementType,
} from "../models/pos.enums";
import type { PosCashMovement } from "../models/pos.types";

export interface ExpectedCashInput {
  openingFloatMinor: number;
  movements: readonly Pick<
    PosCashMovement,
    "type" | "status" | "amountMinor" | "direction"
  >[];
}

export interface ExpectedCashBreakdown {
  openingFloatMinor: number;
  cashSalesMinor: number;
  cashRefundsMinor: number;
  cashInMinor: number;
  cashOutMinor: number;
  replenishmentsMinor: number;
  securityDropsMinor: number;
  transfersInMinor: number;
  transfersOutMinor: number;
  handoffsMinor: number;
  adjustmentsInMinor: number;
  adjustmentsOutMinor: number;
  /** Transferencias despachadas sin confirmación de recepción. No afectan el esperado. */
  transfersInTransitMinor: number;
  expectedCashMinor: number;
}

/**
 * Estados que hacen efectivo un movimiento.
 *
 * `SECURITY_DROP`, `TRANSFER_OUT` y `TRANSFER_IN` solo cuentan cuando la contraparte
 * confirmó la recepción (`RECEIVED`): así se evita que una caja descuente y la otra nunca
 * reciba sin que exista una incidencia visible.
 */
function isEffective(
  type: PosCashMovementType,
  status: PosCashMovementStatus,
): boolean {
  switch (type) {
    case PosCashMovementType.SECURITY_DROP:
    case PosCashMovementType.TRANSFER_OUT:
    case PosCashMovementType.TRANSFER_IN:
      return status === PosCashMovementStatus.RECEIVED;
    case PosCashMovementType.OPENING_FLOAT:
      // El fondo inicial se pasa por separado para poder reconstruirlo sin el ledger.
      return false;
    default:
      return status === PosCashMovementStatus.APPROVED;
  }
}

export function computeExpectedCash(
  input: ExpectedCashInput,
): ExpectedCashBreakdown {
  const breakdown: ExpectedCashBreakdown = {
    openingFloatMinor: input.openingFloatMinor,
    cashSalesMinor: 0,
    cashRefundsMinor: 0,
    cashInMinor: 0,
    cashOutMinor: 0,
    replenishmentsMinor: 0,
    securityDropsMinor: 0,
    transfersInMinor: 0,
    transfersOutMinor: 0,
    handoffsMinor: 0,
    adjustmentsInMinor: 0,
    adjustmentsOutMinor: 0,
    transfersInTransitMinor: 0,
    expectedCashMinor: 0,
  };

  for (const movement of input.movements) {
    if (
      (movement.type === PosCashMovementType.TRANSFER_OUT ||
        movement.type === PosCashMovementType.SECURITY_DROP) &&
      movement.status === PosCashMovementStatus.IN_TRANSIT
    ) {
      breakdown.transfersInTransitMinor += movement.amountMinor;
    }

    if (!isEffective(movement.type, movement.status)) {
      continue;
    }

    switch (movement.type) {
      case PosCashMovementType.CASH_SALE:
        breakdown.cashSalesMinor += movement.amountMinor;
        break;
      case PosCashMovementType.CASH_REFUND:
        breakdown.cashRefundsMinor += movement.amountMinor;
        break;
      case PosCashMovementType.CASH_IN:
        breakdown.cashInMinor += movement.amountMinor;
        break;
      case PosCashMovementType.CASH_OUT:
        breakdown.cashOutMinor += movement.amountMinor;
        break;
      case PosCashMovementType.CASH_REPLENISHMENT:
        breakdown.replenishmentsMinor += movement.amountMinor;
        break;
      case PosCashMovementType.SECURITY_DROP:
        breakdown.securityDropsMinor += movement.amountMinor;
        break;
      case PosCashMovementType.TRANSFER_IN:
        breakdown.transfersInMinor += movement.amountMinor;
        break;
      case PosCashMovementType.TRANSFER_OUT:
        breakdown.transfersOutMinor += movement.amountMinor;
        break;
      case PosCashMovementType.SHIFT_HANDOFF:
        breakdown.handoffsMinor += movement.amountMinor;
        break;
      case PosCashMovementType.AUTHORIZED_ADJUSTMENT:
        if (movement.direction === "IN") {
          breakdown.adjustmentsInMinor += movement.amountMinor;
        } else {
          breakdown.adjustmentsOutMinor += movement.amountMinor;
        }
        break;
      default:
        break;
    }
  }

  breakdown.expectedCashMinor =
    breakdown.openingFloatMinor +
    breakdown.cashSalesMinor +
    breakdown.cashInMinor +
    breakdown.replenishmentsMinor +
    breakdown.transfersInMinor +
    breakdown.adjustmentsInMinor -
    breakdown.cashRefundsMinor -
    breakdown.cashOutMinor -
    breakdown.securityDropsMinor -
    breakdown.transfersOutMinor -
    breakdown.handoffsMinor -
    breakdown.adjustmentsOutMinor;

  return breakdown;
}

/** Dirección canónica de cada tipo de movimiento respecto al cajón de efectivo. */
export function cashMovementDirection(
  type: PosCashMovementType,
): "IN" | "OUT" | "EITHER" {
  switch (type) {
    case PosCashMovementType.OPENING_FLOAT:
    case PosCashMovementType.CASH_SALE:
    case PosCashMovementType.CASH_IN:
    case PosCashMovementType.CASH_REPLENISHMENT:
    case PosCashMovementType.TRANSFER_IN:
      return "IN";
    case PosCashMovementType.CASH_REFUND:
    case PosCashMovementType.CASH_OUT:
    case PosCashMovementType.SECURITY_DROP:
    case PosCashMovementType.TRANSFER_OUT:
    case PosCashMovementType.SHIFT_HANDOFF:
      return "OUT";
    case PosCashMovementType.AUTHORIZED_ADJUSTMENT:
      return "EITHER";
    default:
      return "EITHER";
  }
}
