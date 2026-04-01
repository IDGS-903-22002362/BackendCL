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
    descripcion: z
      .string({
        invalid_type_error: "La descripcion debe ser una cadena de texto",
      })
      .trim()
      .min(1, "La descripcion no puede estar vacia")
      .max(250, "La descripcion no puede exceder 250 caracteres")
      .optional(),
    origenId: z
      .string({
        invalid_type_error: "El origenId debe ser una cadena de texto",
      })
      .trim()
      .min(1, "El origenId no puede estar vacio")
      .max(120, "El origenId no puede exceder 120 caracteres")
      .optional(),
  })
  .strict();