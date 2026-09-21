import { z } from "zod";
import { idParamSchema } from "./common.validator";

export const createPatrocinadorSchema = z
  .object({
    nombre: z
      .string()
      .trim()
      .min(1, "El nombre no puede estar vacio")
      .max(80, "El nombre no puede exceder 80 caracteres"),
    estatus: z.boolean({
      required_error: "El estatus es obligatorio",
      invalid_type_error: "El estatus debe ser booleano",
    }),
    exclusivo: z.boolean().optional(),
  })
  .strict();

export const updatePatrocinadorSchema = z
  .object({
    nombre: z.string().trim().min(1).max(80).optional(),
    estatus: z.boolean().optional(),
    exclusivo: z.boolean().optional(),
  })
  .strict();

export const patrocinadorImagenParamsSchema = idParamSchema.extend({
  variante: z.enum(["blanca", "negra", "exclusiva"], {
    required_error: "La variante del logo es obligatoria",
    invalid_type_error: "La variante del logo debe ser blanca, negra o exclusiva",
  }),
});
