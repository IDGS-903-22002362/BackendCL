/**
 * Modelos para gestión de órdenes de compra
 * Sistema de pedidos para la tienda del Club León
 *
 * RELACIONES:
 * - usuarioId → Colección 'usuarios' (Firebase Auth UID)
 * - items[].productoId → Colección 'productos'
 *
 * INTEGRACIÓN FUTURA:
 * - Sistema de pagos (transaccionId, referenciaPago)
 * - Sistema de envíos (numeroGuia, transportista)
 * - Notificaciones (email por cambio de estado)
 *
 * ESTRATEGIA DE DATOS:
 * - NO usar soft delete (activo: boolean)
 * - Órdenes canceladas mantienen estado CANCELADA
 * - Nunca eliminar órdenes (audit trail)
 * - Reserva de stock TBD en capa de servicio
 * - Timestamps: Firestore Timestamp.now()
 */

import { Timestamp } from "firebase-admin/firestore";

/**
 * Enum para estados de la orden
 * Define el ciclo de vida de una orden desde su creación hasta su cumplimiento
 */
export enum EstadoOrden {
  PENDIENTE = "PENDIENTE", // Orden creada, esperando confirmación de pago
  CONFIRMADA = "CONFIRMADA", // Pago confirmado, lista para procesar
  EN_PROCESO = "EN_PROCESO", // Orden en preparación/empaque
  ENVIADA = "ENVIADA", // Orden enviada al cliente
  ENTREGADA = "ENTREGADA", // Orden entregada exitosamente
  CANCELADA = "CANCELADA", // Orden cancelada (por usuario o admin)
}

/**
 * Enum para métodos de pago disponibles
 * Define las opciones de pago aceptadas por la tienda
 */
export enum MetodoPago {
  TARJETA = "TARJETA", // Tarjeta de crédito/débito
  TRANSFERENCIA = "TRANSFERENCIA", // Transferencia bancaria
  EFECTIVO = "EFECTIVO", // Pago en efectivo contra entrega
  PAYPAL = "PAYPAL", // PayPal
  MERCADOPAGO = "MERCADOPAGO", // Mercado Pago
}

/**
 * Interface para items individuales de la orden
 * Representa cada producto incluido en la orden con su cantidad y precio
 */
export interface ItemOrden {
  productoId: string; // Referencia al documento en colección 'productos'
  cantidad: number; // Cantidad de unidades del producto
  precioUnitario: number; // Precio unitario al momento de la compra (snapshot)
  subtotal: number; // cantidad * precioUnitario
  tallaId?: string; // ID de la talla seleccionada (opcional, si aplica)
}

/**
 * Interface para dirección de envío
 * Estructura completa para direcciones de envío en México
 */
export interface DireccionEnvio {
  nombre: string; // Nombre completo de quien recibe
  telefono: string; // Teléfono de contacto (10 dígitos)
  calle: string; // Nombre de la calle
  numero: string; // Número exterior (puede incluir letra)
  numeroInterior?: string; // Número interior (opcional)
  colonia: string; // Colonia o barrio
  ciudad: string; // Ciudad o municipio
  estado: string; // Estado de la república
  codigoPostal: string; // Código postal (5 dígitos)
  referencias?: string; // Referencias adicionales para encontrar la dirección
}

/**
 * Interface principal de Orden
 * Representa una orden de compra en la colección 'ordenes' de Firestore
 */
export interface Orden {
  id?: string; // ID del documento en Firestore (opcional al crear)
  usuarioId: string; // UID de Firebase Auth del usuario que realiza la compra
  items: ItemOrden[]; // Array de productos en la orden
  subtotal: number; // Suma de todos los subtotales de items
  impuestos: number; // IVA u otros impuestos aplicables
  total: number; // subtotal + impuestos + envío (si aplica)
  estado: EstadoOrden; // Estado actual de la orden
  direccionEnvio: DireccionEnvio; // Dirección de entrega
  metodoPago: MetodoPago; // Método de pago seleccionado

  // Campos opcionales para integración futura
  transaccionId?: string; // ID de transacción de la pasarela de pago
  referenciaPago?: string; // Referencia adicional del pago
  numeroGuia?: string; // Número de guía de envío
  transportista?: string; // Nombre del transportista
  costoEnvio?: number; // Costo de envío (si aplica)
  notas?: string; // Notas adicionales del cliente

  // Campos de auditoría
  createdAt: Timestamp; // Fecha de creación de la orden
  updatedAt: Timestamp; // Fecha de última actualización
}

/**
 * DTO para crear una nueva orden
 * Omite campos autogenerados como id, createdAt, updatedAt
 */
export interface CrearOrdenDTO {
  usuarioId: string;
  items: ItemOrden[];
  subtotal: number;
  impuestos: number;
  total: number;
  estado?: EstadoOrden; // Opcional, por defecto PENDIENTE
  direccionEnvio: DireccionEnvio;
  metodoPago: MetodoPago;
  costoEnvio?: number;
  notas?: string;
}

/**
 * DTO para actualizar una orden existente
 * Todos los campos son opcionales para permitir actualizaciones parciales
 */
export interface ActualizarOrdenDTO {
  estado?: EstadoOrden;
  transaccionId?: string;
  referenciaPago?: string;
  numeroGuia?: string;
  transportista?: string;
  costoEnvio?: number;
  notas?: string;
}

/**
 * Interface para orden con información populada
 * Útil para respuestas de API que incluyan datos relacionados
 */
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
