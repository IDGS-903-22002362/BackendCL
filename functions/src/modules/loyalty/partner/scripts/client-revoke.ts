#!/usr/bin/env node
import "../../../../config/firebase.admin";
import partnerRegistryService from "../services/partner-registry.service";

function parseArgs(): Record<string, string> {
  const result: Record<string, string> = {};
  for (const arg of process.argv.slice(2)) {
    const match = arg.match(/^--([^=]+)=(.+)$/);
    if (match) result[match[1]] = match[2];
  }
  return result;
}

async function main(): Promise<void> {
  const { clientId } = parseArgs();
  if (!clientId) {
    console.error("Uso: --clientId=...");
    process.exit(1);
  }
  await partnerRegistryService.revokeClient(clientId);
  console.log(JSON.stringify({ clientId, revoked: true }));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
