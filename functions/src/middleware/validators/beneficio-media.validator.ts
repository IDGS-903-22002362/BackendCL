import { z } from "zod";

export const removeBeneficioImagenSchema = z
  .object({
    url: z
      .string()
      .trim()
      .url("La URL de la imagen es invalida")
      .min(1, "La URL de la imagen es obligatoria"),
  })
  .strict();
