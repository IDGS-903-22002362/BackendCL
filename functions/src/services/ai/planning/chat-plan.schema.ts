import { z } from "zod";

const conversationFiltersSchema = z
  .object({
    normalizedQuery: z.string().trim().optional(),
    categoryIds: z.array(z.string().trim().min(1)).optional(),
    lineIds: z.array(z.string().trim().min(1)).optional(),
    colors: z.array(z.string().trim().min(1)).optional(),
    sizeIds: z.array(z.string().trim().min(1)).optional(),
    audience: z.array(z.string().trim().min(1)).optional(),
    pricePreference: z.enum(["lowest", "premium", "standard"]).optional(),
    availability: z.enum(["in_stock", "all"]).optional(),
  })
  .strict();

const pendingClarificationSchema = z
  .object({
    type: z.enum([
      "product",
      "size",
      "color",
      "category",
      "collection",
      "order_lookup",
      "image_reference",
      "generic",
    ]),
    question: z.string().trim().min(1).max(300),
  })
  .strict();

export const chatPlanSchema = z
  .object({
    intent: z.string().trim().min(1).max(80),
    confidence: z.number().min(0).max(1),
    requiresTools: z.boolean(),
    toolCalls: z
      .array(
        z
          .object({
            toolName: z.string().trim().min(1).max(120),
            arguments: z.record(z.unknown()),
            reason: z.string().trim().max(200).optional(),
          })
          .strict(),
      )
      .max(8),
    needsClarification: z.boolean(),
    clarificationQuestion: z.string().trim().max(300).nullable(),
    sessionUpdates: z
      .object({
        currentIntent: z.string().trim().max(80).optional(),
        activeFilters: conversationFiltersSchema.optional(),
        lastCategoryId: z.string().trim().max(120).optional(),
        lastCollectionId: z.string().trim().max(120).optional(),
        lastMentionedSizeId: z.string().trim().max(50).optional(),
        lastMentionedColor: z.string().trim().max(50).optional(),
        lastResolvedProductId: z.string().trim().max(120).optional(),
        pendingClarification: pendingClarificationSchema.nullable().optional(),
        preferredLanguage: z.string().trim().max(20).optional(),
        tone: z.enum(["commercial", "support"]).optional(),
      })
      .strict(),
    finalAnswer: z.string().trim().max(2000),
  })
  .strict();

export type ChatPlanSchema = z.infer<typeof chatPlanSchema>;
