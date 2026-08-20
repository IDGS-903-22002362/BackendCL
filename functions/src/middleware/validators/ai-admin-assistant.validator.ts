import { z } from "zod";

export const createAdminAssistantSessionSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
});

export const askAdminAssistantSchema = z.object({
  sessionId: z.string().trim().min(1, "sessionId es requerido"),
  question: z
    .string()
    .trim()
    .min(3, "La consulta debe tener al menos 3 caracteres")
    .max(1000, "La consulta no puede exceder 1000 caracteres"),
  stream: z.boolean().optional(),
});

export const adminAssistantSessionIdParamSchema = z.object({
  id: z.string().trim().min(1),
});

export type CreateAdminAssistantSessionInput = z.infer<
  typeof createAdminAssistantSessionSchema
>;
export type AskAdminAssistantRequest = z.infer<typeof askAdminAssistantSchema>;
