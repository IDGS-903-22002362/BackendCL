import { z } from "zod";
import { idParamSchema } from "./common.validator";

const optionalSponsorUrlSchema = z
  .string()
  .trim()
  .max(2048, "La URL no puede exceder 2048 caracteres")
  .refine((value) => {
    if (!value) {
      return true;
    }

    try {
      const parsed = new URL(value);
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
      return false;
    }
  }, "La URL debe usar http o https")
  .optional();

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
    url: optionalSponsorUrlSchema,
  })
  .strict();

export const updatePatrocinadorSchema = z
  .object({
    nombre: z.string().trim().min(1).max(80).optional(),
    estatus: z.boolean().optional(),
    exclusivo: z.boolean().optional(),
    url: optionalSponsorUrlSchema,
  })
  .strict();

export const patrocinadorImagenParamsSchema = idParamSchema.extend({
  variante: z.enum(["blanca", "negra", "exclusiva"], {
    required_error: "La variante del logo es obligatoria",
    invalid_type_error: "La variante del logo debe ser blanca, negra o exclusiva",
  }),
});
