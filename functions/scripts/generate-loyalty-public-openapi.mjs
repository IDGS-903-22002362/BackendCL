import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import yaml from "yaml";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const openapiDir = path.join(__dirname, "../src/modules/loyalty/openapi");
const internalPath = path.join(openapiDir, "loyalty-internal-v1.openapi.yaml");
const legacyPath = path.join(openapiDir, "loyalty-v1.openapi.yaml");
const publicPath = path.join(openapiDir, "loyalty-public-v1.openapi.yaml");

const INTERNAL_PATHS = new Set([
  "/wallets/me",
  "/wallets/me/transactions",
  "/admin/members/{memberId}/wallet",
  "/admin/adjustments",
  "/admin/transactions",
]);

if (!fs.existsSync(internalPath) && fs.existsSync(legacyPath)) {
  let legacy = fs.readFileSync(legacyPath, "utf8");
  legacy = legacy.replace(
    "title: Club Leon Loyalty API",
    "title: Club Leon Loyalty API (Internal)",
  );
  for (const p of INTERNAL_PATHS) {
    if (p.startsWith("/admin")) {
      legacy = legacy.replace(
        new RegExp(`(  ${p.replace(/\//g, "\\/").replace(/\{[^}]+\}/g, "\\{[^}]+\\}")}:)`, "m"),
        "$1\n      x-internal: true",
      );
    }
  }
  fs.writeFileSync(internalPath, legacy, "utf8");
}

const publicSpec = {
  openapi: "3.0.3",
  info: {
    title: "Club Leon Loyalty API",
    version: "1.0.0",
    description:
      "API pública de lealtad para socios integradores. Autenticación OAuth 2.0 client_credentials.",
    contact: { name: "Club Leon Developers", url: "https://clubleon.mx/developers" },
  },
  servers: [
    {
      url: "https://us-central1-e-comerce-leon.cloudfunctions.net/api/loyalty/sandbox/v1",
      description: "Sandbox",
    },
    {
      url: "https://us-central1-e-comerce-leon.cloudfunctions.net/api/loyalty/v1",
      description: "Production",
    },
    {
      url: "http://127.0.0.1:5001/e-comerce-leon/us-central1/api/loyalty/sandbox/v1",
      description: "Local emulator sandbox",
    },
  ],
  tags: [
    { name: "OAuth", description: "Autenticación" },
    { name: "Wallets", description: "Consulta de monederos" },
    { name: "Transactions", description: "Transacciones e historial" },
    { name: "Earn", description: "Acumulación de puntos" },
    { name: "Redemptions", description: "Reserva y confirmación de canjes" },
    { name: "Reversals", description: "Reversiones autorizadas" },
    { name: "Sandbox", description: "Herramientas sandbox" },
  ],
  paths: {},
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
        description: "Token OAuth obtenido via client_credentials",
      },
    },
    parameters: {
      IdempotencyKey: {
        name: "Idempotency-Key",
        in: "header",
        required: true,
        schema: { type: "string", minLength: 8, maxLength: 255 },
      },
      RequestId: {
        name: "X-Request-Id",
        in: "header",
        required: false,
        schema: { type: "string" },
      },
    },
    schemas: {
      Problem: {
        type: "object",
        required: ["type", "title", "status", "detail", "code"],
        properties: {
          type: { type: "string", format: "uri" },
          title: { type: "string" },
          status: { type: "integer" },
          detail: { type: "string" },
          code: { type: "string" },
          requestId: { type: "string" },
          instance: { type: "string" },
        },
      },
      Wallet: {
        type: "object",
        properties: {
          memberId: { type: "string" },
          availablePoints: { type: "integer" },
          heldPoints: { type: "integer" },
          pendingPoints: { type: "integer" },
          lifetimeEarnedPoints: { type: "integer" },
          lifetimeRedeemedPoints: { type: "integer" },
          level: { type: "string" },
          nextExpirationAt: { type: "string", format: "date-time" },
        },
      },
      Transaction: {
        type: "object",
        properties: {
          transactionId: { type: "string" },
          memberId: { type: "string" },
          type: { type: "string" },
          status: { type: "string" },
          points: { type: "integer" },
          balanceBefore: { type: "integer" },
          balanceAfter: { type: "integer" },
          channel: { type: "string" },
          amountCents: { type: "integer" },
          currency: { type: "string" },
          externalTransactionId: { type: "string" },
          description: { type: "string" },
          createdAt: { type: "string", format: "date-time" },
        },
      },
      OAuthTokenResponse: {
        type: "object",
        properties: {
          access_token: { type: "string" },
          token_type: { type: "string", example: "Bearer" },
          expires_in: { type: "integer", example: 3600 },
          scope: { type: "string" },
        },
      },
    },
    responses: {
      ProblemResponse: {
        description: "Error RFC7807",
        content: {
          "application/problem+json": {
            schema: { $ref: "#/components/schemas/Problem" },
          },
        },
      },
    },
  },
};

const problemResponses = ["400", "401", "403", "404", "409", "429", "500", "503"];

function withProblems(responses, extra = {}) {
  const result = { ...extra };
  for (const code of problemResponses) {
    if (!result[code] && ["400", "401", "403", "404", "409", "429", "500"].includes(code)) {
      result[code] = { $ref: "#/components/responses/ProblemResponse" };
    }
  }
  return result;
}

publicSpec.paths["/oauth/token"] = {
  post: {
    operationId: "oauthToken",
    tags: ["OAuth"],
    summary: "Obtener access token",
    description: "OAuth 2.0 client_credentials. Scope: no aplica.",
    security: [],
    requestBody: {
      required: true,
      content: {
        "application/json": {
          schema: {
            type: "object",
            required: ["grant_type", "client_id", "client_secret"],
            properties: {
              grant_type: { type: "string", enum: ["client_credentials"] },
              client_id: { type: "string", example: "client_test_xxx" },
              client_secret: { type: "string", example: "secret_xxx" },
            },
          },
        },
      },
    },
    responses: withProblems({}, {
      "200": {
        description: "Token emitido",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/OAuthTokenResponse" },
          },
        },
      },
    }),
  },
};

publicSpec.paths["/members/{memberId}/wallet"] = {
  get: {
    operationId: "getMemberWallet",
    tags: ["Wallets"],
    summary: "Consultar monedero de miembro",
    description: "Scope requerido: loyalty.wallet.read",
    security: [{ bearerAuth: [] }],
    parameters: [
      { name: "memberId", in: "path", required: true, schema: { type: "string" } },
      { $ref: "#/components/parameters/RequestId" },
    ],
    responses: withProblems({}, {
      "200": {
        description: "OK",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                wallet: { $ref: "#/components/schemas/Wallet" },
                requestId: { type: "string" },
              },
            },
          },
        },
      },
    }),
  },
};

publicSpec.paths["/members/{memberId}/transactions"] = {
  get: {
    operationId: "getMemberTransactions",
    tags: ["Wallets", "Transactions"],
    summary: "Historial de transacciones",
    description: "Scope requerido: loyalty.transactions.read",
    security: [{ bearerAuth: [] }],
    parameters: [
      { name: "memberId", in: "path", required: true, schema: { type: "string" } },
      { name: "limit", in: "query", schema: { type: "integer", default: 50 } },
      { name: "cursor", in: "query", schema: { type: "string" } },
    ],
    responses: withProblems({}, { "200": { description: "OK" } }),
  },
};

publicSpec.paths["/earn-preview"] = {
  get: {
    operationId: "earnPreview",
    tags: ["Earn"],
    summary: "Preview de puntos por monto",
    security: [{ bearerAuth: [] }],
    parameters: [
      { name: "amountCents", in: "query", required: true, schema: { type: "integer", minimum: 1 } },
    ],
    responses: withProblems({}, { "200": { description: "OK" } }),
  },
};

publicSpec.paths["/earn-transactions"] = {
  post: {
    operationId: "createEarnTransaction",
    tags: ["Earn"],
    summary: "Acumular puntos por compra",
    description: "Scope: loyalty.points.earn. Idempotencia obligatoria.",
    security: [{ bearerAuth: [] }],
    parameters: [
      { $ref: "#/components/parameters/IdempotencyKey" },
      { $ref: "#/components/parameters/RequestId" },
    ],
    requestBody: {
      required: true,
      content: {
        "application/json": {
          schema: {
            type: "object",
            required: ["memberId", "externalTransactionId", "amountCents"],
            properties: {
              memberId: { type: "string" },
              memberToken: { type: "string", description: "Sandbox only" },
              externalTransactionId: { type: "string" },
              amountCents: { type: "integer", minimum: 1 },
              currency: { type: "string", enum: ["MXN"], default: "MXN" },
              channel: { type: "string", enum: ["PARTNER", "STORE"] },
              locationId: { type: "string" },
              description: { type: "string" },
            },
          },
        },
      },
    },
    responses: withProblems({}, { "201": { description: "Creado" } }),
  },
};

publicSpec.paths["/transactions/{transactionId}"] = {
  get: {
    operationId: "getTransaction",
    tags: ["Transactions"],
    summary: "Consultar transacción",
    security: [{ bearerAuth: [] }],
    parameters: [{ name: "transactionId", in: "path", required: true, schema: { type: "string" } }],
    responses: withProblems({}, { "200": { description: "OK" } }),
  },
};

publicSpec.paths["/redemptions"] = {
  post: {
    operationId: "createRedemption",
    tags: ["Redemptions"],
    summary: "Crear reserva de canje (hold)",
    description: "Scope: loyalty.redemptions.create",
    security: [{ bearerAuth: [] }],
    parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }],
    requestBody: {
      required: true,
      content: {
        "application/json": {
          schema: {
            type: "object",
            required: ["memberId", "points"],
            properties: {
              memberId: { type: "string" },
              points: { type: "integer", minimum: 1 },
              description: { type: "string" },
            },
          },
        },
      },
    },
    responses: withProblems({}, { "201": { description: "Creado" } }),
  },
};

publicSpec.paths["/redemptions/{redemptionId}/confirm"] = {
  post: {
    operationId: "confirmRedemption",
    tags: ["Redemptions"],
    summary: "Confirmar canje",
    description: "Scope: loyalty.redemptions.confirm",
    security: [{ bearerAuth: [] }],
    parameters: [
      { $ref: "#/components/parameters/IdempotencyKey" },
      { name: "redemptionId", in: "path", required: true, schema: { type: "string" } },
    ],
    responses: withProblems({}, { "201": { description: "Confirmado" } }),
  },
};

publicSpec.paths["/redemptions/{redemptionId}/cancel"] = {
  post: {
    operationId: "cancelRedemption",
    tags: ["Redemptions"],
    summary: "Cancelar canje",
    description: "Scope: loyalty.redemptions.cancel",
    security: [{ bearerAuth: [] }],
    parameters: [
      { $ref: "#/components/parameters/IdempotencyKey" },
      { name: "redemptionId", in: "path", required: true, schema: { type: "string" } },
    ],
    responses: withProblems({}, { "201": { description: "Cancelado" } }),
  },
};

publicSpec.paths["/transactions/{transactionId}/reversals"] = {
  post: {
    operationId: "createReversal",
    tags: ["Reversals"],
    summary: "Revertir transacción",
    description: "Scope: loyalty.reversals.create",
    security: [{ bearerAuth: [] }],
    parameters: [
      { $ref: "#/components/parameters/IdempotencyKey" },
      { name: "transactionId", in: "path", required: true, schema: { type: "string" } },
    ],
    requestBody: {
      required: true,
      content: {
        "application/json": {
          schema: {
            type: "object",
            required: ["reason"],
            properties: {
              reason: { type: "string" },
              points: { type: "integer", minimum: 1, description: "Reversión parcial opcional" },
            },
          },
        },
      },
    },
    responses: withProblems({}, { "201": { description: "Creado" } }),
  },
};

publicSpec.paths["/member-tokens"] = {
  post: {
    operationId: "createMemberToken",
    tags: ["Sandbox"],
    summary: "Generar member token temporal (solo sandbox)",
    description: "Scope: loyalty.wallet.read",
    security: [{ bearerAuth: [] }],
    requestBody: {
      required: true,
      content: {
        "application/json": {
          schema: {
            type: "object",
            required: ["memberId"],
            properties: { memberId: { type: "string" } },
          },
        },
      },
    },
    responses: withProblems({}, { "201": { description: "Creado" } }),
  },
};

fs.writeFileSync(publicPath, yaml.stringify(publicSpec), "utf8");
console.log("Generated:", publicPath);
