import { z } from "zod";

const attachmentSchema = z
  .object({
    assetId: z.string().trim().min(1),
    mimeType: z.string().trim().min(1).max(120).optional(),
    kind: z.string().trim().min(1).max(40).optional(),
  })
  .strict();

const clientContextSchema = z
  .object({
    channel: z.string().trim().min(1).max(50).optional(),
    locale: z.string().trim().min(2).max(20).optional(),
    customerName: z.string().trim().min(1).max(120).optional(),
    imageHint: z.string().trim().min(1).max(200).optional(),
    lastProductId: z.string().trim().min(1).max(120).optional(),
  })
  .strict();

export const sendAiMessageSchema = z
  .object({
    sessionId: z.string().trim().min(1),
    message: z.string().trim().min(1).max(4000),
    attachments: z.array(attachmentSchema).max(3).optional(),
    clientContext: clientContextSchema.optional(),
    publicAccessToken: z.string().trim().min(10).max(256).optional(),
    stream: z.boolean().optional(),
  })
  .strict();

export const publicAiMessageSchema = sendAiMessageSchema
  .extend({
    publicAccessToken: z.string().trim().min(10).max(256),
  })
  .strict();
