import { z } from "zod";
import { LoyaltyAdjustmentReason, LoyaltyChannel } from "../models/loyalty.enums";

const metadataSchema = z
  .record(z.union([z.string().max(200), z.number().finite(), z.boolean()]))
  .optional()
  .refine((val) => !val || Object.keys(val).length <= 10, {
    message: "metadata cannot exceed 10 keys",
  });

export const earnTransactionSchema = z
  .object({
    memberId: z.string().trim().min(1).max(128),
    externalTransactionId: z.string().trim().min(1).max(120),
    amountCents: z.number().int().positive(),
    currency: z.literal("MXN").default("MXN"),
    channel: z.nativeEnum(LoyaltyChannel),
    locationId: z.string().trim().min(1).max(120).optional(),
    purchasedAt: z.string().datetime().optional(),
    description: z.string().trim().min(1).max(250).optional(),
    metadata: metadataSchema,
  })
  .strict();

export const adjustmentSchema = z
  .object({
    memberId: z.string().trim().min(1).max(128),
    points: z.number().int().refine((v) => v !== 0, "points must not be zero"),
    reasonCode: z.nativeEnum(LoyaltyAdjustmentReason),
    description: z.string().trim().min(1).max(250),
    externalReference: z.string().trim().min(1).max(120),
  })
  .strict();

export const redemptionSchema = z
  .object({
    memberId: z.string().trim().min(1).max(128),
    points: z.number().int().positive(),
    description: z.string().trim().min(1).max(250).optional(),
  })
  .strict();

export const reversalSchema = z
  .object({
    points: z.number().int().positive().optional(),
    reason: z.string().trim().min(1).max(250),
  })
  .strict();

export const walletTransactionsQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.string().trim().min(1).optional(),
    type: z.string().trim().optional(),
    status: z.string().trim().optional(),
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
  })
  .strict();

export const adminTransactionsQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.string().trim().min(1).optional(),
    memberId: z.string().trim().min(1).max(128).optional(),
    actorId: z.string().trim().min(1).max(128).optional(),
    channel: z.nativeEnum(LoyaltyChannel).optional(),
  })
  .strict();

export const memberIdParamSchema = z.object({
  memberId: z.string().trim().min(1).max(128),
});

export const transactionIdParamSchema = z.object({
  transactionId: z.string().trim().min(1).max(128),
});

export const redemptionIdParamSchema = z.object({
  redemptionId: z.string().trim().min(1).max(128),
});

export const earnPreviewQuerySchema = z
  .object({
    amountCents: z.coerce.number().int().nonnegative(),
  })
  .strict();