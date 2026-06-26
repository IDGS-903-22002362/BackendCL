/**
 * Modelos para gestión de inventario
 * Incluye: Stocks por ubicación/talla y Ubicaciones
 */

/**
 * Interface para Stock
 * Representa el inventario de un producto en una ubicación específica
 * con una talla específica (o sin talla si no aplica)
 */
export interface Stock {
  id?: string;
  productoId: string; // Referencia al producto
  tallaId: string | null; // ID de talla, null si el producto no tiene tallas
  ubicacionId: string; // ID de la ubicación (tienda, almacén, etc.)
  cantidad: number; // Cantidad disponible
  minimo?: number; // Cantidad mínima para generar alerta de reabastecimiento
  ultimaActualizacion?: Date; // Última vez que se actualizó el stock
}

/**
 * Interface para Ubicación
 * Define los lugares físicos donde se almacenan productos
 */
export interface Ubicacion {
  id?: string;
  nombre: string; // Nombre descriptivo (ej: "Tienda Estadio", "Almacén Central")
  tipo: TipoUbicacion; // Clasificación de la ubicación
  direccion?: string; // Dirección física (opcional)
  responsable?: string; // Nombre del responsable de la ubicación
  activo: boolean; // Si la ubicación está operativa
  orden?: number; // Para ordenar en interfaces
}

/**
 * Enum para tipos de ubicación
 */
export enum TipoUbicacion {
  TIENDA = "tienda",
  ALMACEN = "almacen",
  COMEDOR = "comedor",
  ESTADIO = "estadio",
  OFICINA = "oficina",
  OTRO = "otro",
}

/**
 * DTOs para manejo de inventario
 */
export interface CrearStockDTO {
  productoId: string;
  tallaId: string | null;
  ubicacionId: string;
  cantidad: number;
  minimo?: number;
}

export interface ActualizarStockDTO {
  cantidad?: number;
  minimo?: number;
}

export interface CrearUbicacionDTO {
  nombre: string;
  tipo: TipoUbicacion;
  direccion?: string;
  responsable?: string;
  activo: boolean;
  orden?: number;
}

/**
 * Interface para consultas de inventario
 * Útil para reportes y análisis
 */
export interface StockDetallado extends Stock {
  producto?: {
    clave: string;
    descripcion: string;
  };
  talla?: {
    codigo: string;
    descripcion: string;
  };
  ubicacion?: {
    nombre: string;
    tipo: string;
  };
}

export enum TipoMovimientoInventario {
  ENTRADA = "entrada",
  SALIDA = "salida",
  AJUSTE = "ajuste",
  VENTA = "venta",
  DEVOLUCION = "devolucion",
  RESERVA = "reserva",
  LIBERACION_RESERVA = "liberacion_reserva",
  RECEPCION = "recepcion",
  CONTEO_FISICO = "conteo_fisico",
}

export enum EstadoReservaInventario {
  ACTIVA = "activa",
  CONFIRMADA = "confirmada",
  LIBERADA = "liberada",
  EXPIRADA = "expirada",
}

export interface ReservaInventario {
  id?: string;
  ordenId?: string;
  checkoutAttemptId?: string;
  productoId: string;
  tallaId: string | null;
  cantidad: number;
  estado: EstadoReservaInventario;
  paymentAttemptId?: string;
  pagoId?: string;
  usuarioId?: string;
  expiraEn: Date;
  createdAt: Date;
  updatedAt?: Date;
  idempotencyKey: string;
  motivo?: string;
}

/**
 * Interface para movimientos de inventario.
 * Registra la trazabilidad de cambios de stock por producto/talla.
 */
export interface MovimientoInventario {
  id?: string;
  tipo: TipoMovimientoInventario;
  productoId: string;
  tallaId: string | null;
  cantidadAnterior: number;
  cantidadNueva: number;
  diferencia: number;
  motivo?: string;
  referencia?: string;
  ordenId?: string;
  ventaPosId?: string;
  usuarioId?: string;
  rolUsuario?: string;
  origen?: "manual" | "checkout" | "pago" | "sistema" | "migracion";
  idempotencyKey?: string;
  createdAt: Date;
}

export interface RegistrarMovimientoInventarioDTO {
  tipo: TipoMovimientoInventario;
  productoId: string;
  tallaId?: string;
  cantidad?: number;
  cantidadNueva?: number;
  motivo?: string;
  referencia?: string;
  ordenId?: string;
  ventaPosId?: string;
  usuarioId?: string;
  rolUsuario?: string;
  idempotencyKey?: string;
}

export interface RegistrarAjusteInventarioDTO {
  productoId: string;
  tallaId?: string;
  cantidadFisica: number;
  motivo: string;
  referencia?: string;
  usuarioId?: string;
  rolUsuario?: string;
  idempotencyKey?: string;
}

export interface RegistrarAjusteInventarioResult {
  movimiento: MovimientoInventario;
  reused: boolean;
}

export interface ListarMovimientosInventarioQuery {
  productoId?: string;
  tallaId?: string;
  tipo?: TipoMovimientoInventario;
  ordenId?: string;
  fechaDesde?: string;
  fechaHasta?: string;
  limit: number;
  cursor?: string;
  usuarioId?: string;
}

export interface AlertaStockTalla {
  tallaId: string;
  cantidadActual: number;
  minimo: number;
  deficit: number;
}

export interface AlertaStockProducto {
  productoId: string;
  clave: string;
  descripcion: string;
  lineaId: string;
  categoriaId: string;
  existencias: number;
  stockMinimoGlobal: number;
  globalBajoStock: boolean;
  tallasBajoStock: AlertaStockTalla[];
  totalAlertas: number;
  maxDeficit: number;
}

export interface ListarAlertasStockQuery {
  lineaId?: string;
  categoriaId?: string;
  productoId?: string;
  soloCriticas?: boolean;
  limit: number;
}

export interface DashboardInventarioItem {
  productoId: string;
  clave: string;
  descripcion: string;
  lineaId: string;
  categoriaId: string;
  tallaIds: string[];
  existencias: number;
  fisica: number;
  reservada: number;
  noDisponible: number;
  entrante: number;
  disponible: number;
  inventarioPorTalla: Array<{
    tallaId: string;
    cantidad: number;
    fisica: number;
    reservada: number;
    noDisponible: number;
    entrante: number;
  }>;
  stockMinimoGlobal: number;
  bajoStock: boolean;
  /** true cuando hay unidades bloqueadas en checkout (no es venta). */
  reservadaEnCheckout: boolean;
}

export interface DiagnosticoInventarioProducto {
  productoId: string;
  clave: string;
  descripcion: string;
  consistente: boolean;
  problemas: string[];
  proyeccion: DashboardInventarioItem;
  reservasActivas: number;
}

export interface ListarDashboardInventarioQuery {
  q?: string;
  lineaId?: string;
  categoriaId?: string;
  soloBajoStock?: boolean;
  limit: number;
  cursor?: string;
}

export enum EstadoRecepcionMercancia {
  BORRADOR = "borrador",
  PARCIAL = "parcial",
  CERRADA = "cerrada",
  CANCELADA = "cancelada",
}

export interface LineaRecepcionMercancia {
  productoId: string;
  tallaId: string | null;
  cantidadEsperada: number;
  cantidadAceptada: number;
  cantidadRechazada: number;
  cantidadPendiente: number;
}

export interface RecepcionMercancia {
  id?: string;
  proveedorId?: string;
  proveedorNombre?: string;
  referencia: string;
  fechaRecepcion: Date;
  responsableId: string;
  responsableNombre?: string;
  estado: EstadoRecepcionMercancia;
  lineas: LineaRecepcionMercancia[];
  notas?: string;
  cerradaEn?: Date;
  createdAt: Date;
  updatedAt?: Date;
}

export interface CrearRecepcionMercanciaDTO {
  proveedorId?: string;
  proveedorNombre?: string;
  referencia: string;
  fechaRecepcion: string;
  notas?: string;
  lineas?: Array<{
    productoId: string;
    tallaId?: string;
    cantidadEsperada: number;
  }>;
  responsableId: string;
  responsableNombre?: string;
}

export interface ConfirmarRecepcionMercanciaDTO {
  recepcionId: string;
  lineas: Array<{
    productoId: string;
    tallaId?: string;
    cantidadAceptada: number;
    cantidadRechazada: number;
  }>;
  responsableId: string;
  idempotencyKey?: string;
}

export interface ListarRecepcionesMercanciaQuery {
  estado?: EstadoRecepcionMercancia;
  proveedorId?: string;
  referencia?: string;
  limit: number;
  cursor?: string;
}

export interface DashboardAlertasStock {
  resumen: {
    totalProductosBajoStock: number;
    totalAlertas: number;
    alertasCriticas: number;
    alertasModeradas: number;
    fechaCorte: Date;
  };
  alertas: AlertaStockProducto[];
}
