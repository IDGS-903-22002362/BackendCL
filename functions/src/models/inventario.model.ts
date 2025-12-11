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

/**
 * Interface para movimientos de inventario (para futuro)
 * Registra entradas, salidas, traspasos, ajustes
 */
export interface MovimientoInventario {
  id?: string;
  tipo: "ENTRADA" | "SALIDA" | "TRASPASO" | "AJUSTE" | "VENTA" | "DEVOLUCION";
  productoId: string;
  tallaId: string | null;
  ubicacionOrigenId?: string; // Para traspasos
  ubicacionDestinoId: string;
  cantidad: number;
  referencia?: string; // Número de orden, ticket, etc.
  notas?: string;
  usuarioId?: string; // Quien realizó el movimiento
  createdAt: Date;
}
