// scripts/fix-user.ts
import { admin } from "../src/config/firebase.admin"; // inicializa app default
import "../src/config/firebase.ts"; // inicializa TIENDA_APP (solo necesitamos el side-effect)

const EMAIL_PROBLEMA = "laguaridadelleon1944@gmail.com";

async function diagnosticarYBorrar() {
  // --- Intento 1: app default ---
  try {
    const userRecord = await admin.auth().getUserByEmail(EMAIL_PROBLEMA);

    console.log("✅ Usuario encontrado en Auth (app DEFAULT):");
    console.log("UID:", userRecord.uid);
    console.log("Email:", userRecord.email);
    console.log("Creado:", userRecord.metadata.creationTime);
    console.log("Último login:", userRecord.metadata.lastSignInTime);
    console.log("Proveedores:", userRecord.providerData.map((p: any) => p.providerId));
    console.log("Disabled:", userRecord.disabled);

    const db = admin.firestore();
    const doc = await db.collection("usuarios").doc(userRecord.uid).get();
    console.log("¿Existe doc en Firestore con ese UID?:", doc.exists);

    // Descomenta solo cuando confirmes que es seguro:
    // await admin.auth().deleteUser(userRecord.uid);
    // console.log("🗑️ Usuario eliminado de Auth (DEFAULT).");

    return; // ya lo encontramos, no seguimos buscando

  } catch (error: any) {
    if (error.code === "auth/user-not-found") {
      console.log("❌ No se encontró en la app DEFAULT. Probando con TIENDA_APP...");
    } else {
      console.error("Error inesperado (DEFAULT):", error.code, error.message);
      return;
    }
  }

  // --- Intento 2: TIENDA_APP ---
  try {
    const tiendaApp = admin.apps.find((app: any) => app?.name === "TIENDA_APP");

    if (!tiendaApp) {
      console.log("⚠️ TIENDA_APP no está inicializada. Revisa el import de firebase.ts");
      return;
    }

    const userRecord2 = await admin.auth(tiendaApp).getUserByEmail(EMAIL_PROBLEMA);

    console.log("✅ Usuario encontrado en Auth (TIENDA_APP):");
    console.log("UID:", userRecord2.uid);
    console.log("Email:", userRecord2.email);
    console.log("Creado:", userRecord2.metadata.creationTime);
    console.log("Último login:", userRecord2.metadata.lastSignInTime);
    console.log("Disabled:", userRecord2.disabled);

    // Descomenta solo cuando confirmes que es seguro:
    await admin.auth(tiendaApp).deleteUser(userRecord2.uid);
    console.log("🗑️ Usuario eliminado de Auth (TIENDA_APP).");

  } catch (e: any) {
    console.error("Tampoco está en TIENDA_APP:", e.code, e.message);
  }
}

diagnosticarYBorrar();