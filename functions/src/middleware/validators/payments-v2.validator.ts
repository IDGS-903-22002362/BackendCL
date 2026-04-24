import { z } from "zod";

const metadataValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(metadataValueSchema),
    z.record(metadataValueSchema),
  ]),
);

export const paymentCustomerSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    email: z.string().trim().email().optional(),
    phone: z.string().trim().min(8).max(20).optional(),
  })
  .strict();

export const paymentItemInputSchema = z
  .object({
    productoId: z.string().trim().min(1).max(120),
    cantidad: z.number().int().min(1).max(999),
    tallaId: z.string().trim().min(1).max(60).optional(),
  })
  .strict();

export const aplazoOnlineCreateSchema = z
  .object({
    orderId: z.string().trim().min(1).max(120),
    customer: paymentCustomerSchema.optional(),
    items: z.array(paymentItemInputSchema).max(100).optional(),
    subtotal: z.number().nonnegative().optional(),
    tax: z.number().nonnegative().optional(),
    shipping: z.number().nonnegative().optional(),
    total: z.number().positive().optional(),
    currency: z.string().trim().min(3).max(3).optional(),
    successUrl: z.string().trim().url().optional(),
    cancelUrl: z.string().trim().url().optional(),
    failureUrl: z.string().trim().url().optional(),
    cartUrl: z.string().trim().url().optional(),
    metadata: z.record(metadataValueSchema).optional(),
  })
  .strict();

export const aplazoInStoreCreateSchema = z
  .object({
    ventaPosId: z.string().trim().min(1).max(120).optional(),
    posSessionId: z.string().trim().min(1).max(120),
    deviceId: z.string().trim().min(1).max(120),
    cajaId: z.string().trim().min(1).max(120),
    sucursalId: z.string().trim().min(1).max(120),
    vendedorUid: z.string().trim().min(1).max(120),
    customer: paymentCustomerSchema.optional(),
    items: z.array(paymentItemInputSchema).max(100).optional(),
    subtotal: z.number().nonnegative().optional(),
    tax: z.number().nonnegative().optional(),
    shipping: z.number().nonnegative().optional(),
    total: z.number().nonnegative().optional(),
    amount: z.number().nonnegative().optional(),
    currency: z.string().trim().min(3).max(3).optional(),
    metadata: z.record(metadataValueSchema).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!value.ventaPosId && (!value.items || value.items.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["items"],
        message: "Se requiere ventaPosId o items para crear el intento POS",
      });
    }

    if (!value.ventaPosId && !value.customer?.phone) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["customer", "phone"],
        message: "Se requiere teléfono del cliente para Aplazo in-store",
      });
    }
  });

export const paymentAttemptStatusParamSchema = z.object({
  paymentAttemptId: z.string().trim().min(1).max(120),
});

export const aplazoAdminActionSchema = z
  .object({
    reason: z.string().trim().max(500).optional(),
    refundAmountMinor: z.number().int().positive().optional(),
  })
  .strict();

export const aplazoRefundStatusQuerySchema = z
  .object({
    refundId: z.string().trim().min(1).max(120).optional(),
  })
  .strict();

export const aplazoRegisterBranchesSchema = z
  .object({
    branches: z.array(z.string().trim().min(1).max(120)).min(1).max(100),
  })
  .strict();

export const aplazoInStoreCartParamSchema = z.object({
  cartId: z.string().trim().min(1).max(120),
});

export const aplazoGenerateQrQuerySchema = z
  .object({
    shopId: z.string().trim().regex(/^\d+$/),
  })
  .strict();

export const aplazoResendCheckoutSchema = z
  .object({
    target: z
      .object({
        phoneNumber: z.string().trim().min(10).max(20),
      })
      .strict(),
    channels: z.array(z.enum(["WHATSAPP", "SMS"])).min(1).max(2),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (new Set(value.channels).size !== value.channels.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["channels"],
        message: "channels no debe contener duplicados",
      });
    }
  });

export const aplazoReturnQuerySchema = z
  .object({
    paymentAttemptId: z.string().trim().min(1).max(120).optional(),
    providerPaymentId: z.string().trim().min(1).max(120).optional(),
    providerReference: z.string().trim().min(1).max(120).optional(),
  })
  .refine(
    (value) =>
      Boolean(
        value.paymentAttemptId ||
          value.providerPaymentId ||
          value.providerReference,
      ),
    {
      message:
        "Se requiere paymentAttemptId, providerPaymentId o providerReference",
      path: ["paymentAttemptId"],
    },
  );
