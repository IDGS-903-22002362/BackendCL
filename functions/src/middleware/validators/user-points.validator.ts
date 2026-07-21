import { z } from "zod";

export const saleFolioSchema = z
  .string({
    required_error: "El folio de venta es requerido",
    invalid_type_error: "El folio de venta debe ser texto",
  })
  .trim()
  .min(1, "El folio de venta es requerido")
  .max(80, "El folio de venta no puede exceder 80 caracteres")
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9._# -]*$/,
    "El folio de venta contiene caracteres no permitidos",
  )
  .transform((value) => value.replace(/\s+/g, " ").toUpperCase());

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
  })
  .strict();

export const assignPointsBySaleSchema = z
  .object({
    folioVenta: saleFolioSchema,
    dinero: z
      .number({
        required_error: "El monto de venta es requerido",
        invalid_type_error: "El monto debe ser un número",
      })
      .positive("El monto debe ser mayor a cero")
      .finite("El monto debe ser un número válido"),
    descripcion: z
      .string()
      .trim()
      .min(1, "La descripción no puede estar vacía")
      .max(250, "La descripción no puede exceder 250 caracteres")
      .optional(),
  })
  .strict();

export const staffAssignmentHistoryQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(50).default(20),
    cursor: z.string().trim().min(1).max(128).optional(),
    search: z.string().trim().max(80).optional(),
    empleadoId: z.string().trim().min(1).max(128).optional(),
  })
  .strict();
