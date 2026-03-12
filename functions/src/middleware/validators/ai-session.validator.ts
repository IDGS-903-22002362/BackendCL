import { z } from "zod";

export const createAiSessionSchema = z
  .object({
    channel: z.string().trim().min(1).max(50).default("app"),
    title: z.string().trim().min(1).max(120).optional(),
  })
  .strict();

export const sessionIdParamSchema = z
  .object({
    id: z.string().trim().min(1).max(120),
  })
  .strict();
