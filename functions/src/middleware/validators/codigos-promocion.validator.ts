import { z } from "zod";

const codigoNormalizadoSchema = z
  .string()
  .trim()
  .min(3, "El código debe tener al menos 3 caracteres.")
  .max(30, "El código no puede superar 30 caracteres.")
  .regex(
    /^[A-Z0-9_-]+$/i,
    "El código solo puede contener letras, números, guion medio o guion bajo.",
  )
  .transform((value) => value.toUpperCase());

const idArraySchema = z.array(z.string().trim().min(1)).default([]);

const nullablePositiveIntSchema = z
  .number()
  .int("Debe ser un número entero.")
  .positive("Debe ser mayor a 0.")
  .nullable()
  .optional();



const fechaSchema = z.union([
  z.string().trim().min(1, "La fecha es obligatoria."),
  z.date(),
]);

const aplicaASchema = z.enum(["productos", "categorias", "lineas"]);

const baseCodigoPromocionSchema = z.object({
  codigo: codigoNormalizadoSchema,

  titulo: z
    .string()
    .trim()
    .min(3, "El título debe tener al menos 3 caracteres.")
    .max(120, "El título no puede superar 120 caracteres."),

  descripcion: z
    .string()
    .trim()
    .max(500, "La descripción no puede superar 500 caracteres.")
    .nullable()
    .optional(),

  estado: z.boolean().optional().default(true),

  tipoDescuento: z.literal("porcentaje").optional().default("porcentaje"),

  valorDescuento: z
    .number()
    .positive("El porcentaje debe ser mayor a 0.")
    .max(100, "El porcentaje no puede ser mayor a 100."),

  aplicaA: aplicaASchema,

  productoIds: idArraySchema,
  categoriaIds: idArraySchema,
  lineaIds: idArraySchema,
  tallaIds: idArraySchema,

  fechaInicio: fechaSchema,
  fechaFin: fechaSchema,

  hastaAgotarExistencias: z.boolean().optional().default(true),

  stockLimiteCodigo: nullablePositiveIntSchema,

  usoMaximoTotal: nullablePositiveIntSchema.default(null),

usoMaximoPorUsuario: z
  .number()
  .int("Debe ser un número entero.")
  .positive("Debe ser mayor a 0.")
  .optional()
  .default(1),

montoMinimoCompra: z
  .number()
  .positive("Debe ser mayor a 0.")
  .optional()
  .default(1),

  acumulableConOfertas: z.boolean().optional().default(false),
});

function validarAlcanceCodigoPromocion(
  data: {
    aplicaA?: "productos" | "categorias" | "lineas";
    productoIds?: string[];
    categoriaIds?: string[];
    lineaIds?: string[];
    hastaAgotarExistencias?: boolean;
    stockLimiteCodigo?: number | null;
    fechaInicio?: string | Date;
    fechaFin?: string | Date;
  },
  ctx: z.RefinementCtx,
) {
  if (data.fechaInicio && data.fechaFin) {
    const fechaInicio = new Date(data.fechaInicio);
    const fechaFin = new Date(data.fechaFin);

    if (Number.isNaN(fechaInicio.getTime())) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["fechaInicio"],
        message: "La fecha de inicio no es válida.",
      });
    }

    if (Number.isNaN(fechaFin.getTime())) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["fechaFin"],
        message: "La fecha de fin no es válida.",
      });
    }

    if (
      !Number.isNaN(fechaInicio.getTime()) &&
      !Number.isNaN(fechaFin.getTime()) &&
      fechaFin <= fechaInicio
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["fechaFin"],
        message: "La fecha de fin debe ser posterior a la fecha de inicio.",
      });
    }
  }

  if (!data.aplicaA) return;

  const productoIds = data.productoIds ?? [];
  const categoriaIds = data.categoriaIds ?? [];
  const lineaIds = data.lineaIds ?? [];

  if (data.aplicaA === "productos") {
    if (productoIds.length !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["productoIds"],
        message: "Selecciona exactamente un producto.",
      });
    }

    if (categoriaIds.length > 0 || lineaIds.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["aplicaA"],
        message:
          "Si el código aplica a productos, no debe incluir categorías ni líneas.",
      });
    }
  }

  if (data.aplicaA === "categorias") {
    if (categoriaIds.length !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["categoriaIds"],
        message: "Selecciona exactamente una categoría.",
      });
    }

    if (productoIds.length > 0 || lineaIds.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["aplicaA"],
        message:
          "Si el código aplica a categorías, no debe incluir productos ni líneas.",
      });
    }
  }

  if (data.aplicaA === "lineas") {
    if (lineaIds.length !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["lineaIds"],
        message: "Selecciona exactamente una línea.",
      });
    }

    if (productoIds.length > 0 || categoriaIds.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["aplicaA"],
        message:
          "Si el código aplica a líneas, no debe incluir productos ni categorías.",
      });
    }
  }

  if (
    data.hastaAgotarExistencias === false &&
    (!data.stockLimiteCodigo || data.stockLimiteCodigo <= 0)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["stockLimiteCodigo"],
      message:
        "Si no es hasta agotar existencias, debes indicar un límite de stock del código.",
    });
  }
}

export const createCodigoPromocionSchema =
  baseCodigoPromocionSchema.superRefine(validarAlcanceCodigoPromocion);

export const updateCodigoPromocionSchema = baseCodigoPromocionSchema
  .partial()
  .superRefine(validarAlcanceCodigoPromocion);

export const codigoPromocionParamsSchema = z.object({
  id: z.string().trim().min(1, "El ID del código promocional es obligatorio."),
});

export const listCodigosPromocionQuerySchema = z.object({
  estado: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => {
      if (value === "true") return true;
      if (value === "false") return false;
      return undefined;
    }),

  codigo: z.string().trim().optional(),

  aplicaA: aplicaASchema.optional(),

  productoId: z.string().trim().optional(),
  categoriaId: z.string().trim().optional(),
  lineaId: z.string().trim().optional(),

  incluirEliminados: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value === "true"),
});

export const validarCodigoPromocionSchema = z.object({
  codigo: codigoNormalizadoSchema,

  usuarioId: z.string().trim().min(1).nullable().optional(),

  items: z
    .array(
      z.object({
        productoId: z.string().trim().min(1, "El productoId es obligatorio."),

        cantidad: z
          .number()
          .int("La cantidad debe ser un número entero.")
          .positive("La cantidad debe ser mayor a 0."),

        precioUnitario: z
          .number()
          .min(0, "El precio unitario no puede ser negativo."),

        categoriaId: z.string().trim().min(1).nullable().optional(),
        lineaId: z.string().trim().min(1).nullable().optional(),
        tallaId: z.string().trim().min(1).nullable().optional(),
      }),
    )
    .min(1, "Debes enviar al menos un producto para validar el código."),
});