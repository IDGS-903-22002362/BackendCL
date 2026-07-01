import { firestoreApp } from "../../../config/app.firebase";
import { admin } from "../../../config/firebase.admin";

type LoyaltyPhase = "A" | "B" | "C" | "D" | "E" | "rollback";

const PHASE_FLAGS: Record<LoyaltyPhase, Record<string, boolean>> = {
  A: {
    loyaltyV1ReadsEnabled: true,
    legacyPointsAdaptersEnabled: true,
  },
  B: {
    loyaltyV1ReadsEnabled: true,
    loyaltyV1WritesEnabled: true,
    loyaltyPhysicalEarnEnabled: true,
    legacyPointsAdaptersEnabled: true,
  },
  C: {
    loyaltyV1ReadsEnabled: true,
    loyaltyV1WritesEnabled: true,
    loyaltyPhysicalEarnEnabled: true,
    loyaltyDigitalEarnEnabled: true,
    legacyPointsAdaptersEnabled: true,
  },
  D: {
    loyaltyV1ReadsEnabled: true,
    loyaltyV1WritesEnabled: true,
    loyaltyPhysicalEarnEnabled: true,
    loyaltyDigitalEarnEnabled: true,
    loyaltyReversalsEnabled: true,
    legacyPointsAdaptersEnabled: true,
  },
  E: {
    loyaltyV1ReadsEnabled: true,
    loyaltyV1WritesEnabled: true,
    loyaltyPhysicalEarnEnabled: true,
    loyaltyDigitalEarnEnabled: true,
    loyaltyReversalsEnabled: true,
    loyaltyRedemptionsEnabled: true,
    legacyPointsAdaptersEnabled: true,
  },
  rollback: {
    loyaltyV1ReadsEnabled: true,
    loyaltyV1WritesEnabled: false,
    loyaltyPhysicalEarnEnabled: false,
    loyaltyDigitalEarnEnabled: false,
    loyaltyReversalsEnabled: false,
    loyaltyRedemptionsEnabled: false,
    legacyPointsAdaptersEnabled: true,
  },
};

async function activatePhase(): Promise<void> {
  const phaseArg = process.argv.find((a) => a.startsWith("--phase="));
  const dryRun = process.argv.includes("--dry-run");
  const phase = (phaseArg?.slice("--phase=".length) ?? "A") as LoyaltyPhase;

  if (!PHASE_FLAGS[phase]) {
    console.error(`Fase invalida: ${phase}. Use A|B|C|D|E|rollback`);
    process.exit(1);
  }

  const flags = {
    ...PHASE_FLAGS[phase],
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    activatedPhase: phase,
    seededBy: "activate-loyalty-flags.ts",
  };

  console.log(`Fase ${phase}:`, JSON.stringify(flags, null, 2));

  if (dryRun) {
    console.log("DRY-RUN: no se escribio nada.");
    return;
  }

  await firestoreApp.collection("configuracion").doc("loyalty").set(flags, { merge: true });
  console.log(`Fase ${phase} activada en configuracion/loyalty`);
}

activatePhase().catch((error) => {
  console.error("Error activando fase:", error);
  process.exit(1);
});
