import { z } from "zod";

export const verifySeasonPassSchema = z
  .object({
    phone: z
      .string({
        invalid_type_error: "El teléfono debe ser una cadena de texto",
      })
      .trim()
      .min(1, "El teléfono no puede estar vacío")
      .max(30, "El teléfono no puede exceder 30 caracteres")
      .optional(),
  })
  .strict();
