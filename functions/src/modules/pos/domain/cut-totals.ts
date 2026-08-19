/**
 * Consolidación de un corte a partir de sus fuentes canónicas.
 *
 * Función pura: recibe ventas, pagos, devoluciones y movimientos ya leídos y devuelve los
 * totales del corte. Cualquier proyección almacenada (`posCuts.totals`, `posShifts.totals`,
 * `posDailyClosures.totals`) puede reconstruirse llamando a esta función con las mismas
 * fuentes, que es el criterio de conciliación del módulo.
 *
 * Reglas de conteo:
 *
 * - Una venta pagada se cuenta una sola vez, aunque tenga pago mixto.
 * - Los pagos rechazados y cancelados no suman.
 * - Las ventas canceladas antes del pago no suman importe, solo cantidad de cancelaciones.
 * - Los reembolsos se restan del neto en su propio renglón, nunca borrando la venta original.
 */

import {
  PosPaymentMethod,
  PosPaymentStatus,
  PosReturnStatus,
  PosSaleStatus,
} from "../models/pos.enums";
import type {
  PosCashMovement,
  PosCutTotals,
  PosPayment,
  PosPaymentMethodBreakdown,
  PosReturn,
  PosSale,
} from "../models/pos.types";
import { computeExpectedCash } from "./expected-cash";

/** Ventas que representan una operación comercial consumada. */
export const SOLD_SALE_STATUSES: readonly PosSaleStatus[] = [
  PosSaleStatus.PAID,
  PosSaleStatus.PARTIALLY_REFUNDED,
  PosSaleStatus.REFUNDED,
];

/** Pagos que efectivamente movieron dinero. */
export const APPLIED_PAYMENT_STATUSES: readonly PosPaymentStatus[] = [
  PosPaymentStatus.APPROVED,
  PosPaymentStatus.PARTIALLY_REFUNDED,
  PosPaymentStatus.REFUNDED,
];

export interface CutTotalsInput {
  openingFloatMinor: number;
  countedCashMinor: number;
  sales: readonly PosSale[];
  payments: readonly PosPayment[];
  returns: readonly PosReturn[];
  movements: readonly PosCashMovement[];
}

function buildPaymentBreakdown(
  payments: readonly PosPayment[],
): PosPaymentMethodBreakdown[] {
  const methods: PosPaymentMethod[] = [
    PosPaymentMethod.CASH,
    PosPaymentMethod.CARD_EXTERNAL,
  ];

  return methods.map((method) => {
    const applied = payments.filter(
      (payment) =>
        payment.method === method &&
        APPLIED_PAYMENT_STATUSES.includes(payment.status),
    );
    const amountMinor = applied.reduce(
      (total, payment) => total + payment.amountMinor,
      0,
    );
    const refundedMinor = applied.reduce(
      (total, payment) => total + payment.refundedMinor,
      0,
    );
    return {
      method,
      count: applied.length,
      amountMinor,
      refundedMinor,
      netMinor: amountMinor - refundedMinor,
    };
  });
}

export function computeCutTotals(input: CutTotalsInput): PosCutTotals {
  const soldSales = input.sales.filter((sale) =>
    SOLD_SALE_STATUSES.includes(sale.status),
  );
  const completedReturns = input.returns.filter(
    (entry) => entry.status === PosReturnStatus.COMPLETED,
  );

  const cash = computeExpectedCash({
    openingFloatMinor: input.openingFloatMinor,
    movements: input.movements,
  });

  const grossSalesMinor = soldSales.reduce(
    (total, sale) => total + sale.totals.subtotalOriginalMinor,
    0,
  );
  const discountMinor = soldSales.reduce(
    (total, sale) => total + sale.totals.discountMinor,
    0,
  );
  const netSalesMinor = soldSales.reduce(
    (total, sale) => total + sale.totals.totalMinor,
    0,
  );

  return {
    openingFloatMinor: input.openingFloatMinor,
    salesCount: soldSales.length,
    grossSalesMinor,
    discountMinor,
    netSalesMinor,
    cancelledCount: input.sales.filter(
      (sale) => sale.status === PosSaleStatus.CANCELLED,
    ).length,
    voidedMinor: input.sales
      .filter((sale) => sale.status === PosSaleStatus.VOIDED)
      .reduce((total, sale) => total + sale.totals.totalMinor, 0),
    returnsCount: completedReturns.length,
    refundsMinor: completedReturns.reduce(
      (total, entry) => total + entry.refundTotalMinor,
      0,
    ),
    cashRefundsMinor: completedReturns.reduce(
      (total, entry) => total + entry.cashRefundMinor,
      0,
    ),
    cardRefundsMinor: completedReturns.reduce(
      (total, entry) => total + entry.cardRefundMinor,
      0,
    ),
    cashInMinor: cash.cashInMinor + cash.replenishmentsMinor + cash.adjustmentsInMinor,
    cashOutMinor: cash.cashOutMinor + cash.adjustmentsOutMinor,
    securityDropsMinor: cash.securityDropsMinor,
    transfersInMinor: cash.transfersInMinor,
    transfersOutMinor: cash.transfersOutMinor,
    adjustmentsMinor: cash.adjustmentsInMinor - cash.adjustmentsOutMinor,
    paymentBreakdown: buildPaymentBreakdown(input.payments),
    expectedCashMinor: cash.expectedCashMinor,
    countedCashMinor: input.countedCashMinor,
    differenceMinor: input.countedCashMinor - cash.expectedCashMinor,
  };
}

/** Suma dos conjuntos de totales para consolidar sesión o día. */
export function mergeCutTotals(
  totals: readonly PosCutTotals[],
): PosCutTotals {
  const base: PosCutTotals = {
    openingFloatMinor: 0,
    salesCount: 0,
    grossSalesMinor: 0,
    discountMinor: 0,
    netSalesMinor: 0,
    cancelledCount: 0,
    voidedMinor: 0,
    returnsCount: 0,
    refundsMinor: 0,
    cashRefundsMinor: 0,
    cardRefundsMinor: 0,
    cashInMinor: 0,
    cashOutMinor: 0,
    securityDropsMinor: 0,
    transfersInMinor: 0,
    transfersOutMinor: 0,
    adjustmentsMinor: 0,
    paymentBreakdown: [],
    expectedCashMinor: 0,
    countedCashMinor: 0,
    differenceMinor: 0,
  };

  const breakdown = new Map<PosPaymentMethod, PosPaymentMethodBreakdown>();

  for (const entry of totals) {
    base.openingFloatMinor += entry.openingFloatMinor;
    base.salesCount += entry.salesCount;
    base.grossSalesMinor += entry.grossSalesMinor;
    base.discountMinor += entry.discountMinor;
    base.netSalesMinor += entry.netSalesMinor;
    base.cancelledCount += entry.cancelledCount;
    base.voidedMinor += entry.voidedMinor;
    base.returnsCount += entry.returnsCount;
    base.refundsMinor += entry.refundsMinor;
    base.cashRefundsMinor += entry.cashRefundsMinor;
    base.cardRefundsMinor += entry.cardRefundsMinor;
    base.cashInMinor += entry.cashInMinor;
    base.cashOutMinor += entry.cashOutMinor;
    base.securityDropsMinor += entry.securityDropsMinor;
    base.transfersInMinor += entry.transfersInMinor;
    base.transfersOutMinor += entry.transfersOutMinor;
    base.adjustmentsMinor += entry.adjustmentsMinor;
    base.expectedCashMinor += entry.expectedCashMinor;
    base.countedCashMinor += entry.countedCashMinor;
    base.differenceMinor += entry.differenceMinor;

    for (const method of entry.paymentBreakdown) {
      const current = breakdown.get(method.method) ?? {
        method: method.method,
        count: 0,
        amountMinor: 0,
        refundedMinor: 0,
        netMinor: 0,
      };
      current.count += method.count;
      current.amountMinor += method.amountMinor;
      current.refundedMinor += method.refundedMinor;
      current.netMinor += method.netMinor;
      breakdown.set(method.method, current);
    }
  }

  base.paymentBreakdown = Array.from(breakdown.values());
  return base;
}
