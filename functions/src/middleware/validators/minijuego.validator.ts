import { z } from "zod";
import {
  MINIJUEGO_TIPOS,
  MINIJUEGO_VISIBILIDADES,
  PRIZE_TYPES,
} from "../../models/minijuego.model";

const premioSchema = z
  .object({
    id: z.string().trim().min(1).max(100).optional(),
    nombre: z.string().trim().min(1).max(80),
    tipo: z.enum(PRIZE_TYPES),
    valor: z.number().int().min(0).max(100_000).optional(),
    stock: z.number().int().min(0).nullable().optional(),
    weight: z.number().int().min(1).max(10_000).optional(),
    descripcion: z.string().trim().max(200).optional(),
    imagenUrl: z.string().trim().max(2000).optional(),
    color: z.string().trim().max(7).optional(),
    especial: z.boolean().optional(),
    maxGanadores: z.number().int().min(0).optional(),
  })
  .strict();

export const guardarMinijuegoSchema = z
  .object({
    beneficio: z
      .object({
        titulo: z.string().trim().min(1).max(100),
        descripcion: z.string().trim().min(1).max(500),
        estatus: z.boolean(),
      })
      .strict(),
    minijuego: z
      .object({
        tipo: z.enum(MINIJUEGO_TIPOS),
        fechaInicio: z.string().trim().max(40).nullable().optional(),
        fechaFin: z.string().trim().max(40).nullable().optional(),
        intentosPorUsuario: z.number().int().min(1).max(100).default(1),
        audiencia: z
          .object({
            visibilidad: z.enum(MINIJUEGO_VISIBILIDADES),
            usuariosPermitidos: z
              .array(z.string().trim().min(1).max(128))
              .max(50)
              .default([]),
          })
          .strict(),
      })
      .strict(),
    premios: z.array(premioSchema).min(1).max(12),
  })
  .strict();

export const minijuegoPlayParamsSchema = z.object({
  id: z.string().min(1).max(100),
  playId: z.string().min(1).max(100),
});
