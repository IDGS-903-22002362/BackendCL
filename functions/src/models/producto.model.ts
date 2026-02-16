/**
 * Modelo e interfaces para la entidad Producto
 * Representa los artículos disponibles en la tienda del Club León
 */

import { Timestamp } from "firebase-admin/firestore";

/**
 * Interface para inventario por talla
 * Cada elemento representa el stock disponible para una talla específica
 */
export interface InventarioPorTalla {
  tallaId: string;
  cantidad: number;
}

export interface StockMinimoPorTalla {
  tallaId: string;
  minimo: number;
}

/**
 * Interface principal de Producto
 * Representa un artículo en la colección 'productos' de Firestore
 */
export interface Producto {
  id?: string; // ID del documento en Firestore (opcional al crear)
  clave: string; // SKU único asignado por el administrador
  descripcion: string; // Nombre/descripción del producto
  lineaId: string; // Referencia a documento en colección 'lineas'
  categoriaId: string; // Referencia a documento en colección 'categorias'
  precioPublico: number; // Precio de venta al público
  precioCompra: number; // Costo de adquisición
  existencias: number; // Stock total general (suma de todos los stocks)
  proveedorId: string; // Referencia a documento en colección 'proveedores'
  tallaIds: string[]; // Array de IDs de tallas disponibles
  inventarioPorTalla: InventarioPorTalla[]; // Stock por talla (fuente de verdad)
  stockMinimoGlobal: number; // Umbral mínimo global para alertas de stock bajo
  stockMinimoPorTalla: StockMinimoPorTalla[]; // Umbrales mínimos opcionales por talla
  imagenes: string[]; // Array de URLs de imágenes del producto
  activo: boolean; // Si el producto está disponible para venta
  createdAt: Timestamp; // Fecha de creación
  updatedAt: Timestamp; // Fecha de última actualización
}

/**
 * DTO para crear un nuevo producto
 * Omite campos autogenerados como id, createdAt, updatedAt
 */
export interface CrearProductoDTO {
  clave: string;
  descripcion: string;
  lineaId: string;
  categoriaId: string;
  precioPublico: number;
  precioCompra: number;
  existencias: number;
  proveedorId: string;
  tallaIds: string[];
  inventarioPorTalla: InventarioPorTalla[];
  stockMinimoGlobal: number;
  stockMinimoPorTalla: StockMinimoPorTalla[];
  imagenes: string[];
  activo: boolean;
}

/**
 * DTO para actualizar un producto existente
 * Todos los campos son opcionales excepto los timestamps que se manejan automáticamente
 */
export interface ActualizarProductoDTO {
  clave?: string;
  descripcion?: string;
  lineaId?: string;
  categoriaId?: string;
  precioPublico?: number;
  precioCompra?: number;
  existencias?: number;
  proveedorId?: string;
  tallaIds?: string[];
  inventarioPorTalla?: InventarioPorTalla[];
  stockMinimoGlobal?: number;
  stockMinimoPorTalla?: StockMinimoPorTalla[];
  imagenes?: string[];
  activo?: boolean;
}

/**
 * Interface para producto con información populada
 * Útil para respuestas de API que incluyan datos relacionados
 */
export interface ProductoDetallado extends Producto {
  linea?: {
    codigo: number;
    nombre: string;
  };
  categoria?: {
    nombre: string;
  };
  proveedor?: {
    nombre: string;
  };
  tallas?: Array<{
    codigo: string;
    descripcion: string;
  }>;
}
