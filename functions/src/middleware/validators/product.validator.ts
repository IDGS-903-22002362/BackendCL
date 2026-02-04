import { z } from "zod";

/**
 * Schema para crear un nuevo producto
 * Valida todos los campos requeridos según el modelo Producto
 */
export const createProductSchema = z
  .object({
    clave: z
      .string({
        required_error: "La clave del producto es requerida",
        invalid_type_error: "La clave debe ser una cadena de texto",
      })
      .trim()
      .min(1, "La clave no puede estar vacía")
      .max(50, "La clave no puede exceder 50 caracteres"),

    descripcion: z
      .string({
        required_error: "La descripción del producto es requerida",
        invalid_type_error: "La descripción debe ser una cadena de texto",
      })
      .trim()
      .min(1, "La descripción no puede estar vacía")
      .max(200, "La descripción no puede exceder 200 caracteres"),

    lineaId: z
      .string({
        required_error: "El ID de línea es requerido",
        invalid_type_error: "El ID de línea debe ser una cadena de texto",
      })
      .min(1, "El ID de línea no puede estar vacío"),

    categoriaId: z
      .string({
        required_error: "El ID de categoría es requerido",
        invalid_type_error: "El ID de categoría debe ser una cadena de texto",
      })
      .min(1, "El ID de categoría no puede estar vacío"),

    precioPublico: z
      .number({
        required_error: "El precio público es requerido",
        invalid_type_error: "El precio público debe ser un número",
      })
      .positive("El precio público debe ser mayor a 0"),

    precioCompra: z
      .number({
        required_error: "El precio de compra es requerido",
        invalid_type_error: "El precio de compra debe ser un número",
      })
      .nonnegative("El precio de compra no puede ser negativo"),

    existencias: z
      .number({
        required_error: "Las existencias son requeridas",
        invalid_type_error: "Las existencias deben ser un número",
      })
      .int("Las existencias deben ser un número entero")
      .nonnegative("Las existencias no pueden ser negativas"),

    proveedorId: z
      .string({
        required_error: "El ID de proveedor es requerido",
        invalid_type_error: "El ID de proveedor debe ser una cadena de texto",
      })
      .min(1, "El ID de proveedor no puede estar vacío"),

    tallaIds: z
      .array(z.string().min(1, "Los IDs de talla no pueden estar vacíos"), {
        invalid_type_error: "Los IDs de talla deben ser un array",
      })
      .max(50, "No se pueden asignar más de 50 tallas")
      .optional()
      .default([]),

    imagenes: z
      .array(z.string().url("Las URLs de imágenes deben ser válidas"), {
        invalid_type_error: "Las imágenes deben ser un array de URLs",
      })
      .max(10, "No se pueden asignar más de 10 imágenes")
      .optional()
      .default([]),

    activo: z
      .boolean({
        invalid_type_error: "El campo activo debe ser un booleano",
      })
      .optional()
      .default(true),
  })
  .strict(); // Rechaza campos extra (prevención de mass assignment)

/**
 * Schema para actualizar un producto existente
 * Todos los campos son opcionales (actualización parcial)
 */
export const updateProductSchema = z
  .object({
    clave: z
      .string({
        invalid_type_error: "La clave debe ser una cadena de texto",
      })
      .trim()
      .min(1, "La clave no puede estar vacía")
      .max(50, "La clave no puede exceder 50 caracteres")
      .optional(),

    descripcion: z
      .string({
        invalid_type_error: "La descripción debe ser una cadena de texto",
      })
      .trim()
      .min(1, "La descripción no puede estar vacía")
      .max(200, "La descripción no puede exceder 200 caracteres")
      .optional(),

    lineaId: z
      .string({
        invalid_type_error: "El ID de línea debe ser una cadena de texto",
      })
      .min(1, "El ID de línea no puede estar vacío")
      .optional(),

    categoriaId: z
      .string({
        invalid_type_error: "El ID de categoría debe ser una cadena de texto",
      })
      .min(1, "El ID de categoría no puede estar vacío")
      .optional(),

    precioPublico: z
      .number({
        invalid_type_error: "El precio público debe ser un número",
      })
      .positive("El precio público debe ser mayor a 0")
      .optional(),

    precioCompra: z
      .number({
        invalid_type_error: "El precio de compra debe ser un número",
      })
      .nonnegative("El precio de compra no puede ser negativo")
      .optional(),

    existencias: z
      .number({
        invalid_type_error: "Las existencias deben ser un número",
      })
      .int("Las existencias deben ser un número entero")
      .nonnegative("Las existencias no pueden ser negativas")
      .optional(),

    proveedorId: z
      .string({
        invalid_type_error: "El ID de proveedor debe ser una cadena de texto",
      })
      .min(1, "El ID de proveedor no puede estar vacío")
      .optional(),

    tallaIds: z
      .array(z.string().min(1, "Los IDs de talla no pueden estar vacíos"))
      .max(50, "No se pueden asignar más de 50 tallas")
      .optional(),

    imagenes: z
      .array(z.string().url("Las URLs de imágenes deben ser válidas"))
      .max(10, "No se pueden asignar más de 10 imágenes")
      .optional(),

    activo: z
      .boolean({
        invalid_type_error: "El campo activo debe ser un booleano",
      })
      .optional(),
  })
  .strict(); // Rechaza campos extra

/**
 * Schema para validar body al eliminar imagen de producto
 */
export const deleteImageSchema = z
  .object({
    imageUrl: z
      .string({
        required_error: "La URL de la imagen es requerida",
        invalid_type_error: "La URL debe ser una cadena de texto",
      })
      .url("La URL de la imagen debe ser válida")
      .min(1, "La URL no puede estar vacía"),
  })
  .strict();
