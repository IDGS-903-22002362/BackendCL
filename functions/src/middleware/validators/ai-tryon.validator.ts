import { z } from "zod";

export const createTryOnJobSchema = z
  .object({
    sessionId: z.string().trim().min(1),
    productId: z.string().trim().min(1),
    variantId: z.string().trim().min(1).optional(),
    sku: z.string().trim().min(1).optional(),
    userImageAssetId: z.string().trim().min(1),
    consentAccepted: z.literal(true),
  })
  .strict();

export const tryOnJobIdParamSchema = z
  .object({
    id: z.string().trim().min(1).max(120),
  })
  .strict();
