import { z } from "zod";

export const assignUserPointsSchema = z
  .object({
    points: z
      .number({
        required_error: "La cantidad de puntos es requerida",
        invalid_type_error: "La cantidad de puntos debe ser un numero",
      })
      .finite("La cantidad de puntos debe ser valida")
      .positive("La cantidad de puntos debe ser mayor a cero"),
  })
  .strict();