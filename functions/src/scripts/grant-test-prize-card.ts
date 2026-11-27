/**
 * Asigna o retira una carta coleccionable de prueba, solo fuera de
 * producción.
 *
 *   npm run cards:test-grant -- --email persona@ejemplo.com --diseno globo
 *   npm run cards:test-grant -- --uid <uid> --diseno globo
 *   npm run cards:test-grant -- --email persona@ejemplo.com --diseno globo --revoke
 *   npm run cards:test-grant -- --email persona@ejemplo.com --list
 *
 * El correo solo sirve para encontrar el uid en usuariosApp del mismo
 * Firestore; la carta se guarda con el uid. El script se niega a escribir en
 * Firestore de producción: exige el emulador (el npm script define
 * FIRESTORE_EMULATOR_HOST) o un proyecto que no sea productivo.
 */
import "../config/env.bootstrap";
import cartasPruebaService, {
  DISENOS_CARTA_PRUEBA,
  isTestCardsFirestore,
} from "../services/cartas-prueba.service";
import { parseGrantTestCardArgs } from "./grant-test-prize-card.args";

async function main(): Promise<void> {
  if (!isTestCardsFirestore()) {
    throw new Error(
      "Este script solo escribe en el emulador de Firestore o en un proyecto no productivo. " +
        "Arranca el emulador y ejecútalo con npm run cards:test-grant.",
    );
  }

  const args = parseGrantTestCardArgs(process.argv.slice(2));
  const uid = args.uid ?? (await cartasPruebaService.findUidByEmail(args.email!));
  const target = process.env.FIRESTORE_EMULATOR_HOST
    ? `emulador ${process.env.FIRESTORE_EMULATOR_HOST}`
    : `proyecto ${process.env.APP_OFICIAL_PROJECT_ID}`;

  if (args.list) {
    const cartas = await cartasPruebaService.listCartasPrueba(uid);
    console.log(JSON.stringify({ target, uid, cartas }, null, 2));
    return;
  }

  if (args.revoke) {
    const removed = await cartasPruebaService.revokeCartaPrueba({
      uid,
      diseno: args.diseno,
    });
    console.log(
      JSON.stringify({ target, uid, diseno: args.diseno, removed }, null, 2),
    );
    return;
  }

  const { carta, created } = await cartasPruebaService.grantCartaPrueba({
    uid,
    diseno: args.diseno,
  });
  console.log(
    JSON.stringify(
      {
        target,
        uid,
        created,
        carta,
        disenosDisponibles: Object.keys(DISENOS_CARTA_PRUEBA),
      },
      null,
      2,
    ),
  );
}

main().catch((error: unknown) => {
  console.error(
    "grant_test_prize_card_failed",
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
