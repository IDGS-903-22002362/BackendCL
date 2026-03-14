import { z } from "zod";

export const createPublicAiSessionSchema = z
  .object({
    channel: z.string().trim().min(1).max(50).default("web_guest"),
    title: z.string().trim().min(1).max(120).optional(),
    guestLabel: z.string().trim().min(1).max(80).optional(),
  })
  .strict();

export const sendPublicAiMessageSchema = z
  .object({
    sessionId: z.string().trim().min(1).max(120),
    publicAccessToken: z.string().trim().min(10).max(256),
    message: z.string().trim().min(1).max(4000),
    attachments: z
      .array(
        z
          .object({
            assetId: z.string().trim().min(1),
            mimeType: z.string().trim().min(1).max(120).optional(),
            kind: z.string().trim().min(1).max(40).optional(),
          })
          .strict(),
      )
      .max(3)
      .optional(),
    clientContext: z
      .object({
        channel: z.string().trim().min(1).max(50).optional(),
        locale: z.string().trim().min(2).max(20).optional(),
        customerName: z.string().trim().min(1).max(120).optional(),
        imageHint: z.string().trim().min(1).max(200).optional(),
        lastProductId: z.string().trim().min(1).max(120).optional(),
      })
      .strict()
      .optional(),
    stream: z.boolean().optional(),
  })
  .strict();
