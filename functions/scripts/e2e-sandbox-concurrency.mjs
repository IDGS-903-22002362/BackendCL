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
const PARALLEL = Number(process.env.CLUB_LEON_E2E_PARALLEL ?? 20);

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
  console.log(`Club León sandbox concurrency E2E (${PARALLEL} parallel)`);

  if (!clientId || !clientSecret) {
    console.log("SKIP: define CLUB_LEON_CLIENT_ID y CLUB_LEON_CLIENT_SECRET.");
    process.exit(0);
  }

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

  if (tokenRes.status !== 200 || !tokenRes.json.access_token) {
    console.error("OAuth failed:", tokenRes.status);
    process.exit(1);
  }

  const accessToken = tokenRes.json.access_token;
  const runId = Date.now();
  const idempotencyKey = `e2e-concurrent-${runId}`;
  const externalTransactionId = `e2e-concurrent-ext-${runId}`;
  const earnBody = {
    memberId,
    externalTransactionId,
    amountCents: 1_000,
    currency: "MXN",
    channel: "PARTNER",
    description: "E2E concurrent earn",
  };

  const tasks = Array.from({ length: PARALLEL }, (_, index) =>
    request({
      method: "POST",
      path: "/earn-transactions",
      token: accessToken,
      headers: {
        "Idempotency-Key": idempotencyKey,
        "X-Request-Id": newRequestId(),
      },
      body: earnBody,
    }).then((res) => ({ index, ...res })),
  );

  const results = await Promise.all(tasks);
  const success = results.filter((r) => r.status === 201);
  const transactionIds = new Set(
    success.map((r) => r.json?.transaction?.transactionId).filter(Boolean),
  );

  console.log(`201 responses: ${success.length}/${PARALLEL}`);
  console.log(`Unique transactionIds: ${transactionIds.size}`);

  if (success.length !== PARALLEL) {
    console.error("Expected all parallel requests to return 201");
    process.exit(1);
  }

  if (transactionIds.size !== 1) {
    console.error("Expected exactly one transactionId across concurrent replays");
    process.exit(1);
  }

  const duplicateExtKey = `e2e-dup-ext-${runId}`;
  const firstDup = await request({
    method: "POST",
    path: "/earn-transactions",
    token: accessToken,
    headers: { "Idempotency-Key": duplicateExtKey, "X-Request-Id": newRequestId() },
    body: {
      ...earnBody,
      externalTransactionId: `e2e-dup-ext-txn-${runId}`,
      amountCents: 2_000,
    },
  });

  const secondDup = await request({
    method: "POST",
    path: "/earn-transactions",
    token: accessToken,
    headers: { "Idempotency-Key": `e2e-dup-ext-other-${runId}`, "X-Request-Id": newRequestId() },
    body: {
      ...earnBody,
      externalTransactionId: `e2e-dup-ext-txn-${runId}`,
      amountCents: 2_000,
    },
  });

  if (firstDup.status !== 201) {
    console.error("First duplicate external txn expected 201, got", firstDup.status);
    process.exit(1);
  }

  if (secondDup.status !== 201 && secondDup.status !== 409) {
    console.error("Duplicate externalTransactionId expected 201 or 409, got", secondDup.status);
    process.exit(1);
  }

  if (
    firstDup.json?.transaction?.transactionId &&
    secondDup.json?.transaction?.transactionId &&
    firstDup.json.transaction.transactionId !== secondDup.json.transaction.transactionId
  ) {
    console.error("Duplicate externalTransactionId must return same transactionId");
    process.exit(1);
  }

  console.log("PASS | concurrent idempotency + duplicate external txn");
  process.exit(0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
