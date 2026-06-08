/**
 * Modelos para gestion de ordenes de compra.
 */

import { Timestamp } from "firebase-admin/firestore";
import {
  CheckoutAddressValidationStatus,
  CheckoutPricingSnapshot,
  CheckoutShippingSnapshot,
} from "./checkout-pricing.model";

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

export interface ItemOrden {
  productoId: string;
  cantidad: number;
  precioUnitario: number;
  subtotal: number;
  tallaId?: string;
}

export interface DireccionEnvio {
  nombre: string;
  telefono: string;
  calle: string;
  numero: string;
  numeroInterior?: string;
  colonia: string;
  ciudad: string;
  estado: string;
  codigoPostal: string;
  referencias?: string;
  addressValidationStatus?: CheckoutAddressValidationStatus;
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
  discountTotal?: number;
  subtotalOriginal?: number;
  subtotalFinal?: number;
  shippingTotal?: number;
  currency?: string;
  notas?: string;
  deliveredAt?: Timestamp;
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
  notas?: string;
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
