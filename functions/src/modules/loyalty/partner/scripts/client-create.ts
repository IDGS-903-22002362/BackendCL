#!/usr/bin/env node
import "../../../../config/firebase.admin";
import { LoyaltyEnvironment, PartnerScope } from "../../models/loyalty.enums";
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
  const args = parseArgs();
  const partnerId = args.partnerId;
  const environment =
    args.environment === "production"
      ? LoyaltyEnvironment.PRODUCTION
      : LoyaltyEnvironment.SANDBOX;
  const scopes = (args.scopes ?? Object.values(PartnerScope).join(","))
    .split(",")
    .map((s) => s.trim()) as PartnerScope[];

  if (!partnerId || !args.name) {
    console.error("Uso: --partnerId=... --name=... --environment=sandbox --scopes=...");
    process.exit(1);
  }

  const { partner, clientId, clientSecret } = await partnerRegistryService.createPartner({
    name: args.name,
    environment,
    scopes,
  });

  console.log(JSON.stringify({ partnerId: partner.partnerId, clientId, clientSecret }, null, 2));
  console.error("\n⚠️  Guarda clientSecret ahora.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
