// Lanza e2e-final-audit.mjs inyectando credenciales sandbox de prueba desde
// los artefactos temporales del aprovisionamiento autorizado (TEMP). Las
// credenciales solo viven en memoria del proceso.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

function readText(p) {
  const b = fs.readFileSync(p);
  return b.length >= 2 && b[0] === 0xff && b[1] === 0xfe ? b.toString("utf16le") : b.toString("utf8");
}

function parseBlock(t) {
  const m = t.indexOf('"partnerId"') >= 0 ? t.indexOf('"partnerId"') : t.indexOf('"clientId"');
  const s = t.lastIndexOf("{", m);
  const e = t.indexOf("\n}", m);
  return JSON.parse(t.slice(s, e + 2));
}

const tmp = os.tmpdir();
const aMeta = parseBlock(readText(path.join(tmp, "partner-a-create.json")));
const aSecret = parseBlock(readText(path.join(tmp, "partner-a-rotate-out.txt")));
const b = parseBlock(readText(path.join(tmp, "partner-b-create.json")));
const ro = parseBlock(readText(path.join(tmp, "partner-ro-create.json")));

const env = {
  ...process.env,
  E2E_A_CLIENT_ID: aMeta.clientId,
  E2E_A_CLIENT_SECRET: aSecret.clientSecret,
  E2E_A_MEMBER: "test_member_partner_a_001",
  E2E_B_CLIENT_ID: b.clientId,
  E2E_B_CLIENT_SECRET: b.clientSecret,
  E2E_B_MEMBER: "test_member_partner_b_001",
  E2E_RO_CLIENT_ID: ro.clientId,
  E2E_RO_CLIENT_SECRET: ro.clientSecret,
  E2E_RO_MEMBER: "test_member_partner_a_001",
};

const res = spawnSync("node", ["scripts/e2e-final-audit.mjs"], { stdio: "inherit", env });
process.exit(res.status ?? 1);
