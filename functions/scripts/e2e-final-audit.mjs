#!/usr/bin/env node
/**
 * Auditoría E2E final del sistema de lealtad (sandbox live).
 *
 * Cubre:
 *  1. Flujo partner completo (token → wallet → earn → txn → replay → hold → confirm/cancel → reversal)
 *  2. Idempotencia paralela (N requests simultáneos, misma clave)
 *  3. Conflicto de idempotencia (misma clave, body distinto → 409)
 *  4. Mismo externalTransactionId con claves distintas → una sola acumulación
 *  5. Aislamiento entre partners (A no puede leer/mutar recursos de B y viceversa)
 *  6. Scopes (cliente read-only no puede mutar)
 *  7. Aislamiento sandbox/producción (token sandbox rechazado en /loyalty/v1)
 *
 * Credenciales vía env:
 *  E2E_A_CLIENT_ID / E2E_A_CLIENT_SECRET / E2E_A_MEMBER
 *  E2E_B_CLIENT_ID / E2E_B_CLIENT_SECRET / E2E_B_MEMBER
 *  E2E_RO_CLIENT_ID / E2E_RO_CLIENT_SECRET / E2E_RO_MEMBER
 */
import { randomUUID } from "crypto";

const SANDBOX = "https://us-central1-e-comerce-leon.cloudfunctions.net/api/loyalty/sandbox/v1";
const PROD = "https://us-central1-e-comerce-leon.cloudfunctions.net/api/loyalty/v1";

const A = {
  clientId: process.env.E2E_A_CLIENT_ID,
  clientSecret: process.env.E2E_A_CLIENT_SECRET,
  memberId: process.env.E2E_A_MEMBER,
};
const B = {
  clientId: process.env.E2E_B_CLIENT_ID,
  clientSecret: process.env.E2E_B_CLIENT_SECRET,
  memberId: process.env.E2E_B_MEMBER,
};
const RO = {
  clientId: process.env.E2E_RO_CLIENT_ID,
  clientSecret: process.env.E2E_RO_CLIENT_SECRET,
  memberId: process.env.E2E_RO_MEMBER,
};

if (!A.clientId || !B.clientId || !RO.clientId) {
  console.error("Faltan credenciales E2E_A_*, E2E_B_*, E2E_RO_*");
  process.exit(1);
}

const results = [];
function record(section, name, ok, detail = "") {
  results.push({ section, name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} | [${section}] ${name}${detail ? " | " + detail : ""}`);
}

function rid() {
  return `audit_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

async function call(base, method, path, { token, body, headers = {} } = {}) {
  const h = { "X-Request-Id": rid(), ...headers };
  if (body !== undefined) h["Content-Type"] = "application/json";
  if (token) h.Authorization = `Bearer ${token}`;
  const res = await fetch(`${base}${path}`, {
    method,
    headers: h,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  return { status: res.status, json };
}

async function getToken(creds) {
  const res = await call(SANDBOX, "POST", "/oauth/token", {
    body: {
      grant_type: "client_credentials",
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
    },
  });
  if (res.status !== 200) throw new Error(`token ${creds.clientId}: ${res.status}`);
  return res.json.access_token;
}

const run = Date.now();

async function main() {
  const tokenA = await getToken(A);
  const tokenB = await getToken(B);
  const tokenRO = await getToken(RO);
  record("oauth", "tokens emitidos para A, B y read-only", true);

  // decode claims (sin verificar, solo inspección)
  const claims = JSON.parse(Buffer.from(tokenA.split(".")[1], "base64url").toString());
  record(
    "oauth",
    "claims JWT: partnerId, clientId, environment, scopes, jti/tokenId, exp",
    Boolean(claims.partnerId && claims.clientId && claims.environment === "sandbox" && Array.isArray(claims.scopes) && (claims.jti || claims.tokenId) && claims.exp),
    `env=${claims.environment} scopes=${claims.scopes.length} ttl=${claims.exp - claims.iat}s jti=${Boolean(claims.jti)}`,
  );

  // ===== 1. Flujo completo partner A =====
  const w0 = await call(SANDBOX, "GET", `/members/${A.memberId}/wallet`, { token: tokenA });
  record("flujo", "GET wallet inicial", w0.status === 200, `saldo=${w0.json?.wallet?.availablePoints}`);
  const before = w0.json.wallet.availablePoints;

  const earnKey = `audit-earn-${run}`;
  const extId = `AUDIT-ORDER-${run}`;
  const earnBody = {
    memberId: A.memberId,
    externalTransactionId: extId,
    amountCents: 50000,
    currency: "MXN",
    channel: "PARTNER",
    description: "Auditoria E2E earn",
  };
  const earn = await call(SANDBOX, "POST", "/earn-transactions", {
    token: tokenA,
    headers: { "Idempotency-Key": earnKey },
    body: earnBody,
  });
  record("flujo", "POST earn 500 MXN → 201", earn.status === 201, `puntos=${earn.json?.transaction?.points}`);
  const txnId = earn.json?.transaction?.transactionId;
  const earnPoints = earn.json?.transaction?.points;
  record("flujo", "backend calcula puntos (50 por $500)", earnPoints === 50, `points=${earnPoints}`);

  const getTxn = await call(SANDBOX, "GET", `/transactions/${txnId}`, { token: tokenA });
  record("flujo", "GET transacción propia", getTxn.status === 200);

  // ===== 2. Idempotencia paralela: 20 requests misma clave =====
  const parallel = await Promise.all(
    Array.from({ length: 20 }, () =>
      call(SANDBOX, "POST", "/earn-transactions", {
        token: tokenA,
        headers: { "Idempotency-Key": earnKey },
        body: earnBody,
      }),
    ),
  );
  const okCount = parallel.filter((r) => r.status === 201).length;
  const errCount = parallel.filter((r) => r.status >= 500).length;
  const distinctTxn = new Set(parallel.filter((r) => r.status === 201).map((r) => r.json?.transaction?.transactionId));
  const retriable409 = parallel.filter((r) => r.status === 409).length;
  record(
    "idempotencia",
    "20 requests paralelos misma clave: sin 500, un solo transactionId",
    errCount === 0 && distinctTxn.size === 1 && [...distinctTxn][0] === txnId,
    `201=${okCount} 409=${retriable409} 500=${errCount} txnIds=${distinctTxn.size}`,
  );

  const w1 = await call(SANDBOX, "GET", `/members/${A.memberId}/wallet`, { token: tokenA });
  record(
    "idempotencia",
    "saldo incrementó exactamente una vez",
    w1.json.wallet.availablePoints === before + earnPoints,
    `${before} → ${w1.json.wallet.availablePoints} (esperado ${before + earnPoints})`,
  );

  // ===== 3. Conflicto: misma clave, body distinto → 409 =====
  const conflict = await call(SANDBOX, "POST", "/earn-transactions", {
    token: tokenA,
    headers: { "Idempotency-Key": earnKey },
    body: { ...earnBody, amountCents: 99900 },
  });
  record(
    "idempotencia",
    "misma clave + body distinto → 409 IDEMPOTENCY_CONFLICT",
    conflict.status === 409 && conflict.json.code === "IDEMPOTENCY_CONFLICT",
    `status=${conflict.status} code=${conflict.json.code}`,
  );

  // ===== 4. Mismo externalTransactionId, clave nueva → duplicado controlado =====
  const dup = await call(SANDBOX, "POST", "/earn-transactions", {
    token: tokenA,
    headers: { "Idempotency-Key": `audit-dup-${run}` },
    body: earnBody,
  });
  const dupOk =
    (dup.status === 201 && dup.json?.transaction?.transactionId === txnId) ||
    (dup.status === 409 && dup.json.code === "DUPLICATE_TRANSACTION");
  const w2 = await call(SANDBOX, "GET", `/members/${A.memberId}/wallet`, { token: tokenA });
  record(
    "idempotencia",
    "mismo externalTransactionId con clave nueva no duplica saldo",
    dupOk && w2.json.wallet.availablePoints === before + earnPoints,
    `status=${dup.status} saldo=${w2.json.wallet.availablePoints}`,
  );

  // ===== 5. Canje hold/confirm y hold/cancel =====
  const holdRes = await call(SANDBOX, "POST", "/redemptions", {
    token: tokenA,
    headers: { "Idempotency-Key": `audit-hold-${run}` },
    body: { memberId: A.memberId, points: 20, description: "Auditoria hold" },
  });
  const redemptionId = holdRes.json?.redemption?.redemptionId;
  const w3 = await call(SANDBOX, "GET", `/members/${A.memberId}/wallet`, { token: tokenA });
  record(
    "canje",
    "hold: available baja y held sube",
    holdRes.status === 201 &&
      w3.json.wallet.availablePoints === w2.json.wallet.availablePoints - 20 &&
      w3.json.wallet.heldPoints === 20,
    `available=${w3.json.wallet.availablePoints} held=${w3.json.wallet.heldPoints}`,
  );

  const cancel = await call(SANDBOX, "POST", `/redemptions/${redemptionId}/cancel`, {
    token: tokenA,
    headers: { "Idempotency-Key": `audit-cancel-${run}` },
  });
  const w4 = await call(SANDBOX, "GET", `/members/${A.memberId}/wallet`, { token: tokenA });
  record(
    "canje",
    "cancel: puntos regresan, held=0",
    cancel.status === 201 && w4.json.wallet.availablePoints === w2.json.wallet.availablePoints && w4.json.wallet.heldPoints === 0,
    `available=${w4.json.wallet.availablePoints} held=${w4.json.wallet.heldPoints}`,
  );

  const hold2 = await call(SANDBOX, "POST", "/redemptions", {
    token: tokenA,
    headers: { "Idempotency-Key": `audit-hold2-${run}` },
    body: { memberId: A.memberId, points: 15 },
  });
  const red2 = hold2.json?.redemption?.redemptionId;
  const confirm = await call(SANDBOX, "POST", `/redemptions/${red2}/confirm`, {
    token: tokenA,
    headers: { "Idempotency-Key": `audit-confirm-${run}` },
  });
  const confirmAgain = await call(SANDBOX, "POST", `/redemptions/${red2}/confirm`, {
    token: tokenA,
    headers: { "Idempotency-Key": `audit-confirm2-${run}` },
  });
  const cancelAfterConfirm = await call(SANDBOX, "POST", `/redemptions/${red2}/cancel`, {
    token: tokenA,
    headers: { "Idempotency-Key": `audit-cancel2-${run}` },
  });
  record(
    "canje",
    "confirm consume puntos; doble confirm y cancel post-confirm rechazados",
    confirm.status === 201 && confirmAgain.status === 409 && cancelAfterConfirm.status === 409,
    `confirm=${confirm.status} again=${confirmAgain.status} cancelPost=${cancelAfterConfirm.status}`,
  );

  // ===== 6. Reversión =====
  const revEarnExt = `AUDIT-REV-${run}`;
  const revEarn = await call(SANDBOX, "POST", "/earn-transactions", {
    token: tokenA,
    headers: { "Idempotency-Key": `audit-revearn-${run}` },
    body: { ...earnBody, externalTransactionId: revEarnExt, amountCents: 30000 },
  });
  const revTxnId = revEarn.json?.transaction?.transactionId;
  const rev = await call(SANDBOX, "POST", `/transactions/${revTxnId}/reversals`, {
    token: tokenA,
    headers: { "Idempotency-Key": `audit-rev-${run}` },
    body: { reason: "Auditoria reversal total" },
  });
  const revRepeat = await call(SANDBOX, "POST", `/transactions/${revTxnId}/reversals`, {
    token: tokenA,
    headers: { "Idempotency-Key": `audit-rev-${run}` },
    body: { reason: "Auditoria reversal total" },
  });
  const revAgainNewKey = await call(SANDBOX, "POST", `/transactions/${revTxnId}/reversals`, {
    token: tokenA,
    headers: { "Idempotency-Key": `audit-rev2-${run}` },
    body: { reason: "Reversal duplicada" },
  });
  record(
    "reversion",
    "reversión total OK; replay idempotente; reversión extra rechazada",
    rev.status === 201 &&
      revRepeat.status === 201 &&
      revRepeat.json?.transaction?.transactionId === rev.json?.transaction?.transactionId &&
      (revAgainNewKey.status === 409 || revAgainNewKey.status === 400),
    `rev=${rev.status} replay=${revRepeat.status} extra=${revAgainNewKey.status} code=${revAgainNewKey.json?.code}`,
  );

  const revMissing = await call(SANDBOX, "POST", `/transactions/txn_inexistente_123/reversals`, {
    token: tokenA,
    headers: { "Idempotency-Key": `audit-revmiss-${run}` },
    body: { reason: "No existe" },
  });
  record("reversion", "revertir transacción inexistente → 404", revMissing.status === 404);

  // ===== 7. Aislamiento entre partners =====
  const bWalletByA = await call(SANDBOX, "GET", `/members/${B.memberId}/wallet`, { token: tokenA });
  record("aislamiento", "A no lee wallet de miembro de B (404)", bWalletByA.status === 404, `status=${bWalletByA.status}`);

  const bTxnListByA = await call(SANDBOX, "GET", `/members/${B.memberId}/transactions`, { token: tokenA });
  record("aislamiento", "A no lista transacciones de miembro de B (404)", bTxnListByA.status === 404);

  // earn de B para generar recurso de B
  const earnB = await call(SANDBOX, "POST", "/earn-transactions", {
    token: tokenB,
    headers: { "Idempotency-Key": `audit-b-earn-${run}` },
    body: { memberId: B.memberId, externalTransactionId: `AUDIT-B-${run}`, amountCents: 20000, currency: "MXN", channel: "PARTNER" },
  });
  const bTxnId = earnB.json?.transaction?.transactionId;
  const bTxnByA = await call(SANDBOX, "GET", `/transactions/${bTxnId}`, { token: tokenA });
  record("aislamiento", "A no lee transacción de B (404)", bTxnByA.status === 404);

  const bRevByA = await call(SANDBOX, "POST", `/transactions/${bTxnId}/reversals`, {
    token: tokenA,
    headers: { "Idempotency-Key": `audit-a-revb-${run}` },
    body: { reason: "Intento cruzado" },
  });
  record("aislamiento", "A no revierte transacción de B (404)", bRevByA.status === 404);

  const holdB = await call(SANDBOX, "POST", "/redemptions", {
    token: tokenB,
    headers: { "Idempotency-Key": `audit-b-hold-${run}` },
    body: { memberId: B.memberId, points: 5 },
  });
  const bRedId = holdB.json?.redemption?.redemptionId;
  const bConfirmByA = await call(SANDBOX, "POST", `/redemptions/${bRedId}/confirm`, {
    token: tokenA,
    headers: { "Idempotency-Key": `audit-a-confb-${run}` },
  });
  record("aislamiento", "A no confirma redención de B (404)", bConfirmByA.status === 404, `status=${bConfirmByA.status}`);

  const mtB = await call(SANDBOX, "POST", "/member-tokens", {
    token: tokenB,
    body: { memberId: B.memberId },
  });
  const earnWithBTokenByA = await call(SANDBOX, "POST", "/earn-transactions", {
    token: tokenA,
    headers: { "Idempotency-Key": `audit-a-mtb-${run}` },
    body: { memberToken: mtB.json?.memberToken, externalTransactionId: `AUDIT-MT-${run}`, amountCents: 10000, currency: "MXN", channel: "PARTNER" },
  });
  record("aislamiento", "A no usa member token de B (401)", earnWithBTokenByA.status === 401, `status=${earnWithBTokenByA.status}`);

  // sentido inverso: B intenta leer A
  const aWalletByB = await call(SANDBOX, "GET", `/members/${A.memberId}/wallet`, { token: tokenB });
  const aTxnByB = await call(SANDBOX, "GET", `/transactions/${txnId}`, { token: tokenB });
  record("aislamiento", "B no lee wallet ni transacción de A (404)", aWalletByB.status === 404 && aTxnByB.status === 404);

  // ===== 8. Scopes read-only =====
  const roWallet = await call(SANDBOX, "GET", `/members/${RO.memberId}/wallet`, { token: tokenRO });
  const roTxns = await call(SANDBOX, "GET", `/members/${RO.memberId}/transactions`, { token: tokenRO });
  record("scopes", "read-only puede GET wallet y transactions", roWallet.status === 200 && roTxns.status === 200);

  const roEarn = await call(SANDBOX, "POST", "/earn-transactions", {
    token: tokenRO,
    headers: { "Idempotency-Key": `audit-ro-earn-${run}` },
    body: { memberId: RO.memberId, externalTransactionId: `AUDIT-RO-${run}`, amountCents: 10000, currency: "MXN", channel: "PARTNER" },
  });
  const roRed = await call(SANDBOX, "POST", "/redemptions", {
    token: tokenRO,
    headers: { "Idempotency-Key": `audit-ro-red-${run}` },
    body: { memberId: RO.memberId, points: 5 },
  });
  const roRev = await call(SANDBOX, "POST", `/transactions/${txnId}/reversals`, {
    token: tokenRO,
    headers: { "Idempotency-Key": `audit-ro-rev-${run}` },
    body: { reason: "scope test" },
  });
  record(
    "scopes",
    "read-only no puede earn/redemption/reversal (403 INVALID_SCOPE)",
    roEarn.status === 403 && roRed.status === 403 && roRev.status === 403 &&
      roEarn.json.code === "INVALID_SCOPE",
    `earn=${roEarn.status} red=${roRed.status} rev=${roRev.status}`,
  );

  // ===== 9. Aislamiento sandbox/producción =====
  const prodWithSandboxToken = await call(PROD, "GET", `/members/${A.memberId}/wallet`, { token: tokenA });
  record(
    "ambientes",
    "token sandbox en endpoint producción → 401 INVALID_TOKEN",
    prodWithSandboxToken.status === 401,
    `status=${prodWithSandboxToken.status} code=${prodWithSandboxToken.json?.code}`,
  );

  const prodTokenWithSandboxCreds = await call(PROD, "POST", "/oauth/token", {
    body: { grant_type: "client_credentials", client_id: A.clientId, client_secret: A.clientSecret },
  });
  // El endpoint prod emite token con environment=sandbox del registro; verificar que ese token NO funcione en prod
  let crossOk = prodTokenWithSandboxCreds.status !== 200;
  let crossDetail = `tokenStatus=${prodTokenWithSandboxCreds.status}`;
  if (prodTokenWithSandboxCreds.status === 200) {
    const crossToken = prodTokenWithSandboxCreds.json.access_token;
    const crossUse = await call(PROD, "GET", `/members/${A.memberId}/wallet`, { token: crossToken });
    crossOk = crossUse.status === 401;
    crossDetail += ` useInProd=${crossUse.status}`;
    const crossUseSandbox = await call(SANDBOX, "GET", `/members/${A.memberId}/wallet`, { token: crossToken });
    crossDetail += ` useInSandbox=${crossUseSandbox.status}`;
  }
  record("ambientes", "credenciales sandbox no habilitan acceso producción", crossOk, crossDetail);

  // sin token
  const noAuth = await call(SANDBOX, "GET", `/members/${A.memberId}/wallet`, {});
  record("auth", "sin token → 401 problem+json", noAuth.status === 401 && noAuth.json.code === "AUTHENTICATION_REQUIRED");

  // token corrupto
  const badToken = await call(SANDBOX, "GET", `/members/${A.memberId}/wallet`, { token: "abc.def.ghi" });
  record("auth", "token inválido → 401 INVALID_TOKEN", badToken.status === 401 && badToken.json.code === "INVALID_TOKEN");

  // resumen
  const failed = results.filter((r) => !r.ok);
  console.log(`\n===== RESUMEN: ${results.length - failed.length}/${results.length} PASS =====`);
  if (failed.length) {
    failed.forEach((f) => console.log(`FALLA: [${f.section}] ${f.name} ${f.detail}`));
    process.exit(1);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error("ERROR FATAL:", e.message);
  process.exit(1);
});
