import { z } from "zod";
import {
  sanitizePersonalizationName,
  sanitizePersonalizationNumber,
} from "../../utils/product-personalization.util";

export const itemPersonalizacionSchema = z
  .object({
    mode: z.enum(["player", "custom"]),
    nombre: z
      .string()
      .trim()
      .min(1, "El nombre es requerido para personalizar")
      .max(12, "El nombre no puede exceder 12 caracteres")
      .transform(sanitizePersonalizationName)
      .refine((value) => value.length > 0, "Nombre de personalización inválido"),
    numero: z
      .string()
      .trim()
      .min(1, "El número es requerido para personalizar")
      .max(2, "El número no puede exceder 2 dígitos")
      .transform(sanitizePersonalizationNumber)
      .refine((value) => value.length > 0, "Número de personalización inválido"),
  })
  .strict();
