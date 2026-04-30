import { z } from "zod";

export const createBeneficioSchema = z
  .object({
    titulo: z
      .string()
      .trim()
      .min(1, "El titulo no puede estar vacio")
      .max(100, "El titulo no puede exceder 100 caracteres"),
    descripcion: z
      .string()
      .trim()
      .min(1, "La descripcion no puede estar vacia")
      .max(500, "La descripcion no puede exceder 500 caracteres"),
    estatus: z.boolean({
      required_error: "El estatus es obligatorio",
      invalid_type_error: "El estatus debe ser booleano",
    }),
  })
  .strict();

export const updateBeneficioSchema = z
  .object({
    titulo: z.string().trim().min(1).max(100).optional(),
    descripcion: z.string().trim().min(1).max(500).optional(),
    estatus: z.boolean().optional(),
  })
  .strict();