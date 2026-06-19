import { EstadoOrden, Orden, PaymentState } from "../../../models/orden.model";

export function isOrdenPagada(order: Orden): boolean {
  if (order.estado === EstadoOrden.CANCELADA) {
    return false;
  }

  if (order.paymentStatus === PaymentState.PAGADO) {
    return true;
  }

  return (
    order.estado === EstadoOrden.CONFIRMADA ||
    order.estado === EstadoOrden.EN_PROCESO ||
    order.estado === EstadoOrden.ENVIADA ||
    order.estado === EstadoOrden.ENTREGADA
  );
}

export function extractPaidProductIdsFromOrder(order: Orden): string[] {
  if (!isOrdenPagada(order) || !Array.isArray(order.items)) {
    return [];
  }

  return order.items
    .map((item: { productoId?: string }) => String(item.productoId || "").trim())
    .filter(Boolean);
}
