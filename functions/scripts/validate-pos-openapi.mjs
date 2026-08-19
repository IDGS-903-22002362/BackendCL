import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import SwaggerParser from "@apidevtools/swagger-parser";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const openApiPath = path.join(
  __dirname,
  "../src/modules/pos/openapi/pos-v1.openapi.yaml",
);

const SECRET_PATTERNS = [
  /sk_live_/,
  /sk_test_[a-zA-Z0-9]{20,}/,
  /BEGIN PRIVATE KEY/,
  /SERVICE_ACCOUNT/,
];

async function main() {
  if (!fs.existsSync(openApiPath)) {
    console.error("Missing POS OpenAPI:", openApiPath);
    process.exit(1);
  }

  const raw = fs.readFileSync(openApiPath, "utf8");
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(raw)) {
      console.error("Secret pattern detected in POS OpenAPI");
      process.exit(1);
    }
  }

  const api = await SwaggerParser.validate(openApiPath);
  const paths = Object.keys(api.paths ?? {});
  console.log(`POS OpenAPI OK (${paths.length} paths)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
