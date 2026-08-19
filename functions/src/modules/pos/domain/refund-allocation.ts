/**
 * Reparto de un reembolso entre los pagos aprobados de una venta.
 *
 * Política (documentada en `docs/POS_BACKEND_OPERATIONS.md`):
 *
 * 1. Se reembolsa primero el efectivo disponible en el cajón, porque es inmediato para el
 *    cliente y no depende de un proceso bancario externo.
 * 2. El resto se asigna a los pagos con tarjeta externa, del más antiguo al más reciente.
 * 3. Ningún pago puede reembolsarse por encima de `amountMinor - refundedMinor`.
 * 4. La suma de las asignaciones es exactamente el importe solicitado; si no alcanza el
 *    saldo reembolsable, la operación falla sin efectos.
 */

import PosProblemError from "../errors/pos-problem.error";
import { PosPaymentMethod, PosPaymentStatus } from "../models/pos.enums";

export interface RefundablePayment {
  id: string;
  method: PosPaymentMethod;
  status: PosPaymentStatus;
  amountMinor: number;
  refundedMinor: number;
  /** Orden estable: instante de aprobación en milisegundos. */
  approvedAtMs: number;
}

export interface RefundAllocation {
  paymentId: string;
  method: PosPaymentMethod;
  amountMinor: number;
}

export interface RefundAllocationResult {
  allocations: RefundAllocation[];
  cashRefundMinor: number;
  cardRefundMinor: number;
}

const REFUNDABLE_STATUSES: readonly PosPaymentStatus[] = [
  PosPaymentStatus.APPROVED,
  PosPaymentStatus.PARTIALLY_REFUNDED,
];

export function refundableRemainderMinor(payment: RefundablePayment): number {
  if (!REFUNDABLE_STATUSES.includes(payment.status)) {
    return 0;
  }
  return Math.max(0, payment.amountMinor - payment.refundedMinor);
}

export function totalRefundableMinor(
  payments: readonly RefundablePayment[],
): number {
  return payments.reduce(
    (total, payment) => total + refundableRemainderMinor(payment),
    0,
  );
}

export function allocateRefund(
  refundMinor: number,
  payments: readonly RefundablePayment[],
): RefundAllocationResult {
  if (!Number.isInteger(refundMinor) || refundMinor <= 0) {
    throw new PosProblemError(
      "POS_VALIDATION_ERROR",
      "El importe a reembolsar debe ser un entero positivo de centavos.",
    );
  }

  const available = totalRefundableMinor(payments);
  if (refundMinor > available) {
    throw new PosProblemError(
      "REFUND_AMOUNT_EXCEEDED",
      `El reembolso solicitado excede el saldo reembolsable de la venta.`,
    );
  }

  const ordered = [...payments].sort((a, b) => {
    const rank = (payment: RefundablePayment): number =>
      payment.method === PosPaymentMethod.CASH ? 0 : 1;
    return rank(a) - rank(b) || a.approvedAtMs - b.approvedAtMs || a.id.localeCompare(b.id);
  });

  const allocations: RefundAllocation[] = [];
  let remaining = refundMinor;
  let cashRefundMinor = 0;
  let cardRefundMinor = 0;

  for (const payment of ordered) {
    if (remaining <= 0) break;
    const capacity = refundableRemainderMinor(payment);
    if (capacity <= 0) continue;

    const amountMinor = Math.min(capacity, remaining);
    remaining -= amountMinor;
    allocations.push({
      paymentId: payment.id,
      method: payment.method,
      amountMinor,
    });

    if (payment.method === PosPaymentMethod.CASH) {
      cashRefundMinor += amountMinor;
    } else {
      cardRefundMinor += amountMinor;
    }
  }

  if (remaining !== 0) {
    throw new PosProblemError(
      "REFUND_AMOUNT_EXCEEDED",
      "No fue posible asignar el importe completo del reembolso a los pagos de la venta.",
    );
  }

  return { allocations, cashRefundMinor, cardRefundMinor };
}

/**
 * Importe reembolsable por las unidades devueltas de una línea.
 *
 * El total de línea se reparte entre unidades con el método del resto mayor y el importe se
 * calcula de forma **acumulada**: `cobertura(devueltas + nuevas) − cobertura(devueltas)`. Así
 * varias devoluciones parciales suman exactamente el total cobrado, sin perder ni duplicar
 * los centavos del residuo.
 */
export function lineRefundMinor(input: {
  lineTotalMinor: number;
  quantity: number;
  returnQuantity: number;
  /** Unidades ya devueltas o comprometidas en devoluciones vigentes de la misma línea. */
  alreadyReturnedQuantity: number;
  alreadyRefundedMinor: number;
}): number {
  const {
    lineTotalMinor,
    quantity,
    returnQuantity,
    alreadyReturnedQuantity,
    alreadyRefundedMinor,
  } = input;

  if (!Number.isInteger(returnQuantity) || returnQuantity <= 0) {
    throw new PosProblemError(
      "POS_VALIDATION_ERROR",
      "La cantidad a devolver debe ser un entero positivo.",
    );
  }
  if (
    !Number.isInteger(alreadyReturnedQuantity) ||
    alreadyReturnedQuantity < 0 ||
    alreadyReturnedQuantity > quantity
  ) {
    throw new PosProblemError(
      "POS_VALIDATION_ERROR",
      "Las unidades ya devueltas de la línea son inconsistentes.",
    );
  }
  if (alreadyReturnedQuantity + returnQuantity > quantity) {
    throw new PosProblemError(
      "RETURN_QUANTITY_EXCEEDED",
      "No puedes devolver más unidades de las vendidas en la línea.",
    );
  }

  const perUnit = Math.floor(lineTotalMinor / quantity);
  const remainder = lineTotalMinor - perUnit * quantity;
  // Las unidades con el centavo extra se cubren primero, de forma estable para cualquier
  // orden de devoluciones parciales.
  const coverage = (units: number): number =>
    perUnit * units + Math.min(units, remainder);

  const refund =
    coverage(alreadyReturnedQuantity + returnQuantity) -
    coverage(alreadyReturnedQuantity);

  const maxRefund = lineTotalMinor - alreadyRefundedMinor;
  if (refund > maxRefund) {
    throw new PosProblemError(
      "REFUND_AMOUNT_EXCEEDED",
      "El reembolso de la línea excede el importe cobrado pendiente de devolver.",
    );
  }

  return refund;
}
