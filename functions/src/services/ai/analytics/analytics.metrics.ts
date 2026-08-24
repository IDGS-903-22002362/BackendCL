/**
 * Funciones puras de agregacion para el Asistente Administrativo.
 *
 * Se mantienen separadas del repositorio para poder probarlas sin Firestore
 * y para garantizar que todas las tools usen exactamente la misma definicion
 * de "venta", "pedido pagado" y "ticket promedio".
 */

import { EstadoOrden, PaymentState } from "../../../models/orden.model";
import { AnalyticsOrder } from "./analytics.repository";
import { ResolvedPeriod, listDayKeys } from "./period.util";

export interface SalesTotals {
  revenue: number;
  paidOrders: number;
  units: number;
  averageOrderValue: number;
  shipping: number;
  discounts: number;
  promoCodeDiscounts: number;
  uniqueCustomers: number;
}

export interface OrdersBreakdown {
  totalOrders: number;
  paidOrders: number;
  canceledOrders: number;
  pendingPaymentOrders: number;
  failedPaymentOrders: number;
  refundedOrders: number;
  ordersWithoutPaymentStatus: number;
  byStatus: Record<string, number>;
  byFulfillmentMethod: Record<string, number>;
  byPaymentMethod: Record<string, number>;
}

export interface DailyPoint {
  date: string;
  revenue: number;
  orders: number;
  units: number;
}

export interface VariationMetric {
  current: number;
  previous: number;
  absoluteChange: number;
  percentChange: number | null;
}

/**
 * Un pedido cuenta como venta solo cuando el backend ya lo marco como pagado.
 * Nunca se infiere el pago desde el estado logistico.
 */
export const isPaidOrder = (order: AnalyticsOrder): boolean =>
  order.paymentStatus === PaymentState.PAGADO;

export const isCanceledOrder = (order: AnalyticsOrder): boolean =>
  order.estado === EstadoOrden.CANCELADA;

export const countUnits = (order: AnalyticsOrder): number =>
  order.items.reduce((acc, item) => acc + item.cantidad, 0);

const round2 = (value: number): number => Math.round(value * 100) / 100;

export const percentChange = (
  current: number,
  previous: number,
): number | null => {
  if (previous === 0) {
    return null;
  }

  return round2(((current - previous) / Math.abs(previous)) * 100);
};

export const buildVariation = (
  current: number,
  previous: number,
): VariationMetric => ({
  current: round2(current),
  previous: round2(previous),
  absoluteChange: round2(current - previous),
  percentChange: percentChange(current, previous),
});

export const summarizeSales = (orders: AnalyticsOrder[]): SalesTotals => {
  const paid = orders.filter(isPaidOrder);
  const revenue = paid.reduce((acc, order) => acc + order.total, 0);
  const customers = new Set(
    paid.map((order) => order.customerKey).filter((key): key is string => Boolean(key)),
  );

  return {
    revenue: round2(revenue),
    paidOrders: paid.length,
    units: paid.reduce((acc, order) => acc + countUnits(order), 0),
    averageOrderValue: paid.length > 0 ? round2(revenue / paid.length) : 0,
    shipping: round2(paid.reduce((acc, order) => acc + order.shippingTotal, 0)),
    discounts: round2(paid.reduce((acc, order) => acc + order.discountTotal, 0)),
    promoCodeDiscounts: round2(
      paid.reduce((acc, order) => acc + order.promoCodeDiscount, 0),
    ),
    uniqueCustomers: customers.size,
  };
};

const increment = (bucket: Record<string, number>, key: string): void => {
  bucket[key] = (bucket[key] || 0) + 1;
};

export const breakdownOrders = (orders: AnalyticsOrder[]): OrdersBreakdown => {
  const byStatus: Record<string, number> = {};
  const byFulfillmentMethod: Record<string, number> = {};
  const byPaymentMethod: Record<string, number> = {};

  let paidOrders = 0;
  let canceledOrders = 0;
  let pendingPaymentOrders = 0;
  let failedPaymentOrders = 0;
  let refundedOrders = 0;
  let ordersWithoutPaymentStatus = 0;

  for (const order of orders) {
    increment(byStatus, order.estado);
    increment(byFulfillmentMethod, order.fulfillmentMethod || "NO_DEFINIDO");
    increment(byPaymentMethod, order.metodoPago || "NO_DEFINIDO");

    if (isCanceledOrder(order)) {
      canceledOrders += 1;
    }

    switch (order.paymentStatus) {
      case PaymentState.PAGADO:
        paidOrders += 1;
        break;
      case PaymentState.PENDIENTE:
        pendingPaymentOrders += 1;
        break;
      case PaymentState.FALLIDO:
        failedPaymentOrders += 1;
        break;
      case PaymentState.REEMBOLSADO:
        refundedOrders += 1;
        break;
      default:
        ordersWithoutPaymentStatus += 1;
    }
  }

  return {
    totalOrders: orders.length,
    paidOrders,
    canceledOrders,
    pendingPaymentOrders,
    failedPaymentOrders,
    refundedOrders,
    ordersWithoutPaymentStatus,
    byStatus,
    byFulfillmentMethod,
    byPaymentMethod,
  };
};

/**
 * Serie diaria completa: incluye los dias sin ventas en cero para que el
 * modelo no interprete huecos como datos faltantes.
 */
export const buildDailySeries = (
  orders: AnalyticsOrder[],
  period: ResolvedPeriod,
): DailyPoint[] => {
  const buckets = new Map<string, DailyPoint>();

  for (const dayKey of listDayKeys(period)) {
    buckets.set(dayKey, { date: dayKey, revenue: 0, orders: 0, units: 0 });
  }

  for (const order of orders) {
    if (!isPaidOrder(order)) {
      continue;
    }

    const bucket = buckets.get(order.dayKey);
    if (!bucket) {
      continue;
    }

    bucket.revenue = round2(bucket.revenue + order.total);
    bucket.orders += 1;
    bucket.units += countUnits(order);
  }

  return Array.from(buckets.values());
};

export interface ProductAggregate {
  productId: string;
  units: number;
  revenue: number;
  orders: number;
}

export const aggregateByProduct = (
  orders: AnalyticsOrder[],
): Map<string, ProductAggregate> => {
  const aggregates = new Map<string, ProductAggregate>();

  for (const order of orders) {
    if (!isPaidOrder(order)) {
      continue;
    }

    const seenInOrder = new Set<string>();

    for (const item of order.items) {
      const current = aggregates.get(item.productoId) || {
        productId: item.productoId,
        units: 0,
        revenue: 0,
        orders: 0,
      };

      current.units += item.cantidad;
      current.revenue = round2(current.revenue + item.subtotal);

      if (!seenInOrder.has(item.productoId)) {
        current.orders += 1;
        seenInOrder.add(item.productoId);
      }

      aggregates.set(item.productoId, current);
    }
  }

  return aggregates;
};

export const shareOfTotal = (value: number, total: number): number =>
  total > 0 ? round2((value / total) * 100) : 0;

export const roundCurrency = round2;
