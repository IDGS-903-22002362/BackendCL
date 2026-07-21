import { z } from "zod";

const tryOnIdentifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[A-Za-z0-9_-]+$/);

export const tryOnEligibilitySchema = z
  .object({
    productId: tryOnIdentifierSchema,
    userImageAssetId: tryOnIdentifierSchema.optional(),
    sessionId: tryOnIdentifierSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.userImageAssetId && !value.sessionId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sessionId"],
        message: "sessionId es requerido cuando se valida una imagen de usuario",
      });
    }
  });

export const createTryOnJobSchema = z
  .object({
    sessionId: z.string().trim().min(1),
    productId: tryOnIdentifierSchema,
    variantId: z.string().trim().min(1).optional(),
    sku: z.string().trim().min(1).optional(),
    userImageAssetId: z.string().trim().min(1),
    consentAccepted: z.literal(true),
    idempotencyKey: z.string().trim().min(8).max(128).optional(),
  })
  .strict();

export const tryOnJobIdParamSchema = z
  .object({
    id: z.string().trim().min(1).max(120),
  })
  .strict();

export const tryOnAssetIdParamSchema = z
  .object({
    id: z.string().trim().min(1).max(120),
  })
  .strict();
