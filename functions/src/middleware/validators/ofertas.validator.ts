import { z } from "zod";

export const tipoDescuentoSchema = z.enum([
  "precio_fijo",
  "porcentaje",
  "monto",
]);

export const alcanceOfertaSchema = z.enum([
  "productos",
  "categorias",
  "lineas",
  "todo",
]);

const fechaOfertaSchema = z
  .string()
  .trim()
  .min(1, "La fecha es obligatoria")
  .refine((value) => !Number.isNaN(Date.parse(value)), {
    message: "La fecha debe ser válida",
  });

const idsArraySchema = z
  .array(z.string().trim().min(1, "El ID no puede estar vacío"))
  .optional();

const tallaIdsArraySchema = z
  .array(z.string().trim().min(1, "El ID de la talla no puede estar vacío"))
  .optional();

export const ofertaIdParamSchema = z
  .object({
    id: z.string().trim().min(1, "El ID de la oferta es obligatorio"),
  })
  .strict();

export const createOfertaSchema = z
  .object({
    titulo: z
      .string()
      .trim()
      .min(1, "El título es obligatorio")
      .max(120, "El título no puede superar los 120 caracteres"),

    descripcion: z
      .string()
      .trim()
      .max(500, "La descripción no puede superar los 500 caracteres")
      .optional(),

    estado: z.boolean().optional().default(true),

    tallaIds: z
      .array(z.string().trim().min(1, "El ID de la talla no puede estar vacío"))
      .optional()
      .default([]),

    tipoDescuento: tipoDescuentoSchema,

    valorDescuento: z
      .number({
        required_error: "El valor del descuento es obligatorio",
        invalid_type_error: "El valor del descuento debe ser numérico",
      })
      .positive("El valor del descuento debe ser mayor a 0"),

    aplicaA: alcanceOfertaSchema,

    productoIds: idsArraySchema,
    categoriaIds: idsArraySchema,
    lineaIds: idsArraySchema,

    fechaInicio: fechaOfertaSchema,
    fechaFin: fechaOfertaSchema,

    hastaAgotarExistencias: z.boolean().optional().default(false),

    stockLimiteOferta: z
      .number({
        invalid_type_error: "El límite de stock debe ser numérico",
      })
      .int("El límite de stock debe ser un número entero")
      .positive("El límite de stock debe ser mayor a 0")
      .nullable()
      .optional(),

    prioridad: z
      .number({
        invalid_type_error: "La prioridad debe ser numérica",
      })
      .int("La prioridad debe ser un número entero")
      .min(1, "La prioridad mínima es 1")
      .optional()
      .default(1),

    combinable: z.boolean().optional().default(false),

    badgeTexto: z
      .string()
      .trim()
      .max(40, "El texto del badge no puede superar los 40 caracteres")
      .optional(),

    mostrarBadge: z.boolean().optional().default(true),
  })
  .strict()
  .refine((data) => new Date(data.fechaFin) > new Date(data.fechaInicio), {
    message: "La fecha de fin debe ser posterior a la fecha de inicio",
    path: ["fechaFin"],
  })
  .refine(
    (data) => {
      if (data.tipoDescuento === "porcentaje") {
        return data.valorDescuento > 0 && data.valorDescuento <= 100;
      }

      return true;
    },
    {
      message: "El porcentaje de descuento debe estar entre 1 y 100",
      path: ["valorDescuento"],
    }
  )
  .refine(
    (data) => {
      if (data.aplicaA === "productos") {
        return Array.isArray(data.productoIds) && data.productoIds.length > 0;
      }

      if (data.aplicaA === "categorias") {
        return Array.isArray(data.categoriaIds) && data.categoriaIds.length > 0;
      }

      if (data.aplicaA === "lineas") {
        return Array.isArray(data.lineaIds) && data.lineaIds.length > 0;
      }

      return true;
    },
    {
      message: "Debes seleccionar al menos un elemento según el alcance de la oferta",
      path: ["aplicaA"],
    }

  );

export const updateOfertaSchema = z
  .object({
    titulo: z
      .string()
      .trim()
      .min(1, "El título no puede estar vacío")
      .max(120, "El título no puede superar los 120 caracteres")
      .optional(),

    descripcion: z
      .string()
      .trim()
      .max(500, "La descripción no puede superar los 500 caracteres")
      .optional(),

    estado: z.boolean().optional(),

    tallaIds: tallaIdsArraySchema,

    tipoDescuento: tipoDescuentoSchema.optional(),

    valorDescuento: z
      .number({
        invalid_type_error: "El valor del descuento debe ser numérico",
      })
      .positive("El valor del descuento debe ser mayor a 0")
      .optional(),

    aplicaA: alcanceOfertaSchema.optional(),

    productoIds: idsArraySchema,
    categoriaIds: idsArraySchema,
    lineaIds: idsArraySchema,

    fechaInicio: fechaOfertaSchema.optional(),
    fechaFin: fechaOfertaSchema.optional(),

    hastaAgotarExistencias: z.boolean().optional(),

    stockLimiteOferta: z
      .number({
        invalid_type_error: "El límite de stock debe ser numérico",
      })
      .int("El límite de stock debe ser un número entero")
      .positive("El límite de stock debe ser mayor a 0")
      .nullable()
      .optional(),

    prioridad: z
      .number({
        invalid_type_error: "La prioridad debe ser numérica",
      })
      .int("La prioridad debe ser un número entero")
      .min(1, "La prioridad mínima es 1")
      .optional(),

    combinable: z.boolean().optional(),

    badgeTexto: z
      .string()
      .trim()
      .max(40, "El texto del badge no puede superar los 40 caracteres")
      .optional(),

    mostrarBadge: z.boolean().optional(),
  })
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: "Debes enviar al menos un campo para actualizar",
  })
  .refine(
    (data) => {
      if (data.fechaInicio && data.fechaFin) {
        return new Date(data.fechaFin) > new Date(data.fechaInicio);
      }

      return true;
    },
    {
      message: "La fecha de fin debe ser posterior a la fecha de inicio",
      path: ["fechaFin"],
    }
  )
  .refine(
    (data) => {
      if (
        data.tipoDescuento === "porcentaje" &&
        typeof data.valorDescuento === "number"
      ) {
        return data.valorDescuento > 0 && data.valorDescuento <= 100;
      }

      return true;
    },
    {
      message: "El porcentaje de descuento debe estar entre 1 y 100",
      path: ["valorDescuento"],
    }
  )
  .refine(
    (data) => {
      if (data.aplicaA === "productos") {
        return Array.isArray(data.productoIds) && data.productoIds.length > 0;
      }

      if (data.aplicaA === "categorias") {
        return Array.isArray(data.categoriaIds) && data.categoriaIds.length > 0;
      }

      if (data.aplicaA === "lineas") {
        return Array.isArray(data.lineaIds) && data.lineaIds.length > 0;
      }

      return true;
    },
    {
      message: "Debes seleccionar al menos un elemento según el alcance de la oferta",
      path: ["aplicaA"],
    }

  );

export const calcularPreciosOfertaSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            productoId: z
              .string()
              .trim()
              .min(1, "El ID del producto es obligatorio"),

            cantidad: z
              .number({
                required_error: "La cantidad es obligatoria",
                invalid_type_error: "La cantidad debe ser numérica",
              })
              .int("La cantidad debe ser un número entero")
              .positive("La cantidad debe ser mayor a 0"),

            tallaId: z
              .string()
              .trim()
              .min(1, "El ID de la talla no puede estar vacío")
              .optional(),
          })
          .strict()
      )
      .min(1, "Debes enviar al menos un producto"),
  })
  .strict();

export const listarOfertasQuerySchema = z
  .object({
    estado: z.preprocess((value) => {
      if (value === undefined || value === "") return undefined;
      if (value === true || value === "true") return true;
      if (value === false || value === "false") return false;
      return value;
    }, z.boolean().optional()),

    aplicaA: alcanceOfertaSchema.optional(),
    tipoDescuento: tipoDescuentoSchema.optional(),

    productoId: z.string().trim().min(1).optional(),
    categoriaId: z.string().trim().min(1).optional(),
    lineaId: z.string().trim().min(1).optional(),
    tallaId: z.string().trim().min(1).optional(),

    q: z.string().trim().min(1).max(120).optional(),

    limit: z.preprocess((value) => {
      if (value === undefined || value === "") return undefined;
      if (typeof value === "number") return value;
      if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
      return value;
    }, z.number().int().positive().max(100).optional()),
  })
  .strict();

export const syncOfferSnapshotsSchema = z
  .object({
    limit: z
      .number()
      .int("limit debe ser un entero")
      .min(1, "limit debe ser mayor a 0")
      .max(500, "limit no puede exceder 500")
      .optional()
      .default(500),
  })
  .strict();

export type CreateOfertaInput = z.infer<typeof createOfertaSchema>;
export type UpdateOfertaInput = z.infer<typeof updateOfertaSchema>;
export type CalcularPreciosOfertaInput = z.infer<
  typeof calcularPreciosOfertaSchema
>;
export type ListarOfertasQueryInput = z.infer<typeof listarOfertasQuerySchema>;