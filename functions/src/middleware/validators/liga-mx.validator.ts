import { z } from "zod";

export const ligaMxDivisionQuerySchema = z.object({
  division: z.enum(["varonil", "femenil"], {
    required_error: "La división es requerida",
    invalid_type_error: "La división debe ser varonil o femenil",
  }),
});

export const ligaMxPlayerIdParamSchema = z.object({
  idAfiliado: z
    .string({
      required_error: "El idAfiliado es requerido",
      invalid_type_error: "El idAfiliado debe ser texto",
    })
    .regex(/^\d+$/, "El idAfiliado debe ser numérico"),
});

export const ligaMxMatchIdParamSchema = z.object({
  idPartido: z
    .string({
      required_error: "El idPartido es requerido",
      invalid_type_error: "El idPartido debe ser texto",
    })
    .regex(/^\d+$/, "El idPartido debe ser numérico"),
});