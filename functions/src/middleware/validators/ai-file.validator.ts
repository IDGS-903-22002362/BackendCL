import { z } from "zod";

export const uploadAiFileBodySchema = z
  .object({
    sessionId: z.string().trim().min(1).optional(),
  })
  .strict();
