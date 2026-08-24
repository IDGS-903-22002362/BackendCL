import { z } from "zod";
import {
  BENEFICIO_DESTINOS,
  MAX_BENEFICIO_PUNTOS_RECOMPENSA,
} from "../../models/beneficios.model";

const puntosRecompensaSchema = z
  .number({
    invalid_type_error: "Los puntos deben ser un numero entero",
  })
  .int("Los puntos deben ser un numero entero")
  .min(0, "Los puntos no pueden ser negativos")
  .max(
    MAX_BENEFICIO_PUNTOS_RECOMPENSA,
    `Los puntos no pueden exceder ${MAX_BENEFICIO_PUNTOS_RECOMPENSA}`,
  );

const beneficioRedireccionSchema = z
  .object({
    modulo: z.enum(BENEFICIO_DESTINOS, {
      required_error: "El modulo de redireccion es obligatorio",
      invalid_type_error: "Modulo de redireccion invalido",
    }),
  })
  .strict();

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
    redireccion: beneficioRedireccionSchema.optional(),
    puntosRecompensa: puntosRecompensaSchema.optional(),
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
    redireccion: beneficioRedireccionSchema.optional(),
    puntosRecompensa: puntosRecompensaSchema.optional(),
    estatus: z.boolean().optional(),
  })
  .strict();
