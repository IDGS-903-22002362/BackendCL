import { Timestamp } from "firebase-admin/firestore";

export enum EstadoVentaPos {
  BORRADOR = "BORRADOR",
  PENDIENTE_PAGO = "PENDIENTE_PAGO",
  PAGADA = "PAGADA",
  FALLIDA = "FALLIDA",
  CANCELADA = "CANCELADA",
  EXPIRADA = "EXPIRADA",
}

export interface VentaPosItem {
  productoId: string;
  cantidad: number;
  precioUnitario: number;
  subtotal: number;
  tallaId?: string;
}

export interface VentaPos {
  id?: string;
  posSessionId: string;
  deviceId: string;
  cajaId: string;
  sucursalId: string;
  vendedorUid: string;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  currency: string;
  subtotal: number;
  tax: number;
  shipping: number;
  total: number;
  subtotalMinor: number;
  taxMinor: number;
  shippingMinor: number;
  totalMinor: number;
  status: EstadoVentaPos;
  paymentAttemptId?: string;
  providerReference?: string;
  items: VentaPosItem[];
  metadata?: Record<string, unknown>;
  paidAt?: Timestamp;
  canceledAt?: Timestamp;
  expiredAt?: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
