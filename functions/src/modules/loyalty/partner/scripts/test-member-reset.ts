#!/usr/bin/env node
import "../../../../config/firebase.admin";
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
  if (!args.partnerId || !args.memberId) {
    console.error("Uso: --partnerId=... --memberId=...");
    process.exit(1);
  }
  const wallet = await sandboxMemberService.resetTestMember(args.memberId, args.partnerId);
  console.log(JSON.stringify({ memberId: args.memberId, wallet }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
