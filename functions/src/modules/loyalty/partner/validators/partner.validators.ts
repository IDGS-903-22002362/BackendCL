import { z } from "zod";

export const oauthTokenSchema = z
  .object({
    grant_type: z.literal("client_credentials").optional(),
    grantType: z.literal("client_credentials").optional(),
    client_id: z.string().trim().min(1).optional(),
    clientId: z.string().trim().min(1).optional(),
    client_secret: z.string().trim().min(1).optional(),
    clientSecret: z.string().trim().min(1).optional(),
  })
  .refine(
    (data) =>
      (data.grant_type === "client_credentials" || data.grantType === "client_credentials") &&
      (data.client_id || data.clientId) &&
      (data.client_secret || data.clientSecret),
    { message: "client_credentials, client_id y client_secret son requeridos" },
  );

export const memberTokenSchema = z
  .object({
    memberId: z.string().trim().min(1).max(128),
  })
  .strict();
