import { z } from "zod";

const booleanQuerySchema = z.preprocess((value) => {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "si", "sí"].includes(normalized)) {
      return true;
    }
    if (["false", "0", "no"].includes(normalized)) {
      return false;
    }
  }
  return value;
}, z.boolean());

const numberQuerySchema = (schema: z.ZodNumber) =>
  z.preprocess((value) => {
    if (value === undefined || value === "") {
      return undefined;
    }
    return typeof value === "string" ? Number(value) : value;
  }, schema);

const trimmedOptionalQueryString = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .optional();

const inventarioPorTallaItemSchema = z
  .object({
    tallaId: z
      .string({
        required_error: "El ID de talla es requerido",
        invalid_type_error: "El ID de talla debe ser una cadena de texto",
      })
      .trim()
      .min(1, "El ID de talla no puede estar vacío"),
    cantidad: z
      .number({
        required_error: "La cantidad de inventario por talla es requerida",
        invalid_type_error: "La cantidad debe ser un número",
      })
      .int("La cantidad debe ser un número entero")
      .nonnegative("La cantidad no puede ser negativa"),
  })
  .strict();

const stockMinimoPorTallaItemSchema = z
  .object({
    tallaId: z
      .string({
        required_error: "El ID de talla es requerido",
        invalid_type_error: "El ID de talla debe ser una cadena de texto",
      })
      .trim()
      .min(1, "El ID de talla no puede estar vacío"),
    minimo: z
      .number({
        required_error: "El mínimo por talla es requerido",
        invalid_type_error: "El mínimo por talla debe ser un número",
      })
      .int("El mínimo por talla debe ser un número entero")
      .nonnegative("El mínimo por talla no puede ser negativo"),
  })
  .strict();

const hasUniqueTallaIds = (items: Array<{ tallaId: string }>): boolean => {
  const uniqueIds = new Set(items.map((item) => item.tallaId));
  return uniqueIds.size === items.length;
};

const hasUniqueStringValues = (items: string[]): boolean => {
  const unique = new Set(items);
  return unique.size === items.length;
};

const fedexShippingSchema = z
  .object({
    enabled: z.boolean().optional(),
    weightKg: z.number().positive("El peso FedEx debe ser mayor a 0").optional(),
    lengthCm: z.number().positive("El largo FedEx debe ser mayor a 0").optional(),
    widthCm: z.number().positive("El ancho FedEx debe ser mayor a 0").optional(),
    heightCm: z.number().positive("El alto FedEx debe ser mayor a 0").optional(),
    packageType: z.literal("YOUR_PACKAGING").optional().default("YOUR_PACKAGING"),
    declaredValue: z.number().nonnegative().optional(),
    countryOfManufacture: z.literal("MX").optional(),
    customsDescription: z.string().trim().max(200).optional(),
    hsCode: z.string().trim().max(40).optional(),
  })
  .strict();

const shippingSchema = z
  .object({
    requiresShipping: z.boolean().optional(),
    weightKg: z.number().positive("El peso de envío debe ser mayor a 0").optional(),
    lengthCm: z.number().positive("El largo de envío debe ser mayor a 0").optional(),
    widthCm: z.number().positive("El ancho de envío debe ser mayor a 0").optional(),
    heightCm: z.number().positive("El alto de envío debe ser mayor a 0").optional(),
  })
  .strict();

export const catalogProductQuerySchema = z
  .object({
    limit: numberQuerySchema(
      z
        .number()
        .int("limit debe ser un entero")
        .min(1, "limit debe ser mayor a 0")
        .max(48, "limit no puede exceder 48"),
    )
      .optional()
      .default(24),
    cursor: z.string().trim().min(1).max(1200).optional(),
    category: trimmedOptionalQueryString,
    categoria: trimmedOptionalQueryString,
    line: trimmedOptionalQueryString,
    linea: trimmedOptionalQueryString,
    talla: trimmedOptionalQueryString,
    minPrice: numberQuerySchema(
      z.number().nonnegative("minPrice no puede ser negativo"),
    ).optional(),
    maxPrice: numberQuerySchema(
      z.number().nonnegative("maxPrice no puede ser negativo"),
    ).optional(),
    sort: z
      .enum([
        "destacados",
        "populares",
        "mas_comprados",
        "precio_asc",
        "precio_desc",
        "recientes",
        "nombre_asc",
        "ofertas_populares",
        "ofertas_mas_compradas",
        "ofertas_recientes",
      ])
      .optional()
      .default("destacados"),
    q: z.string().trim().min(1).max(80).optional(),
    onlyOffers: booleanQuerySchema.optional().default(false),
    onlyAvailable: booleanQuerySchema.optional().default(false),
  })
  .strict()
  .refine(
    (query) => !(query.category && query.categoria && query.category !== query.categoria),
    {
      message: "Usa solo category o categoria con el mismo valor",
      path: ["category"],
    },
  )
  .refine((query) => !(query.line && query.linea && query.line !== query.linea), {
    message: "Usa solo line o linea con el mismo valor",
    path: ["line"],
  })
  .refine(
    (query) =>
      query.minPrice === undefined ||
      query.maxPrice === undefined ||
      query.minPrice <= query.maxPrice,
    {
      message: "minPrice no puede ser mayor que maxPrice",
      path: ["minPrice"],
    },
  );

export const adminProductsQuerySchema = z
  .object({
    estado: z.enum(["activo", "inactivo", "todos"]).optional().default("todos"),
  })
  .strict();

export const updateProductActiveStatusSchema = z
  .object({
    activo: z.boolean({
      required_error: "El campo activo es requerido",
      invalid_type_error: "El campo activo debe ser un booleano",
    }),
  })
  .strict();

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

    destacado: z
      .boolean({
        invalid_type_error: "El campo destacado debe ser un booleano",
      })
      .optional()
      .default(false),

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
      .refine(hasUniqueStringValues, "No se permiten tallas duplicadas")
      .optional()
      .default([]),

    inventarioPorTalla: z
      .array(inventarioPorTallaItemSchema, {
        invalid_type_error: "El inventario por talla debe ser un array",
      })
      .max(50, "No se pueden asignar más de 50 tallas de inventario")
      .refine(
        hasUniqueTallaIds,
        "No se permiten tallas duplicadas en inventarioPorTalla",
      )
      .optional()
      .default([]),

    stockMinimoGlobal: z
      .number({
        invalid_type_error: "El stock mínimo global debe ser un número",
      })
      .int("El stock mínimo global debe ser un número entero")
      .nonnegative("El stock mínimo global no puede ser negativo")
      .optional()
      .default(5),

    stockMinimoPorTalla: z
      .array(stockMinimoPorTallaItemSchema, {
        invalid_type_error: "El stock mínimo por talla debe ser un array",
      })
      .max(50, "No se pueden asignar más de 50 umbrales por talla")
      .refine(
        hasUniqueTallaIds,
        "No se permiten tallas duplicadas en stockMinimoPorTalla",
      )
      .optional()
      .default([]),

    imagenes: z
      .array(z.string().url("Las URLs de imágenes deben ser válidas"), {
        invalid_type_error: "Las imágenes deben ser un array de URLs",
      })
      .max(10, "No se pueden asignar más de 10 imágenes")
      .optional()
      .default([]),

    detalleIds: z
      .array(z.string().min(1, "Los IDs del detalle no pueden estar vacíos"), {
        invalid_type_error: "Los IDs del detalle deben ser un array",
      })
      .max(50, "No se pueden asignar más de 50 detalles")
      .refine(hasUniqueStringValues, "No se permiten detalles duplicados")
      .optional()
      .default([]),

    fedexShipping: fedexShippingSchema.optional(),

    shipping: shippingSchema.optional(),

    activo: z
      .boolean({
        invalid_type_error: "El campo activo debe ser un booleano",
      })
      .optional()
      .default(true),

    personalizable: z.boolean().optional(),
    personalizationFeeMxn: z.number().nonnegative().optional(),
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

    destacado: z
      .boolean({
        invalid_type_error: "El campo destacado debe ser un booleano",
      })
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
      .refine(hasUniqueStringValues, "No se permiten tallas duplicadas")
      .optional(),

    inventarioPorTalla: z
      .array(inventarioPorTallaItemSchema)
      .max(50, "No se pueden asignar más de 50 tallas de inventario")
      .refine(
        hasUniqueTallaIds,
        "No se permiten tallas duplicadas en inventarioPorTalla",
      )
      .optional(),

    stockMinimoGlobal: z
      .number({
        invalid_type_error: "El stock mínimo global debe ser un número",
      })
      .int("El stock mínimo global debe ser un número entero")
      .nonnegative("El stock mínimo global no puede ser negativo")
      .optional(),

    stockMinimoPorTalla: z
      .array(stockMinimoPorTallaItemSchema)
      .max(50, "No se pueden asignar más de 50 umbrales por talla")
      .refine(
        hasUniqueTallaIds,
        "No se permiten tallas duplicadas en stockMinimoPorTalla",
      )
      .optional(),

    imagenes: z
      .array(z.string().url("Las URLs de imágenes deben ser válidas"))
      .max(10, "No se pueden asignar más de 10 imágenes")
      .optional(),

    detalleIds: z
      .array(z.string().min(1, "Los IDs del detalle no pueden estar vacíos"), {
        invalid_type_error: "Los IDs del detalle deben ser un array",
      })
      .max(50, "No se pueden asignar más de 50 detalles")
      .refine(hasUniqueStringValues, "No se permiten detalles duplicados")
      .optional()
      .default([]),

    fedexShipping: fedexShippingSchema.optional(),

    shipping: shippingSchema.optional(),

    activo: z
      .boolean({
        invalid_type_error: "El campo activo debe ser un booleano",
      })
      .optional(),

    personalizable: z.boolean().optional(),
    personalizationFeeMxn: z.number().nonnegative().optional(),
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

/**
 * Schema para actualizar stock de producto
 * Permite actualización general o por talla según aplique
 */
export const updateProductStockSchema = z
  .object({
    cantidadNueva: z
      .number({
        required_error: "La nueva cantidad es requerida",
        invalid_type_error: "La nueva cantidad debe ser un número",
      })
      .int("La nueva cantidad debe ser un número entero")
      .nonnegative("La nueva cantidad no puede ser negativa"),

    tallaId: z
      .string({
        invalid_type_error: "El ID de talla debe ser una cadena de texto",
      })
      .trim()
      .min(1, "El ID de talla no puede estar vacío")
      .optional(),

    tipo: z
      .enum(["entrada", "salida", "ajuste", "venta", "devolucion"], {
        invalid_type_error: "El tipo de movimiento es inválido",
      })
      .optional()
      .default("ajuste"),

    motivo: z
      .string({
        invalid_type_error: "El motivo debe ser una cadena de texto",
      })
      .trim()
      .max(200, "El motivo no puede exceder 200 caracteres")
      .optional(),

    referencia: z
      .string({
        invalid_type_error: "La referencia debe ser una cadena de texto",
      })
      .trim()
      .max(120, "La referencia no puede exceder 120 caracteres")
      .optional(),
  })
  .strict();

export const replaceSizeInventorySchema = z
  .object({
    inventarioPorTalla: z
      .array(inventarioPorTallaItemSchema, {
        required_error: "El inventario por talla es requerido",
        invalid_type_error: "El inventario por talla debe ser un array",
      })
      .max(50, "No se pueden asignar más de 50 tallas de inventario")
      .refine(
        hasUniqueTallaIds,
        "No se permiten tallas duplicadas en inventarioPorTalla",
      ),

    motivo: z
      .string({
        invalid_type_error: "El motivo debe ser una cadena de texto",
      })
      .trim()
      .max(200, "El motivo no puede exceder 200 caracteres")
      .optional(),

    referencia: z
      .string({
        invalid_type_error: "La referencia debe ser una cadena de texto",
      })
      .trim()
      .max(120, "La referencia no puede exceder 120 caracteres")
      .optional(),
  })
  .strict();

export const rateProductSchema = z
  .object({
    score: z
      .number({
        required_error: "La calificación es requerida",
        invalid_type_error: "La calificación debe ser un número",
      })
      .int("La calificación debe ser un número entero")
      .min(1, "La calificación mínima es 1")
      .max(5, "La calificación máxima es 5"),
  })
  .strict();
