import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import SwaggerParser from "@apidevtools/swagger-parser";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicPath = path.join(
  __dirname,
  "../src/modules/loyalty/openapi/loyalty-public-v1.openapi.yaml",
);

const SECRET_PATTERNS = [
  /sk_live_/,
  /sk_test_[a-zA-Z0-9]{20,}/,
  /BEGIN PRIVATE KEY/,
  /SERVICE_ACCOUNT/,
  /client_secret:\s*secret_[a-f0-9]{20,}/i,
];

async function main() {
  if (!fs.existsSync(publicPath)) {
    console.error("Missing public OpenAPI:", publicPath);
    process.exit(1);
  }

  const raw = fs.readFileSync(publicPath, "utf8");
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(raw)) {
      console.error("Secret pattern detected in public OpenAPI");
      process.exit(1);
    }
  }

  const api = await SwaggerParser.validate(publicPath);
  const paths = Object.keys(api.paths ?? {});
  const internalPrefixes = ["/admin/", "/wallets/me"];
  for (const p of paths) {
    if (internalPrefixes.some((prefix) => p.startsWith(prefix))) {
      console.error("Internal path in public spec:", p);
      process.exit(1);
    }
  }

  for (const [pathKey, pathItem] of Object.entries(api.paths ?? {})) {
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!["get", "post", "put", "patch", "delete"].includes(method)) continue;
      if (!operation.operationId) {
        console.error(`Missing operationId: ${method.toUpperCase()} ${pathKey}`);
        process.exit(1);
      }
      if (operation["x-internal"]) {
        console.error(`x-internal in public spec: ${pathKey}`);
        process.exit(1);
      }
    }
  }

  console.log("Public OpenAPI valid:", paths.length, "paths");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
