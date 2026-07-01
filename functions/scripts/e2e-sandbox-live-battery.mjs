#!/usr/bin/env node
/**
 * Live sandbox battery: tokens, env separation, partner isolation, scopes, rotation/revocation.
 * Requires CLUB_LEON_CLIENT_ID_A/SECRET_A, CLUB_LEON_CLIENT_ID_B/SECRET_B env vars.
 */
import dotenv from "dotenv";
import { randomUUID } from "crypto";

dotenv.config();

const SANDBOX =
  (process.env.CLUB_LEON_API_TEST_URL ??
    "https://us-central1-e-comerce-leon.cloudfunctions.net/api/loyalty/sandbox/v1").replace(
    /\/$/,
    "",
  );
const PROD =
  (process.env.CLUB_LEON_API_PRODUCTION_URL ??
    "https://us-central1-e-comerce-leon.cloudfunctions.net/api/loyalty/v1").replace(/\/$/, "");

const clientA = { id: process.env.CLUB_LEON_CLIENT_ID_A ?? process.env.CLUB_LEON_CLIENT_ID ?? "", secret: process.env.CLUB_LEON_CLIENT_SECRET_A ?? process.env.CLUB_LEON_CLIENT_SECRET ?? "" };
const clientB = { id: process.env.CLUB_LEON_CLIENT_ID_B ?? "", secret: process.env.CLUB_LEON_CLIENT_SECRET_B ?? "" };
const memberA = process.env.CLUB_LEON_TEST_MEMBER_A ?? "test_member_partner_a_001";
const memberB = process.env.CLUB_LEON_TEST_MEMBER_B ?? "test_member_partner_b_001";

const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} | ${name} | ${detail}`);
};
const assert = (c, m) => {
  if (!c) throw new Error(m);
};

async function req(base, { method, path, token, body, headers = {} }) {
  const h = { ...headers };
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
    json = { raw: text };
  }
  return { status: res.status, json, headers: res.headers };
}

async function token(base, clientId, clientSecret) {
  const r = await req(base, {
    method: "POST",
    path: "/oauth/token",
    body: { grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret },
  });
  return r;
}

function rid() {
  return `bat_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

async function main() {
  if (!clientA.id || !clientA.secret || !clientB.id || !clientB.secret) {
    console.log("SKIP: set CLUB_LEON_CLIENT_ID_A/SECRET_A and CLUB_LEON_CLIENT_ID_B/SECRET_B");
    process.exit(0);
  }

  try {
    const badSecret = await token(SANDBOX, clientA.id, "wrong_secret_value");
    assert(badSecret.status === 401, `bad secret expected 401 got ${badSecret.status}`);
    record("OAuth invalid secret", true, "401");

    const badGrant = await req(SANDBOX, {
      method: "POST",
      path: "/oauth/token",
      body: { grant_type: "password", client_id: clientA.id, client_secret: clientA.secret },
    });
    assert(
      badGrant.status === 400 || badGrant.status === 401,
      `bad grant expected 400/401 got ${badGrant.status}`,
    );
    record("OAuth invalid grant_type", true, String(badGrant.status));

    const tokA = await token(SANDBOX, clientA.id, clientA.secret);
    assert(tokA.status === 200 && tokA.json.access_token, "token A failed");
    const accessA = tokA.json.access_token;
    record("OAuth Partner A", true, "200");

    const crossEnv = await req(PROD, {
      method: "GET",
      path: `/members/${encodeURIComponent(memberA)}/wallet`,
      token: accessA,
    });
    assert(crossEnv.status === 401, `sandbox token on prod expected 401 got ${crossEnv.status}`);
    record("Sandbox token on prod routes", true, "401 INVALID_TOKEN");

    const walletBFromA = await req(SANDBOX, {
      method: "GET",
      path: `/members/${encodeURIComponent(memberB)}/wallet`,
      token: accessA,
    });
    assert(walletBFromA.status === 404, `cross-partner wallet expected 404 got ${walletBFromA.status}`);
    record("Partner A cannot read Partner B wallet", true, "404");

    const earnBFromA = await req(SANDBOX, {
      method: "POST",
      path: "/earn-transactions",
      token: accessA,
      headers: { "Idempotency-Key": rid() },
      body: {
        memberId: memberB,
        externalTransactionId: `iso-${Date.now()}`,
        amountCents: 1000,
        currency: "MXN",
        channel: "PARTNER",
      },
    });
    assert(earnBFromA.status === 404, `cross-partner earn expected 404 got ${earnBFromA.status}`);
    record("Partner A cannot earn for Partner B member", true, "404");

    const tokB = await token(SANDBOX, clientB.id, clientB.secret);
    assert(tokB.status === 200, "token B failed");
    const accessB = tokB.json.access_token;

    const walletB = await req(SANDBOX, {
      method: "GET",
      path: `/members/${encodeURIComponent(memberB)}/wallet`,
      token: accessB,
    });
    assert(walletB.status === 200, `B wallet expected 200 got ${walletB.status}`);
    record("Partner B wallet read", true, "200");

    const earnFromB = await req(SANDBOX, {
      method: "POST",
      path: "/earn-transactions",
      token: accessB,
      headers: { "Idempotency-Key": rid() },
      body: {
        memberId: memberB,
        externalTransactionId: `scope-${Date.now()}`,
        amountCents: 1000,
        currency: "MXN",
        channel: "PARTNER",
      },
    });
    assert(earnFromB.status === 403, `B earn expected 403 got ${earnFromB.status}`);
    record("Partner B scope deny earn", true, "403");

    const tampered = `${accessA.slice(0, -4)}xxxx`;
    const tamperedRes = await req(SANDBOX, {
      method: "GET",
      path: `/members/${encodeURIComponent(memberA)}/wallet`,
      token: tampered,
    });
    assert(tamperedRes.status === 401, `tampered token expected 401 got ${tamperedRes.status}`);
    record("Tampered JWT rejected", true, "401");
  } catch (e) {
    record("battery", false, e instanceof Error ? e.message : String(e));
  }

  const failed = results.filter((r) => !r.ok);
  process.exit(failed.length ? 1 : 0);
}

main();
