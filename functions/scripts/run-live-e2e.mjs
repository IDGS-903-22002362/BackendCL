import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";

function readText(filePath) {
  const buf = fs.readFileSync(filePath);
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return buf.toString("utf16le");
  }
  return buf.toString("utf8");
}

function parseJsonBlock(text) {
  const marker = text.indexOf('"partnerId"') >= 0 ? text.indexOf('"partnerId"') : text.indexOf('"clientId"');
  if (marker < 0) throw new Error("JSON marker not found");
  const start = text.lastIndexOf("{", marker);
  const end = text.indexOf("\n}", marker);
  if (start < 0 || end < 0) throw new Error("JSON bounds not found");
  return JSON.parse(text.slice(start, end + 2));
}

const tmp = os.tmpdir();
const aMeta = parseJsonBlock(readText(path.join(tmp, "partner-a-create.json")));
const aSecret = parseJsonBlock(readText(path.join(tmp, "partner-a-rotate-out.txt")));
const b = parseJsonBlock(readText(path.join(tmp, "partner-b-create.json")));

const env = {
  ...process.env,
  CLUB_LEON_CLIENT_ID: aMeta.clientId,
  CLUB_LEON_CLIENT_SECRET: aSecret.clientSecret,
  CLUB_LEON_CLIENT_ID_A: aMeta.clientId,
  CLUB_LEON_CLIENT_SECRET_A: aSecret.clientSecret,
  CLUB_LEON_CLIENT_ID_B: b.clientId,
  CLUB_LEON_CLIENT_SECRET_B: b.clientSecret,
  CLUB_LEON_TEST_MEMBER_ID: "test_member_partner_a_001",
  CLUB_LEON_TEST_MEMBER_A: "test_member_partner_a_001",
  CLUB_LEON_TEST_MEMBER_B: "test_member_partner_b_001",
  CLUB_LEON_API_PRODUCTION: "false",
};

for (const cmd of ["npm run e2e:sandbox:battery", "npm run e2e:sandbox", "npm run e2e:sandbox:concurrency"]) {
  console.log(`\n>>> ${cmd}`);
  execSync(cmd, { stdio: "inherit", env });
}