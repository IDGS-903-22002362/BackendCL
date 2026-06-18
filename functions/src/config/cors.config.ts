import { defineString } from "firebase-functions/params";

const PRODUCTION_CORS_ORIGINS = [
  "https://ecomerce-next-front--e-comerce-leon.us-central1.hosted.app",
  "https://tiendalaguarida.com",
  "https://www.tiendalaguarida.com",
  "http://localhost:3001",
] as const;

export const corsAllowedOriginsParam = defineString("CORS_ALLOWED_ORIGINS", {
  default: PRODUCTION_CORS_ORIGINS.join(","),
  description:
    "Origenes CORS permitidos (separados por coma) para el storefront.",
});

function parseOrigins(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function readConfiguredOrigins(): string[] {
  const fromEnv = parseOrigins(process.env.CORS_ALLOWED_ORIGINS);
  if (fromEnv.length > 0) {
    return fromEnv;
  }

  return parseOrigins(corsAllowedOriginsParam.value());
}

export function getAllowedCorsOriginsWithStore(): string[] {
  const storeOrigin = process.env.STORE_PUBLIC_BASE_URL?.trim();

  return [
    ...new Set([
      ...readConfiguredOrigins(),
      ...(storeOrigin ? [storeOrigin] : []),
    ]),
  ];
}
