import { z } from "zod";

export const stripeObjectIdParamSchema = z
  .object({
    id: z
      .string({
        required_error: "El ID es requerido",
        invalid_type_error: "El ID debe ser una cadena",
      })
      .trim()
      .min(1, "El ID no puede estar vacío"),
  })
  .strict();

export const createStripePaymentIntentSchema = z
  .object({
    orderId: z
      .string({
        required_error: "orderId es requerido",
        invalid_type_error: "orderId debe ser una cadena",
      })
      .trim()
      .min(1, "orderId no puede estar vacío"),
    currency: z
      .string({ invalid_type_error: "currency debe ser una cadena" })
      .trim()
      .min(3, "currency debe tener al menos 3 caracteres")
      .max(3, "currency debe tener 3 caracteres")
      .optional(),
    customerId: z
      .string({ invalid_type_error: "customerId debe ser una cadena" })
      .trim()
      .min(1, "customerId no puede estar vacío")
      .optional(),
    savePaymentMethod: z
      .boolean({ invalid_type_error: "savePaymentMethod debe ser boolean" })
      .optional(),
    shipping: z
      .object({
        name: z.string().trim().min(1).max(120),
        phone: z.string().trim().max(30).optional(),
        address: z
          .object({
            line1: z.string().trim().min(1).max(120),
            line2: z.string().trim().max(120).optional(),
            city: z.string().trim().max(80).optional(),
            state: z.string().trim().max(80).optional(),
            postal_code: z.string().trim().max(20).optional(),
            country: z.string().trim().length(2).optional(),
          })
          .strict(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const createStripeCheckoutSessionSchema = z
  .object({
    orderId: z
      .string({
        required_error: "orderId es requerido",
        invalid_type_error: "orderId debe ser una cadena",
      })
      .trim()
      .min(1, "orderId no puede estar vacío"),
    successUrl: z
      .string({ invalid_type_error: "successUrl debe ser una URL válida" })
      .trim()
      .url("successUrl debe ser una URL válida")
      .optional(),
    cancelUrl: z
      .string({ invalid_type_error: "cancelUrl debe ser una URL válida" })
      .trim()
      .url("cancelUrl debe ser una URL válida")
      .optional(),
  })
  .strict();

export const createStripeSetupIntentSchema = z
  .object({
    customerId: z
      .string({ invalid_type_error: "customerId debe ser una cadena" })
      .trim()
      .min(1, "customerId no puede estar vacío")
      .optional(),
  })
  .strict();

export const createStripeBillingPortalSchema = z
  .object({
    returnUrl: z
      .string({ invalid_type_error: "returnUrl debe ser una URL válida" })
      .trim()
      .url("returnUrl debe ser una URL válida")
      .optional(),
  })
  .strict();

export const createStripeRefundByOrderSchema = z
  .object({
    orderId: z
      .string({
        required_error: "orderId es requerido",
        invalid_type_error: "orderId debe ser una cadena",
      })
      .trim()
      .min(1, "orderId no puede estar vacío"),
    reason: z
      .string({ invalid_type_error: "reason debe ser una cadena" })
      .trim()
      .min(1, "reason no puede estar vacío")
      .max(500, "reason no puede exceder 500 caracteres")
      .optional(),
  })
  .strict();
