/**
 * Modelos para catálogos auxiliares del sistema
 * Incluye: Líneas, Categorías, Proveedores y Tallas
 */

/**
 * Interface para Línea de productos
 * Ej: caballero, dama, infantil, souvenir, bebé
 */
export interface Linea {
  id?: string;
  codigo: number; // Código numérico único para ordenamiento
  nombre: string; // Nombre de la línea (ej: "Caballero", "Dama")
}

/**
 * Interface para Categoría de productos
 * Ej: playera, gorra, sudadera, balón
 */
export interface Categoria {
  id?: string;
  nombre: string; // Nombre de la categoría
  lineaId?: string; // Opcional: asociar categoría a una línea específica
  orden?: number; // Opcional: para ordenar en UI
}

/**
 * Interface para Proveedor
 * Representa a los proveedores de productos
 */
export interface Proveedor {
  id?: string;
  nombre: string; // Razón social o nombre del proveedor
  contacto?: string; // Nombre de persona de contacto
  telefono?: string; // Teléfono de contacto
  email?: string; // Email de contacto
  direccion?: string; // Dirección física
  activo: boolean; // Si el proveedor está activo
  notas?: string; // Notas adicionales
}

/**
 * Interface para Talla
 * Define los tamaños disponibles para productos
 */
export interface Talla {
  id?: string; // El ID puede ser el código mismo (ej: "xs", "s", "m")
  codigo: string; // Código corto (ej: "S", "M", "L", "XL")
  descripcion: string; // Descripción completa (ej: "Small", "Medium", "Large")
  orden?: number; // Para ordenar correctamente (XS=1, S=2, M=3, etc.)
}

/**
 * DTOs para crear catálogos
 */
export interface CrearLineaDTO {
  codigo: number;
  nombre: string;
}

export interface CrearCategoriaDTO {
  nombre: string;
  lineaId?: string;
  orden?: number;
}

export interface CrearProveedorDTO {
  nombre: string;
  contacto?: string;
  telefono?: string;
  email?: string;
  direccion?: string;
  activo: boolean;
  notas?: string;
}

export interface CrearTallaDTO {
  codigo: string;
  descripcion: string;
  orden?: number;
}
