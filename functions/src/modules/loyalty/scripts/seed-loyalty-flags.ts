import { firestoreApp } from "../../../config/app.firebase";
import { admin } from "../../../config/firebase.admin";

const INITIAL_FLAGS = {
  loyaltyV1ReadsEnabled: false,
  loyaltyV1WritesEnabled: false,
  loyaltyPhysicalEarnEnabled: false,
  loyaltyDigitalEarnEnabled: false,
  loyaltyRedemptionsEnabled: false,
  loyaltyReversalsEnabled: false,
  legacyPointsAdaptersEnabled: true,
  updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  seededBy: "seed-loyalty-flags.ts",
};

async function seedLoyaltyFlags(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const ref = firestoreApp.collection("configuracion").doc("loyalty");
  const existing = await ref.get();

  console.log("Proyecto Firestore app-oficial (via firestoreApp)");
  console.log("Documento: configuracion/loyalty");
  console.log("Flags a escribir:", JSON.stringify(INITIAL_FLAGS, null, 2));

  if (existing.exists) {
    const data = existing.data() ?? {};
    console.log("Documento existente:", JSON.stringify(data, null, 2));
  } else {
    console.log("Documento no existe; se creara.");
  }

  if (dryRun) {
    console.log("DRY-RUN: no se escribio nada.");
    return;
  }

  await ref.set(INITIAL_FLAGS, { merge: true });
  console.log("Flags de loyalty escritos correctamente.");
}

seedLoyaltyFlags().catch((error) => {
  console.error("Error al escribir flags:", error);
  process.exit(1);
});
