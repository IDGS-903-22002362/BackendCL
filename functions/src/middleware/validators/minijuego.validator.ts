import { z } from "zod";
import {
  MINIJUEGO_TIPOS,
  MINIJUEGO_VISIBILIDADES,
  PRIZE_TYPES,
} from "../../models/minijuego.model";

function readIsoDate(
  value: string | null | undefined,
): { ok: true; date: Date | null } | { ok: false } {
  if (value == null || value.trim() === "") return { ok: true, date: null };
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { ok: false };
  return { ok: true, date };
}

const premioSchema = z
  .object({
    id: z.string().trim().min(1).max(100).optional(),
    nombre: z.string().trim().min(1).max(80),
    tipo: z.enum(PRIZE_TYPES),
    valor: z.number().int().min(0).max(100_000).optional(),
    stock: z.number().int().min(0).nullable().optional(),
    weight: z.number().int().min(1).max(10_000).optional(),
    descripcion: z.string().trim().max(200).optional(),
    terminos: z.string().trim().max(4000).optional(),
    validoDesde: z.string().trim().max(40).nullable().optional(),
    caducaEl: z.string().trim().max(40).nullable().optional(),
    imagenUrl: z.string().trim().max(2000).optional(),
    color: z.string().trim().max(7).optional(),
    especial: z.boolean().optional(),
    maxGanadores: z.number().int().min(0).optional(),
  })
  .strict()
  .superRefine((premio, ctx) => {
    const desde = readIsoDate(premio.validoDesde);
    const hasta = readIsoDate(premio.caducaEl);
    if (!desde.ok) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["validoDesde"],
        message: "Fecha inválida.",
      });
    }
    if (!hasta.ok) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["caducaEl"],
        message: "Fecha inválida.",
      });
    }
    if (
      desde.ok &&
      hasta.ok &&
      desde.date &&
      hasta.date &&
      hasta.date.getTime() < desde.date.getTime()
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["caducaEl"],
        message: "La caducidad no puede ser anterior al inicio de la vigencia.",
      });
    }
  });

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
