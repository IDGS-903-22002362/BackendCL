#!/usr/bin/env node
import dotenv from "dotenv";

dotenv.config();

const baseUrl = process.env.API_BASE_URL || "http://localhost:3000";
const authToken = process.env.AUTH_TOKEN || "";
const adminToken = process.env.ADMIN_TOKEN || "";

const orderIdDefault = process.env.ORDER_ID || "";
const orderIdPi = process.env.ORDER_ID_PI || orderIdDefault;
const orderIdCheckout = process.env.ORDER_ID_CHECKOUT || "";
const orderIdLegacy = process.env.ORDER_ID_LEGACY || "";
const orderIdRefund = process.env.ORDER_ID_REFUND || "";

const results = [];
const evidence = {};
const runId = Date.now();

const log = (line) => console.log(line);

const record = (name, ok, detail) => {
  results.push({ name, ok, detail });
  log(`${ok ? "PASS" : "FAIL"} | ${name} | ${detail}`);
};

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const request = async ({ method, path, token, body, headers = {} }) => {
  const requestHeaders = { ...headers };
  if (body !== undefined) requestHeaders["Content-Type"] = "application/json";
  if (token) requestHeaders.Authorization = `Bearer ${token}`;

  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: requestHeaders,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }

  return { status: response.status, json };
};

const casePublicConfig = async () => {
  const res = await request({ method: "GET", path: "/api/stripe/config" });
  assert(res.status === 200, `Expected 200, got ${res.status}`);
  assert(res.json.success === true, "Expected success=true");
  record("GET /api/stripe/config", true, "config reachable");
};

const casePaymentIntentIdempotency = async () => {
  if (!orderIdPi) {
    record(
      "POST /api/stripe/payment-intents",
      true,
      "skipped (ORDER_ID_PI missing)",
    );
    return;
  }
  assert(authToken, "AUTH_TOKEN is required for payment-intents case");

  const idem = `qa-smoke-pi-${orderIdPi}-${runId}`;
  const first = await request({
    method: "POST",
    path: "/api/stripe/payment-intents",
    token: authToken,
    headers: { "Idempotency-Key": idem },
    body: { orderId: orderIdPi, savePaymentMethod: false },
  });

  assert(
    [200, 201].includes(first.status),
    `Expected 200/201, got ${first.status}`,
  );
  assert(first.json.success === true, "Expected success=true in first request");
  const firstId = first.json?.data?.paymentIntentId;
  assert(firstId, "paymentIntentId missing in first response");

  const second = await request({
    method: "POST",
    path: "/api/stripe/payment-intents",
    token: authToken,
    headers: { "Idempotency-Key": idem },
    body: { orderId: orderIdPi, savePaymentMethod: false },
  });

  assert(
    [200, 201].includes(second.status),
    `Expected 200/201, got ${second.status}`,
  );
  assert(
    second.json.success === true,
    "Expected success=true in second request",
  );
  const secondId = second.json?.data?.paymentIntentId;
  assert(secondId, "paymentIntentId missing in second response");
  assert(firstId === secondId, "Idempotency failed: paymentIntentId changed");

  evidence.paymentIntentId = firstId;
  record(
    "POST /api/stripe/payment-intents idempotency",
    true,
    `paymentIntentId=${firstId}`,
  );
};

const caseGetPaymentIntent = async () => {
  if (!evidence.paymentIntentId) {
    record(
      "GET /api/stripe/payment-intents/:id",
      true,
      "skipped (no paymentIntentId)",
    );
    return;
  }
  const res = await request({
    method: "GET",
    path: `/api/stripe/payment-intents/${evidence.paymentIntentId}`,
    token: authToken,
  });
  assert(res.status === 200, `Expected 200, got ${res.status}`);
  assert(res.json.success === true, "Expected success=true");
  record(
    "GET /api/stripe/payment-intents/:id",
    true,
    `paymentIntentId=${evidence.paymentIntentId}`,
  );
};

const caseCheckoutSession = async () => {
  if (!orderIdCheckout) {
    record(
      "POST /api/stripe/checkout-sessions",
      true,
      "skipped (ORDER_ID_CHECKOUT missing)",
    );
    return;
  }

  const idem = `qa-smoke-cs-${orderIdCheckout}-${runId}`;
  const first = await request({
    method: "POST",
    path: "/api/stripe/checkout-sessions",
    token: authToken,
    headers: { "Idempotency-Key": idem },
    body: { orderId: orderIdCheckout },
  });

  assert(
    [200, 201].includes(first.status),
    `Expected 200/201, got ${first.status}`,
  );
  const sessionId = first.json?.data?.sessionId;
  assert(sessionId, "sessionId missing");
  evidence.checkoutSessionId = sessionId;

  const second = await request({
    method: "POST",
    path: "/api/stripe/checkout-sessions",
    token: authToken,
    headers: { "Idempotency-Key": idem },
    body: { orderId: orderIdCheckout },
  });

  assert(
    [200, 201].includes(second.status),
    `Expected 200/201, got ${second.status}`,
  );
  const secondSession = second.json?.data?.sessionId;
  assert(
    secondSession === sessionId,
    "Idempotency failed for checkout session",
  );

  record(
    "POST /api/stripe/checkout-sessions idempotency",
    true,
    `sessionId=${sessionId}`,
  );
};

const caseSetupIntent = async () => {
  const res = await request({
    method: "POST",
    path: "/api/stripe/setup-intents",
    token: authToken,
    body: {},
  });
  assert(res.status === 201, `Expected 201, got ${res.status}`);
  const setupIntentId = res.json?.data?.setupIntentId;
  assert(setupIntentId, "setupIntentId missing");
  evidence.setupIntentId = setupIntentId;
  record(
    "POST /api/stripe/setup-intents",
    true,
    `setupIntentId=${setupIntentId}`,
  );
};

const caseBillingPortal = async () => {
  const res = await request({
    method: "POST",
    path: "/api/stripe/billing-portal",
    token: authToken,
    body: { returnUrl: `${baseUrl}/account` },
  });
  assert(res.status === 201, `Expected 201, got ${res.status}`);
  const url = res.json?.data?.url;
  assert(
    typeof url === "string" && url.startsWith("http"),
    "portal URL missing/invalid",
  );
  evidence.portalUrl = url;
  record("POST /api/stripe/billing-portal", true, "portal url returned");
};

const caseLegacyIniciar = async () => {
  if (!orderIdLegacy) {
    record(
      "POST /api/pagos/iniciar",
      true,
      "skipped (ORDER_ID_LEGACY missing)",
    );
    return;
  }

  const idem = `qa-smoke-legacy-${orderIdLegacy}-${runId}`;
  const first = await request({
    method: "POST",
    path: "/api/pagos/iniciar",
    token: authToken,
    headers: { "Idempotency-Key": idem },
    body: { ordenId: orderIdLegacy, metodoPago: "TARJETA" },
  });

  assert(
    [200, 201].includes(first.status),
    `Expected 200/201, got ${first.status}`,
  );
  const pagoId = first.json?.data?.pagoId;
  assert(pagoId, "legacy pagoId missing");
  evidence.legacyPagoId = pagoId;

  const second = await request({
    method: "POST",
    path: "/api/pagos/iniciar",
    token: authToken,
    headers: { "Idempotency-Key": idem },
    body: { ordenId: orderIdLegacy, metodoPago: "TARJETA" },
  });

  assert(
    [200, 201].includes(second.status),
    `Expected 200/201 on second, got ${second.status}`,
  );
  const secondPi = second.json?.data?.paymentIntentId;
  assert(
    secondPi === first.json?.data?.paymentIntentId,
    "Legacy idempotency failed",
  );
  record("POST /api/pagos/iniciar idempotency", true, `pagoId=${pagoId}`);
};

const caseRefund = async () => {
  if (!orderIdRefund || !adminToken) {
    record(
      "POST /api/stripe/refunds",
      true,
      "skipped (ORDER_ID_REFUND or ADMIN_TOKEN missing)",
    );
    return;
  }

  const res = await request({
    method: "POST",
    path: "/api/stripe/refunds",
    token: adminToken,
    body: { orderId: orderIdRefund, reason: "qa_smoke_refund" },
  });

  assert(res.status === 200, `Expected 200, got ${res.status}`);
  assert(res.json.success === true, "Expected success=true");
  evidence.refund = res.json?.data;
  record("POST /api/stripe/refunds", true, `orderId=${orderIdRefund}`);
};

const caseWebhookNegative = async () => {
  const endpointMode =
    process.env.WEBHOOK_ENDPOINT_MODE === "pagos" ? "pagos" : "stripe";
  const path =
    endpointMode === "pagos" ? "/api/pagos/webhook" : "/api/stripe/webhook";

  const res = await request({
    method: "POST",
    path,
    headers: { "Stripe-Signature": "t=1739476800,v1=invalid" },
    body: { id: "evt_invalid_smoke", type: "payment_intent.succeeded" },
  });

  assert(
    res.status === 400,
    `Expected 400 for invalid signature, got ${res.status}`,
  );
  record(`POST ${path} invalid signature`, true, "invalid signature rejected");
};

const main = async () => {
  log("Stripe smoke test started");
  log(`Base URL: ${baseUrl}`);

  try {
    await casePublicConfig();
    await casePaymentIntentIdempotency();
    await caseGetPaymentIntent();
    await caseCheckoutSession();
    await caseSetupIntent();
    await caseBillingPortal();
    await caseLegacyIniciar();
    await caseRefund();
    await caseWebhookNegative();
  } catch (error) {
    record(
      "SMOKE FLOW",
      false,
      error instanceof Error ? error.message : String(error),
    );
  }

  log("\nSummary");
  for (const r of results) {
    log(`${r.ok ? "PASS" : "FAIL"} | ${r.name} | ${r.detail}`);
  }

  log("\nEvidence IDs");
  Object.entries(evidence).forEach(([key, value]) => {
    log(`${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
  });

  const hasFail = results.some((r) => !r.ok);
  process.exit(hasFail ? 1 : 0);
};

main();
