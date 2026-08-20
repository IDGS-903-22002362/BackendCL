/**
 * Compara el env que Firebase enviaria en un deploy local (.env + .env.<project>)
 * contra el env actualmente desplegado en la funcion `api`.
 *
 * Solo imprime nombres de variables y si el valor cambia: nunca imprime valores,
 * para no exponer secretos en logs.
 *
 * Uso:
 *   node scripts/env-deploy-diff.mjs deployed-env.txt
 *
 * donde deployed-env.txt es la salida de:
 *   gcloud functions describe api --gen2 --region=us-central1 \
 *     --project=e-comerce-leon --format="value(serviceConfig.environmentVariables)"
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const PROJECT = "e-comerce-leon";
const RUNTIME_MANAGED = new Set([
  "FIREBASE_CONFIG",
  "FUNCTION_TARGET",
  "GCLOUD_PROJECT",
  "EVENTARC_CLOUD_EVENT_SOURCE",
  "LOG_EXECUTION_ID",
]);

const parseEnvFile = (path) => {
  const result = new Map();
  let raw;

  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return result;
  }

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const index = trimmed.indexOf("=");
    if (index <= 0) {
      continue;
    }

    result.set(trimmed.slice(0, index).trim(), trimmed.slice(index + 1).trim());
  }

  return result;
};

const parseDeployed = (path) => {
  const raw = readFileSync(path, "utf8").trim();
  const result = new Map();

  // gcloud separa pares con ';' y los valores pueden contener ',' o '=' internos.
  for (const chunk of raw.split(";")) {
    const index = chunk.indexOf("=");
    if (index <= 0) {
      continue;
    }
    result.set(chunk.slice(0, index).trim(), chunk.slice(index + 1).trim());
  }

  return result;
};

const base = parseEnvFile(resolve("functions/.env"));
const perProject = parseEnvFile(resolve(`functions/.env.${PROJECT}`));
const next = new Map([...base, ...perProject]);
const deployed = parseDeployed(resolve(process.argv[2]));

const added = [];
const changed = [];
const removed = [];

for (const [key, value] of next) {
  if (!deployed.has(key)) {
    added.push(key);
  } else if (deployed.get(key) !== value) {
    changed.push(key);
  }
}

for (const key of deployed.keys()) {
  if (!next.has(key) && !RUNTIME_MANAGED.has(key)) {
    removed.push(key);
  }
}

console.log(`local(.env + .env.${PROJECT}) = ${next.size} vars`);
console.log(`desplegado = ${deployed.size} vars`);
console.log(`\nNUEVAS (${added.length}):\n  ${added.join("\n  ") || "-"}`);
console.log(`\nCAMBIAN (${changed.length}):\n  ${changed.join("\n  ") || "-"}`);
console.log(
  `\nSE PERDERIAN (${removed.length}):\n  ${removed.join("\n  ") || "-"}`,
);
