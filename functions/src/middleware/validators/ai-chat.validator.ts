import { z } from "zod";

const attachmentSchema = z
  .object({
    assetId: z.string().trim().min(1),
  })
  .strict();

export const sendAiMessageSchema = z
  .object({
    sessionId: z.string().trim().min(1),
    message: z.string().trim().min(1).max(4000),
    attachments: z.array(attachmentSchema).max(3).optional(),
    stream: z.boolean().optional(),
  })
  .strict();
