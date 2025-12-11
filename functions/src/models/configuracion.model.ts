/**
 * Modelos para configuración del sistema
 * Define reglas de negocio y parámetros configurables
 */

/**
 * Interface para configuración del sistema de puntos
 * Documento en colección 'configuracion' con id 'puntos'
 */
export interface ConfiguracionPuntos {
  id?: string;
  puntosPorPesoTienda: number; // Ej: 1 punto por cada $10 pesos gastados en tienda
  puntosPorPesoComedor: number; // Ej: 1 punto por cada $5 pesos gastados en comedor
  valorPuntoEnPesos: number; // Ej: 1 punto = $1 peso para canjes
  puntosMinimoCanje: number; // Puntos mínimos requeridos para hacer un canje
  diasExpiracionPuntos?: number; // Días antes de que expiren los puntos
  activo: boolean; // Si el sistema de puntos está activo
  actualizadoAt?: Date; // Última actualización de la configuración
}

/**
 * Interface para configuración general de la tienda
 */
export interface ConfiguracionTienda {
  id?: string;
  nombreTienda: string;
  horarioAtencion?: string;
  telefonoContacto?: string;
  emailContacto?: string;
  permitirComprasSinStock: boolean; // Permitir preventa
  diasMaximosDevolucion: number; // Días para aceptar devoluciones
  iva: number; // Porcentaje de IVA (ej: 0.16 para 16%)
  costoEnvio?: number; // Costo de envío (si aplica)
  envioGratisMinimo?: number; // Monto mínimo para envío gratis
  activo: boolean;
}

/**
 * Interface para configuración de promociones
 */
export interface ConfiguracionPromocion {
  id?: string;
  nombre: string;
  descripcion: string;
  tipo: TipoPromocion;
  descuento?: number; // Porcentaje o cantidad de descuento
  puntosBonus?: number; // Puntos adicionales a otorgar
  productosAplicables?: string[]; // IDs de productos (vacío = todos)
  categoriasAplicables?: string[]; // IDs de categorías
  fechaInicio: Date;
  fechaFin: Date;
  activo: boolean;
  codigoPromocional?: string; // Código para aplicar la promoción
  usoMaximoPorUsuario?: number; // Límite de usos por usuario
}

/**
 * Enum para tipos de promoción
 */
export enum TipoPromocion {
  DESCUENTO_PORCENTAJE = "DESCUENTO_PORCENTAJE", // Ej: 20% de descuento
  DESCUENTO_FIJO = "DESCUENTO_FIJO", // Ej: $100 de descuento
  PUNTOS_DOBLES = "PUNTOS_DOBLES", // 2x puntos en compras
  PUNTOS_BONUS = "PUNTOS_BONUS", // Puntos adicionales fijos
  PRODUCTO_GRATIS = "PRODUCTO_GRATIS", // Regalo con compra
  ENVIO_GRATIS = "ENVIO_GRATIS", // Envío sin costo
}

/**
 * Interface para alertas y notificaciones del sistema
 */
export interface ConfiguracionAlertas {
  id?: string;
  alertaStockMinimo: boolean; // Notificar cuando stock < mínimo
  alertaNuevoPedido: boolean; // Notificar al recibir pedidos
  emailsNotificacion: string[]; // Lista de emails para notificaciones
  whatsappNotificacion?: string; // Número para notificaciones WhatsApp
  activo: boolean;
}

/**
 * DTOs para actualizar configuraciones
 */
export interface ActualizarConfiguracionPuntosDTO {
  puntosPorPesoTienda?: number;
  puntosPorPesoComedor?: number;
  valorPuntoEnPesos?: number;
  puntosMinimoCanje?: number;
  diasExpiracionPuntos?: number;
  activo?: boolean;
}

export interface ActualizarConfiguracionTiendaDTO {
  nombreTienda?: string;
  horarioAtencion?: string;
  telefonoContacto?: string;
  emailContacto?: string;
  permitirComprasSinStock?: boolean;
  diasMaximosDevolucion?: number;
  iva?: number;
  costoEnvio?: number;
  envioGratisMinimo?: number;
  activo?: boolean;
}
