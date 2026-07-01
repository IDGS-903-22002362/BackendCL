#!/usr/bin/env node
import dotenv from "dotenv";
import { randomUUID } from "crypto";

dotenv.config();

const DEFAULT_BASE_URL =
  "https://us-central1-e-comerce-leon.cloudfunctions.net/api/loyalty/sandbox/v1";

const baseUrl = (process.env.CLUB_LEON_API_TEST_URL ?? DEFAULT_BASE_URL).replace(/\/$/, "");
const clientId = process.env.CLUB_LEON_CLIENT_ID ?? "";
const clientSecret = process.env.CLUB_LEON_CLIENT_SECRET ?? "";
const memberId =
  process.env.CLUB_LEON_TEST_MEMBER_ID ??
  process.env.CLUB_LEON_MEMBER_ID ??
  "test_member_cine_001";

const SECRET_KEYS = new Set([
  "client_secret",
  "clientSecret",
  "access_token",
  "accessToken",
  "memberToken",
]);

function redactValue(key, value) {
  if (typeof value === "string" && SECRET_KEYS.has(key)) {
    if (value.length <= 8) return "***";
    return `${value.slice(0, 4)}…${value.slice(-4)} (redacted)`;
  }
  return value;
}

function redactDeep(input) {
  if (Array.isArray(input)) {
    return input.map((item) => redactDeep(item));
  }
  if (input && typeof input === "object") {
    const out = {};
    for (const [key, value] of Object.entries(input)) {
      out[key] = redactDeep(redactValue(key, value));
    }
    return out;
  }
  return input;
}

function safeStringify(value) {
  return JSON.stringify(redactDeep(value), null, 2);
}

const log = (line) => console.log(line);

const results = [];

const record = (name, ok, detail) => {
  results.push({ name, ok, detail });
  log(`${ok ? "PASS" : "FAIL"} | ${name} | ${detail}`);
};

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

async function request({ method, path, token, body, headers = {} }) {
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
}

function newRequestId() {
  return `e2e_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
}

async function main() {
  log(`Club León loyalty sandbox partner E2E`);
  log(`Base URL: ${baseUrl}`);

  if (!clientId || !clientSecret) {
    log(
      "SKIP: define CLUB_LEON_CLIENT_ID y CLUB_LEON_CLIENT_SECRET para ejecutar el flujo contra sandbox.",
    );
    process.exit(0);
  }

  log(`Client ID: ${clientId}`);
  log(`Member ID: ${memberId}`);

  const runId = Date.now();
  let accessToken = "";

  try {
    const tokenRes = await request({
      method: "POST",
      path: "/oauth/token",
      headers: { "X-Request-Id": newRequestId() },
      body: {
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret,
      },
    });

    assert(tokenRes.status === 200, `oauth/token expected 200, got ${tokenRes.status}`);
    accessToken = tokenRes.json.access_token;
    assert(typeof accessToken === "string" && accessToken.length > 0, "access_token missing");
    record("POST /oauth/token", true, safeStringify(tokenRes.json));

    const walletBeforeRes = await request({
      method: "GET",
      path: `/members/${encodeURIComponent(memberId)}/wallet`,
      token: accessToken,
      headers: { "X-Request-Id": newRequestId() },
    });

    assert(walletBeforeRes.status === 200, `wallet expected 200, got ${walletBeforeRes.status}`);
    const pointsBefore = Number(walletBeforeRes.json?.wallet?.availablePoints ?? 0);
    record("GET /members/:memberId/wallet (before earn)", true, `availablePoints=${pointsBefore}`);

    const idempotencyKey = `e2e-earn-${runId}`;
    const externalTransactionId = `e2e-ext-${runId}`;
    const earnBody = {
      memberId,
      externalTransactionId,
      amountCents: 10_000,
      currency: "MXN",
      channel: "PARTNER",
      description: "E2E sandbox partner earn",
    };

    const earnRes = await request({
      method: "POST",
      path: "/earn-transactions",
      token: accessToken,
      headers: {
        "Idempotency-Key": idempotencyKey,
        "X-Request-Id": newRequestId(),
      },
      body: earnBody,
    });

    assert(earnRes.status === 201, `earn expected 201, got ${earnRes.status}: ${safeStringify(earnRes.json)}`);
    const transactionId = earnRes.json?.transaction?.transactionId;
    assert(transactionId, "transactionId missing on earn");
    record("POST /earn-transactions", true, `transactionId=${transactionId}`);

    const getTxnRes = await request({
      method: "GET",
      path: `/transactions/${encodeURIComponent(transactionId)}`,
      token: accessToken,
      headers: { "X-Request-Id": newRequestId() },
    });

    assert(getTxnRes.status === 200, `get transaction expected 200, got ${getTxnRes.status}`);
    assert(
      getTxnRes.json?.transaction?.transactionId === transactionId,
      "transaction id mismatch on GET",
    );
    record("GET /transactions/:transactionId", true, `transactionId=${transactionId}`);

    const earnRepeatRes = await request({
      method: "POST",
      path: "/earn-transactions",
      token: accessToken,
      headers: {
        "Idempotency-Key": idempotencyKey,
        "X-Request-Id": newRequestId(),
      },
      body: earnBody,
    });

    assert(
      earnRepeatRes.status === 201,
      `idempotent earn expected 201, got ${earnRepeatRes.status}`,
    );
    assert(
      earnRepeatRes.json?.transaction?.transactionId === transactionId,
      "idempotent earn must return same transactionId",
    );
    record(
      "POST /earn-transactions (idempotency replay)",
      true,
      `same transactionId=${transactionId}`,
    );

    const walletAfterRes = await request({
      method: "GET",
      path: `/members/${encodeURIComponent(memberId)}/wallet`,
      token: accessToken,
      headers: { "X-Request-Id": newRequestId() },
    });

    assert(walletAfterRes.status === 200, `wallet after expected 200, got ${walletAfterRes.status}`);
    const pointsAfter = Number(walletAfterRes.json?.wallet?.availablePoints ?? 0);
    const earnedOnce = pointsAfter - pointsBefore;
    const expectedPoints = Number(earnRes.json?.transaction?.points ?? 0);
    assert(expectedPoints > 0, "expected positive points on earn transaction");
    assert(
      earnedOnce === expectedPoints,
      `wallet delta ${earnedOnce} != earn points ${expectedPoints} (double credit?)`,
    );
    record(
      "GET /members/:memberId/wallet (after earn + idempotency)",
      true,
      `availablePoints=${pointsAfter} (+${earnedOnce})`,
    );

    const conflictKey = `e2e-conflict-${runId}`;
    await request({
      method: "POST",
      path: "/earn-transactions",
      token: accessToken,
      headers: { "Idempotency-Key": conflictKey, "X-Request-Id": newRequestId() },
      body: earnBody,
    });
    const conflictRes = await request({
      method: "POST",
      path: "/earn-transactions",
      token: accessToken,
      headers: { "Idempotency-Key": conflictKey, "X-Request-Id": newRequestId() },
      body: { ...earnBody, amountCents: 20_000 },
    });
    assert(conflictRes.status === 409, `idempotency conflict expected 409, got ${conflictRes.status}`);
    record("POST /earn-transactions (idempotency conflict)", true, "409 IDEMPOTENCY_CONFLICT");

    const redeemPoints = 10;
    const redeemIdempotency = `e2e-redeem-${runId}`;
    const redeemRes = await request({
      method: "POST",
      path: "/redemptions",
      token: accessToken,
      headers: { "Idempotency-Key": redeemIdempotency, "X-Request-Id": newRequestId() },
      body: { memberId, points: redeemPoints, description: "E2E sandbox redemption" },
    });
    assert(redeemRes.status === 201, `redemption expected 201, got ${redeemRes.status}`);
    const redemptionId = redeemRes.json?.redemption?.redemptionId;
    assert(redemptionId, "redemptionId missing");
    record("POST /redemptions (flow B)", true, `redemptionId=${redemptionId}`);

    const confirmRes = await request({
      method: "POST",
      path: `/redemptions/${encodeURIComponent(redemptionId)}/confirm`,
      token: accessToken,
      headers: { "Idempotency-Key": `e2e-confirm-${runId}`, "X-Request-Id": newRequestId() },
    });
    assert(confirmRes.status === 201, `confirm expected 201, got ${confirmRes.status}`);
    record("POST /redemptions/:id/confirm (flow B)", true, `redemptionId=${redemptionId}`);

    const reversalEarnKey = `e2e-earn-reversal-${runId}`;
    const reversalExtId = `e2e-ext-reversal-${runId}`;
    const reversalEarnRes = await request({
      method: "POST",
      path: "/earn-transactions",
      token: accessToken,
      headers: { "Idempotency-Key": reversalEarnKey, "X-Request-Id": newRequestId() },
      body: {
        memberId,
        externalTransactionId: reversalExtId,
        amountCents: 5_000,
        currency: "MXN",
        channel: "PARTNER",
        description: "E2E earn for reversal",
      },
    });
    assert(reversalEarnRes.status === 201, `reversal earn expected 201, got ${reversalEarnRes.status}`);
    const reversalTxnId = reversalEarnRes.json?.transaction?.transactionId;
    assert(reversalTxnId, "reversal transactionId missing");

    const reversalRes = await request({
      method: "POST",
      path: `/transactions/${encodeURIComponent(reversalTxnId)}/reversals`,
      token: accessToken,
      headers: { "Idempotency-Key": `e2e-reversal-${runId}`, "X-Request-Id": newRequestId() },
      body: { reason: "E2E sandbox reversal" },
    });
    assert(reversalRes.status === 201, `reversal expected 201, got ${reversalRes.status}`);
    record("POST /transactions/:id/reversals (flow C)", true, `transactionId=${reversalTxnId}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    record("sandbox partner flow", false, message);
  }

  const failed = results.filter((r) => !r.ok);
  if (failed.length > 0) {
    log(`\n${failed.length} step(s) failed.`);
    process.exit(1);
  }

  log(`\nAll ${results.length} step(s) passed.`);
  process.exit(0);
}

main().catch((error) => {
  log(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
