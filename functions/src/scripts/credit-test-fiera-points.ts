import "../config/env.bootstrap";
import { Timestamp } from "firebase-admin/firestore";
import { firestoreTienda } from "../config/firebase";
import { firestoreApp, authAppOficial } from "../config/app.firebase";
import { LoyaltyActorType } from "../modules/loyalty/models/loyalty.enums";
import loyaltyEngineService from "../modules/loyalty/services/loyalty-engine.service";
import { LOYALTY_DEFAULTS } from "../modules/loyalty/constants/loyalty.constants";

const EMAIL = "ingluisrosascontacto@gmail.com";
const POINTS_TO_CREDIT = 100_000;
const POINT_VALUE_PESOS = LOYALTY_DEFAULTS.POINT_REDEMPTION_VALUE_PESOS;

async function findMemberIdByEmail(email: string): Promise<string> {
  const normalized = email.trim().toLowerCase();
  const users = firestoreApp.collection("usuariosApp");

  for (const field of ["email", "correo", "correoElectronico"] as const) {
    const snap = await users.where(field, "==", normalized).limit(1).get();
    if (!snap.empty) {
      return snap.docs[0].id;
    }
  }

  const upperSnap = await users.where("email", "==", email.trim()).limit(1).get();
  if (!upperSnap.empty) {
    return upperSnap.docs[0].id;
  }

  try {
    const authUser = await authAppOficial.getUserByEmail(normalized);
    const userDoc = await users.doc(authUser.uid).get();
    if (userDoc.exists) {
      return authUser.uid;
    }
    throw new Error(
      `Auth tiene ${normalized} (${authUser.uid}) pero no existe usuariosApp/${authUser.uid}`,
    );
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Auth tiene")) {
      throw error;
    }
  }

  throw new Error(`No se encontró el usuario ${normalized} en Auth ni en usuariosApp`);
}

async function main(): Promise<void> {
  const configRef = firestoreTienda.collection("configuracion").doc("puntos");
  const configSnap = await configRef.get();
  const previousValue = configSnap.exists
    ? Number(configSnap.data()?.valorPuntoEnPesos)
    : null;

  await configRef.set(
    {
      valorPuntoEnPesos: POINT_VALUE_PESOS,
      activo: true,
      actualizadoAt: Timestamp.now(),
    },
    { merge: true },
  );

  console.log(
    `Configuración de canje: valorPuntoEnPesos ${previousValue} → ${POINT_VALUE_PESOS} (1 punto = $0.10)`,
  );

  const memberId = await findMemberIdByEmail(EMAIL);
  const walletBefore = await loyaltyEngineService.getWallet(memberId);
  console.log(
    `Usuario ${EMAIL} (${memberId}) saldo actual: ${walletBefore.availablePoints}`,
  );

  const txn = await loyaltyEngineService.applyAdjustment({
    memberId,
    points: POINTS_TO_CREDIT,
    reasonCode: "QA_TEST_CREDIT",
    description: "Carga de prueba de 100000 FieraPuntos para checkout",
    externalReference: `qa:fiera-points:${memberId}:100000`,
    idempotencyKey: `qa:fiera-points:${memberId}:100000:2026-09-02`,
    actor: {
      actorType: LoyaltyActorType.SERVICE,
      actorId: "qa-credit-script",
      roles: ["SERVICE"],
      permissions: [],
    },
  });

  const walletAfter = await loyaltyEngineService.getWallet(memberId);
  console.log(
    `Ajuste ${txn.transactionId}: +${POINTS_TO_CREDIT}. Saldo nuevo: ${walletAfter.availablePoints}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("No se pudo actualizar puntos de prueba:", error);
    process.exit(1);
  });
