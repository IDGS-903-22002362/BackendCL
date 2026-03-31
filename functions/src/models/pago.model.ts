/**
 * Modelos para gestión de pagos con Stripe
 * Sistema de pagos para la tienda del Club León
 *
 * RELACIONES:
 * - ordenId → Colección 'ordenes'
 * - userId → Colección 'usuarios' (Firebase Auth UID)
 *
 * INTEGRACIÓN:
 * - Stripe PaymentIntent y/o Checkout Session
 * - Webhook de Stripe para confirmación final de pago
 * - Idempotencia vía idempotencyKey para evitar cobros duplicados
 *
 * ESTRATEGIA DE DATOS:
 * - NO usar soft delete (campo activo)
 * - Estados manejan el ciclo de vida del pago
 * - Nunca eliminar pagos (audit trail financiero)
 * - webhookEventIdsProcesados para deduplicación de eventos
 * - Timestamps: Firestore Timestamp.now()
 *
 * REGLA DE INTEGRIDAD:
 * - Un Pago pertenece a una Orden (ordenId)
 * - Debe permitir reintentos sin duplicar cobros (idempotencia)
 * - La confirmación final del pago se hace vía webhook, NO al crear el intento
 */

import { Timestamp } from "firebase-admin/firestore";
import { MetodoPago } from "./orden.model";

// ─── Enums ────────────────────────────────────────────────────────────────────

/**
 * Enum para estados del pago
 * Define el ciclo de vida de un pago desde su creación hasta su resolución
 */
export enum EstadoPago {
  PENDIENTE = "PENDIENTE", // Pago creado, esperando acción del cliente
  REQUIERE_ACCION = "REQUIERE_ACCION", // Requiere acción adicional (ej. 3D Secure)
  PROCESANDO = "PROCESANDO", // Pago en proceso por la pasarela
  COMPLETADO = "COMPLETADO", // Pago exitoso, fondos recibidos
  FALLIDO = "FALLIDO", // Pago fallido (tarjeta rechazada, fondos insuficientes, etc.)
  REEMBOLSADO = "REEMBOLSADO", // Pago reembolsado total o parcialmente
}

export enum PaymentStatus {
  CREATED = "created",
  PENDING_PROVIDER = "pending_provider",
  PENDING_CUSTOMER = "pending_customer",
  AUTHORIZED = "authorized",
  PAID = "paid",
  FAILED = "failed",
  CANCELED = "canceled",
  EXPIRED = "expired",
  REFUNDED = "refunded",
  PARTIALLY_REFUNDED = "partially_refunded",
}

export enum PaymentFlowType {
  ONLINE = "online",
  IN_STORE = "in_store",
}

export enum PaymentMethodCode {
  CARD = "card",
  CASH = "cash",
  APLAZO = "aplazo",
}

export enum RefundState {
  NONE = "none",
  REQUESTED = "requested",
  PROCESSING = "processing",
  SUCCEEDED = "succeeded",
  FAILED = "failed",
}

/**
 * Enum para proveedores de pago
 * Extensible a futuro si se agregan más pasarelas
 */
export enum ProveedorPago {
  STRIPE = "STRIPE", // Stripe (PaymentIntent / Checkout Session)
  APLAZO = "APLAZO", // Aplazo (Online / In-Store)
}

// ─── Constantes ───────────────────────────────────────────────────────────────

/** Nombre de la colección en Firestore */
export const COLECCION_PAGOS = "pagos";

/** Moneda por defecto (pesos mexicanos) */
export const CURRENCY_DEFAULT = "mxn";

export interface PaymentPricingSnapshotItem {
  productoId: string;
  cantidad: number;
  precioUnitarioMinor: number;
  subtotalMinor: number;
  tallaId?: string;
}

export interface PaymentPricingSnapshot {
  subtotalMinor: number;
  taxMinor: number;
  shippingMinor: number;
  totalMinor: number;
  currency: string;
  items: PaymentPricingSnapshotItem[];
}

export interface PaymentFinalizationState {
  inProgress?: boolean;
  operationId?: string;
  finalizedAt?: Timestamp;
  finalizedBy?: string;
  lastTerminalStatus?: PaymentStatus;
  lastError?: string;
  updatedAt?: Timestamp;
}

// ─── Interfaces ───────────────────────────────────────────────────────────────

/**
 * Interface principal de Pago
 * Representa un registro de pago en la colección 'pagos' de Firestore
 */
export interface Pago {
  id?: string; // ID del documento en Firestore (opcional al crear)

  // Relaciones
  ordenId: string; // Referencia a la orden en colección 'ordenes'
  userId: string; // UID de Firebase Auth del usuario que paga

  // Datos del pago
  provider: ProveedorPago; // Proveedor de pago (STRIPE)
  metodoPago: MetodoPago; // Método de pago seleccionado (TARJETA, TRANSFERENCIA, etc.)
  paymentMethodCode?: PaymentMethodCode; // Código canónico independiente del proveedor
  flowType?: PaymentFlowType; // online | in_store
  monto: number; // Monto total del pago en la moneda especificada
  amountMinor?: number; // Monto total en centavos
  currency: string; // Código de moneda ISO 4217 (ej. "mxn", "usd")
  estado: EstadoPago; // Estado actual del pago
  status?: PaymentStatus; // Estado canónico provider-agnostic

  // Campos de Stripe
  providerStatus?: string; // Status crudo de Stripe (ej. "succeeded", "requires_action")
  paymentIntentId?: string; // ID del PaymentIntent en Stripe (pi_xxx)
  checkoutSessionId?: string; // ID del Checkout Session en Stripe (cs_xxx)
  stripeCustomerId?: string; // ID del customer en Stripe (cus_xxx)
  providerPaymentId?: string; // ID crudo del pago en proveedor externo
  providerLoanId?: string; // ID de crédito/préstamo en proveedor externo
  providerReference?: string; // Referencia externa del proveedor
  redirectUrl?: string; // URL para redirección del checkout
  successUrl?: string; // URL de retorno exitosa
  cancelUrl?: string; // URL de retorno cancelada
  failureUrl?: string; // URL de retorno fallida
  webhookUrl?: string; // URL usada al registrar webhook/callback con proveedor
  expiresAt?: Timestamp; // Expiración local o remota del intento
  paidAt?: Timestamp; // Fecha canonical de pago confirmado
  failedAt?: Timestamp; // Fecha canonical de fallo
  canceledAt?: Timestamp; // Fecha canonical de cancelación
  expiredAt?: Timestamp; // Fecha canonical de expiración

  // Referencias internas
  transaccionId?: string; // ID interno o referencia legible para el cliente
  idempotencyKey: string; // Clave de idempotencia para evitar cobros duplicados
  ventaPosId?: string; // Referencia a venta POS
  posSessionId?: string; // Sesión de caja/dispositivo
  deviceId?: string; // Dispositivo POS que originó el intento
  customerId?: string; // Cliente interno o usuario
  customerName?: string; // Snapshot nombre cliente
  customerEmail?: string; // Snapshot email cliente
  customerPhone?: string; // Snapshot teléfono cliente
  pricingSnapshot?: PaymentPricingSnapshot; // Snapshot monetario usado al crear intento

  // Fecha de pago
  fechaPago?: Timestamp; // Fecha en que el pago fue confirmado exitosamente

  // Información de fallo
  failureCode?: string; // Código de error de Stripe (ej. "card_declined")
  failureMessage?: string; // Mensaje descriptivo del fallo

  // Información de reembolso
  refundId?: string; // ID del reembolso en Stripe (re_xxx)
  refundAmount?: number; // Monto reembolsado (puede ser parcial)
  refundReason?: string; // Motivo del reembolso
  refundState?: RefundState; // Estado del subflujo de refund
  rawCreateRequestSanitized?: Record<string, unknown>; // Request saneado al proveedor
  rawCreateResponseSanitized?: Record<string, unknown>; // Response saneada del proveedor
  rawLastWebhookSanitized?: Record<string, unknown>; // Último webhook saneado
  finalization?: PaymentFinalizationState; // Estado exactly-once de side effects

  // Deduplicación de webhooks
  webhookEventIdsProcesados?: string[]; // IDs de eventos de Stripe ya procesados
  rawEventId?: string; // Último event.id aplicado al pago

  // Datos adicionales
  metadata?: Record<string, unknown>; // Datos extra (flexible, sin estructura fija)

  // Campos de auditoría
  createdAt: Timestamp; // Fecha de creación del registro de pago
  updatedAt: Timestamp; // Fecha de última actualización
}

// ─── DTOs ─────────────────────────────────────────────────────────────────────

/**
 * DTO para crear un nuevo pago
 * Omite campos autogenerados (id, createdAt, updatedAt)
 * y campos que se llenan durante el ciclo de vida (fechaPago, failure*, refund*)
 */
export interface CrearPagoDTO {
  ordenId: string;
  userId: string;
  provider: ProveedorPago;
  metodoPago: MetodoPago;
  monto: number;
  currency: string;
  estado?: EstadoPago; // Opcional, por defecto PENDIENTE
  idempotencyKey: string;
  paymentIntentId?: string;
  checkoutSessionId?: string;
  transaccionId?: string;
  providerStatus?: string;
  metadata?: Record<string, unknown>;
}

/**
 * DTO para actualizar un pago existente
 * Todos los campos son opcionales para permitir actualizaciones parciales
 * Se usa internamente cuando el webhook actualiza el estado del pago
 */
export interface ActualizarPagoDTO {
  estado?: EstadoPago;
  providerStatus?: string;
  paymentIntentId?: string;
  checkoutSessionId?: string;
  transaccionId?: string;
  fechaPago?: Timestamp;
  failureCode?: string;
  failureMessage?: string;
  refundId?: string;
  refundAmount?: number;
  refundReason?: string;
  webhookEventIdsProcesados?: string[];
  metadata?: Record<string, unknown>;
}

/**
 * Interface para pago con información populada
 * Útil para respuestas de API que incluyan datos de la orden y usuario
 */
export interface PagoDetallado extends Pago {
  orden?: {
    id: string;
    estado: string;
    total: number;
    items: number; // Cantidad de items en la orden
  };
  usuario?: {
    nombre: string;
    email: string;
  };
}
