#!/usr/bin/env node
/**
 * npm run loyalty:partner:create -- --name="Cine Ejemplo" --environment=sandbox --scopes="loyalty.wallet.read,loyalty.points.earn"
 */
import "../../../../config/firebase.admin";
import { LoyaltyEnvironment, PartnerScope } from "../../models/loyalty.enums";
import partnerRegistryService from "../services/partner-registry.service";
import { sandboxMemberService } from "../services/sandbox-engine.service";

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
  const name = args.name;
  const environment =
    args.environment === "production"
      ? LoyaltyEnvironment.PRODUCTION
      : LoyaltyEnvironment.SANDBOX;
  const scopesRaw = args.scopes ?? Object.values(PartnerScope).join(",");
  const scopes = scopesRaw.split(",").map((s) => s.trim()) as PartnerScope[];

  if (!name) {
    console.error("Uso: --name=... --environment=sandbox|production --scopes=...");
    process.exit(1);
  }

  const { partner, clientId, clientSecret } = await partnerRegistryService.createPartner({
    name,
    environment,
    scopes,
    allowedLocations: args.locations?.split(",").map((l) => l.trim()) ?? [],
  });

  let testMemberId: string | undefined;
  if (environment === LoyaltyEnvironment.SANDBOX) {
    const { member } = await sandboxMemberService.createTestMember({
      partnerId: partner.partnerId,
      displayName: "Usuario de prueba",
    });
    testMemberId = member.memberId;
  }

  console.log(
    JSON.stringify(
      {
        partnerId: partner.partnerId,
        clientId,
        clientSecret,
        environment: partner.environment,
        scopes: partner.scopes,
        testMemberId,
      },
      null,
      2,
    ),
  );
  console.error("\nâš ï¸  Guarda clientSecret ahora. No se volverÃ¡ a mostrar.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
