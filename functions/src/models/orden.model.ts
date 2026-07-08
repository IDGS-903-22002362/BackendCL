/**
 * Modelos para gestion de ordenes de compra.
 */

import { Timestamp } from "firebase-admin/firestore";
import {
  CheckoutAddressValidationStatus,
  CheckoutPricingSnapshot,
  CheckoutShippingSnapshot,
} from "./checkout-pricing.model";
import type { ItemPersonalizacion } from "../utils/product-personalization.util";
import type { ClientOrigin } from "../types/client-origin";

export enum EstadoOrden {
  PENDIENTE = "PENDIENTE",
  CONFIRMADA = "CONFIRMADA",
  EN_PROCESO = "EN_PROCESO",
  ENVIADA = "ENVIADA",
  ENTREGADA = "ENTREGADA",
  CANCELADA = "CANCELADA",
}

export enum MetodoPago {
  TARJETA = "TARJETA",
  APLAZO = "APLAZO",
  TRANSFERENCIA = "TRANSFERENCIA",
  EFECTIVO = "EFECTIVO",
  PAYPAL = "PAYPAL",
  MERCADOPAGO = "MERCADOPAGO",
}

export enum FulfillmentMethod {
  DELIVERY = "DELIVERY",
  PICKUP = "PICKUP",
}

export enum FulfillmentStatus {
  PENDING_PAYMENT = "PENDING_PAYMENT",
  PAID = "PAID",
  PREPARING = "PREPARING",
  READY_FOR_PICKUP = "READY_FOR_PICKUP",
  PICKED_UP = "PICKED_UP",
  EXPIRED = "EXPIRED",
  CANCELED = "CANCELED",
}

/**
 * Estado de pago a nivel de orden (espejo simplificado del documento `pagos`).
 * Permite a las pantallas de cliente/admin leer el estado de pago directamente
 * desde la orden sin tener que cruzar la colección de pagos.
 */
export enum PaymentState {
  PENDIENTE = "PENDIENTE",
  PAGADO = "PAGADO",
  FALLIDO = "FALLIDO",
  REEMBOLSADO = "REEMBOLSADO",
}

/**
 * Estado granular de preparación/fulfillment de la orden.
 * Es aditivo: convive con `estado` (EstadoOrden) y `fulfillmentStatus`
 * (FulfillmentStatus). Se usa como fuente de verdad para etiquetas de UI.
 */
export enum PreparationStatus {
  WAITING_PAYMENT = "WAITING_PAYMENT",
  PENDING_PREPARATION = "PENDING_PREPARATION",
  PREPARING = "PREPARING",
  READY_TO_SHIP = "READY_TO_SHIP",
  SHIPPED = "SHIPPED",
  READY_FOR_PICKUP = "READY_FOR_PICKUP",
  PICKED_UP = "PICKED_UP",
  DELIVERED = "DELIVERED",
  INCIDENT = "INCIDENT",
  RETURNED = "RETURNED",
}

/**
 * Estado del envío manual (FedEx manual) almacenado en `shipping.status`.
 * Mantiene compatibilidad con los valores legacy (EXCEPTION) y agrega los
 * estados granulares solicitados para el flujo manual temporal.
 */
export enum ManualShippingStatus {
  PENDING_MANUAL_SHIPMENT = "pending_manual_shipment",
  PREPARING = "PREPARING",
  READY_TO_SHIP = "READY_TO_SHIP",
  DELIVERED_TO_CARRIER = "DELIVERED_TO_CARRIER",
  IN_TRANSIT = "IN_TRANSIT",
  DELIVERED = "DELIVERED",
  INCIDENT = "INCIDENT",
  RETURNED = "RETURNED",
}

export interface ItemOrden {
  productoId: string;
  cantidad: number;
  precioUnitario: number;
  subtotal: number;
  tallaId?: string;
  personalizacion?: ItemPersonalizacion;
  personalizationFee?: number;
}

export interface DireccionEnvio {
  nombre: string;
  nombreCompleto?: string;
  telefono: string;
  calle: string;
  numero: string;
  numeroExterior?: string;
  numeroInterior?: string;
  colonia: string;
  ciudad: string;
  estado: string;
  codigoPostal: string;
  pais?: string;
  referencias?: string;
  instruccionesEntrega?: string;
  email?: string;
  addressValidationStatus?: CheckoutAddressValidationStatus;
}

export type OrderHistoryChangeType =
  | "shipping_status_change"
  | "fulfillment_status_change";

export interface OrderStatusHistoryEntry {
  type: OrderHistoryChangeType;
  from: string;
  to: string;
  changedBy: string;
  changedAt: Timestamp;
  note?: string;
}

export interface PickupLocationSnapshot {
  id: string;
  name: string;
  address: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  phone?: string;
  pickupInstructions?: string;
  businessHours?: Record<string, unknown>;
  preparationCutoffTime?: string;
  estimatedPreparationMinutes?: number;
}

export interface PickupContact {
  name: string;
  phone?: string;
  email?: string;
}

export interface Orden {
  id?: string;
  usuarioId: string;
  items: ItemOrden[];
  subtotal: number;
  impuestos: number;
  total: number;
  estado: EstadoOrden;
  direccionEnvio?: DireccionEnvio;
  metodoPago: MetodoPago;
  fulfillmentMethod?: FulfillmentMethod;
  fulfillmentStatus?: FulfillmentStatus;
  paymentStatus?: PaymentState;
  preparationStatus?: PreparationStatus;
  pickupLocationId?: string;
  pickupLocation?: PickupLocationSnapshot;
  pickupInstructions?: string;
  pickupContact?: PickupContact;
  pickupCodeHash?: string;
  pickupCodeLast4?: string;
  pickupQrPayload?: string;
  readyForPickupAt?: Timestamp;
  pickedUpAt?: Timestamp;
  pickedUpBy?: string;
  deliveredByStaffUid?: string;
  pickupExpiresAt?: Timestamp;
  transaccionId?: string;
  referenciaPago?: string;
  stripePaymentIntentId?: string;
  stripeCheckoutSessionId?: string;
  stripeCustomerId?: string;
  paymentMetadata?: Record<string, unknown>;
  numeroGuia?: string;
  transportista?: string;
  costoEnvio?: number;
   shipping?: CheckoutShippingSnapshot | Record<string, any>;
  pricingSnapshot?: CheckoutPricingSnapshot;
  shippingHistory?: OrderStatusHistoryEntry[];
  updatedByAdminId?: string;

  discountTotal?: number;
  subtotalOriginal?: number;
  subtotalFinal?: number;
  shippingTotal?: number;
  currency?: string;

  codigoPromocion?: string;
  codigoPromocionId?: string;
  codigoPromocionTitulo?: string;
  descuentoCodigoPromocion?: number;
  notas?: string;
  deliveredAt?: Timestamp;
  clientOrigin?: ClientOrigin;
  advertisingTrackingAllowed?: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface CrearOrdenDTO {
  usuarioId: string;
  items: ItemOrden[];
  subtotal: number;
  impuestos: number;
  total: number;
  estado?: EstadoOrden;
    direccionEnvio?: DireccionEnvio;
  metodoPago: MetodoPago;
  codigoPromocion?: string;
  fulfillmentMethod?: FulfillmentMethod;
  pickupLocationId?: string;
  pickupContact?: PickupContact;
  costoEnvio?: number;
  shipping?: CheckoutShippingSnapshot | Record<string, any>;
  pricingSnapshot?: CheckoutPricingSnapshot;
  paymentMetadata?: Record<string, unknown>;
  discountTotal?: number;
  subtotalOriginal?: number;
  subtotalFinal?: number;
  shippingTotal?: number;
  currency?: string;
  shippingQuoteId?: string;
  selectedShippingOptionId?: string;
  selectedServiceType?: string;
  shippingMethod?: string;
  notas?: string;
  clientOrigin?: ClientOrigin;
  advertisingTrackingAllowed?: boolean;
}

export interface ActualizarOrdenDTO {
  estado?: EstadoOrden;
  transaccionId?: string;
  referenciaPago?: string;
  numeroGuia?: string;
  transportista?: string;
  costoEnvio?: number;
  notas?: string;
  fulfillmentStatus?: FulfillmentStatus;
}

export interface OrdenDetallada extends Orden {
  usuario?: {
    nombre: string;
    email: string;
    telefono?: string;
  };
  itemsDetallados?: Array<
    ItemOrden & {
      producto?: {
        clave: string;
        descripcion: string;
        imagenes: string[];
      };
    }
  >;
}
