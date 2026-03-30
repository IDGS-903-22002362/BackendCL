/**
 * Modelos para gestión de usuarios y sistema de puntos
 * Sistema para clientes del Club León
 */

import { Timestamp } from "firebase-admin/firestore";

/**
 * Enum para roles de usuario
 * Define los niveles de acceso en el sistema
 */
export enum RolUsuario {
  ADMIN = "ADMIN", // Administrador con acceso total
  EMPLEADO = "EMPLEADO", // Empleado con permisos de gestión
  CLIENTE = "CLIENTE", // Cliente regular del sistema
  EMPLEADO_CLUB = "EMPLEADO_CLUB", // Empleado con acceso limitado a funciones del club
}

/**
 * Interface para Usuario de la App
 * Representa a los clientes registrados en el sistema de club leon
 */
export interface UsuarioApp {
  id?: string; // Documento ID en Firestore
  uid: string; // UID de Firebase Authentication
  provider: "google" | "apple" | "email";
  nombre: string; // Nombre completo del usuario
  email: string; // Correo electrónico
  rol: RolUsuario; // Rol del usuario en el sistema (default: CLIENTE)
  telefono?: string; // Teléfono de contacto (opcional)
  stripeCustomerId?: string; // Mapeo persistente con Stripe Customer
  puntosActuales: number; // Saldo actual de puntos
  nivel?: string; // Nivel de lealtad (ej: "Bronce", "Plata", "Oro", "Platino")
  fechaNacimiento?: Date; // Para promociones de cumpleaños
  perfilCompleto: boolean; // Status que indica si el perfil está completado o no
  edad: number; // se autocalcula cuando nos dan fecha de nacimiento.
  genero: string // sexo de la persona.
  activo: boolean; // Si la cuenta está activa
  historialPuntos?: HistorialPuntosUsuario;
  createdAt: Timestamp; // Fecha de registro
  updatedAt: Timestamp; // Última actualización
}
export interface CrearUsuarioAppDTO {
  // Elimina este campo -->  uid: string;
  nombre: string;
  email: string;
  rol?: RolUsuario;
  telefono?: string;
  fechaNacimiento?: Date;
  edad: number;
  genero: string;
  password: string;  // ← AGREGAR ESTO
}

/**
 * Interface para Movimientos de Puntos
 * Registra todas las transacciones del sistema de puntos
 */
export interface MovimientoPuntos {
  id?: string;
  usuarioId: string; // Referencia al usuario
  tipo: TipoMovimientoPuntos; // Tipo de movimiento
  puntos: number; // Cantidad de puntos (positivo o negativo)
  saldoAnterior: number; // Saldo antes del movimiento
  saldoNuevo: number; // Saldo después del movimiento
  origen: OrigenPuntos; // De dónde proviene el movimiento
  referencia?: string; // ID de orden, ticket, promoción, etc.
  descripcion?: string; // Descripción adicional del movimiento
  cicloAnual?: number;
  etiquetaCiclo?: string;
  createdAt: Timestamp; // Fecha del movimiento
}

export interface ResumenPuntosAnual {
  ciclo: number;
  etiqueta: string;
  fechaInicio: Timestamp;
  fechaFinProgramada: Timestamp;
  fechaExpiracionAplicada: Timestamp | null;
  saldoInicial: number;
  puntosGanados: number;
  puntosCanjeados: number;
  puntosBonificados: number;
  puntosAjustados: number;
  puntosExpirados: number;
  saldoAntesDeExpirar: number;
  saldoFinal: number;
  totalMovimientos: number;
  ultimoMovimientoAt: Timestamp | null;
}

export interface HistorialPuntosUsuario {
  ultimoCicloProcesado: number;
  cicloActual: number;
  proximaExpiracionProgramada: Timestamp;
  resumenes: Record<string, ResumenPuntosAnual>;
}

/**
 * Enum para tipos de movimiento de puntos
 */
export enum TipoMovimientoPuntos {
  ACUMULACION = "ACUMULACION", // Ganancia de puntos
  CANJE = "CANJE", // Uso de puntos
  AJUSTE = "AJUSTE", // Ajuste manual por administrador
  EXPIRACION = "EXPIRACION", // Puntos expirados
  BONIFICACION = "BONIFICACION", // Puntos de regalo/promoción
  DEVOLUCION = "DEVOLUCION", // Devolución de puntos por cancelación
}

/**
 * Tipo para origen de puntos
 */
export type OrigenPuntos =
  | "tienda"
  | "comedor"
  | "promo"
  | "admin"
  | "referido"
  | "cumpleaños"
  | "evento"
  | string;

/**
 * DTOs para gestión de usuarios
 */

export interface ActualizarUsuarioAppDTO {
  nombre?: string;
  rol?: RolUsuario; // Permite cambiar rol del usuario
  telefono?: string;
  fechaNacimiento?: Date;
  nivel?: string;
  activo?: boolean;
}

/**
 * Interface para niveles de lealtad (configuración)
 */
export interface NivelLealtad {
  id?: string;
  nombre: string; // Ej: "Bronce", "Plata", "Oro"
  puntosMinimos: number; // Puntos necesarios para alcanzar este nivel
  beneficios: string[]; // Lista de beneficios del nivel
  multiplicador?: number; // Multiplicador de puntos (ej: 1.5x)
  color?: string; // Color para UI
  orden: number; // Orden de los niveles
}

/**
 * Interface para historial de canjes
 * Registra cuando un usuario canjea puntos por productos
 */
export interface CanjeProducto {
  id?: string;
  usuarioId: string;
  productoId: string;
  puntosUsados: number;
  cantidad: number;
  movimientoPuntosId: string; // Referencia al movimiento de puntos
  estado: "PENDIENTE" | "ENTREGADO" | "CANCELADO";
  ubicacionEntrega?: string;
  createdAt: Timestamp;
  entregadoAt?: Timestamp;
}
