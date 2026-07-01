const PRODUCTION_CORS_ORIGINS = [
  "https://ecomerce-next-front--e-comerce-leon.us-central1.hosted.app",
  "https://tiendalaguarida.com",
  "https://www.tiendalaguarida.com",
  "https://clubleon.mx",
  "https://www.clubleon.mx",
  "https://developers.clubleon.mx",
  "https://clubleon-developer-portal--e-comerce-leon.us-central1.hosted.app",
  "http://localhost:3001",
  "http://localhost:3002",
] as const;

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

  return [...PRODUCTION_CORS_ORIGINS];
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
