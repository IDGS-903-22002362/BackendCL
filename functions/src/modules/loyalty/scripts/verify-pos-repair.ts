/**
 * Verificación POST-REPAIR: comprueba la cadena ledger → wallet → espejo
 * legacy para los socios tocados por la reparación POS y genera el reporte
 * comparativo PRE vs POST.
 *
 * Comprobaciones por socio:
 *  - la suma de todas las transacciones del ledger cuadra con
 *    `loyalty_wallets.availablePoints`;
 *  - el encadenado `balanceBefore`/`balanceAfter` no tiene huecos;
 *  - `usuariosApp.puntosActuales` refleja el wallet.
 *
 * Sólo lee, salvo que se pase `--fix-mirror`, que reescribe exclusivamente el
 * espejo legacy a partir del wallet ya validado contra el ledger. Nunca toca
 * el wallet ni el ledger: si el desajuste estuviera ahí, se reporta para
 * revisión manual en vez de "corregirse" a ciegas.
 *
 * Uso:
 *   node lib/modules/loyalty/scripts/verify-pos-repair.js
 *   node lib/modules/loyalty/scripts/verify-pos-repair.js --fix-mirror
 */
import * as fs from "fs";
import * as path from "path";
import { Timestamp } from "firebase-admin/firestore";
import { firestoreApp } from "../../../config/app.firebase";
import { LOYALTY_COLLECTIONS } from "../constants/loyalty.constants";
import conversionRulesService from "../services/conversion-rules.service";

export const VERIFY_SCRIPT_VERSION = "pos-repair-verify@1.0.0";

const USUARIOS = "usuariosApp";

interface Options {
  fixMirror: boolean;
  backupPath?: string;
  outDir: string;
}

function parseOptions(argv: string[]): Options {
  const get = (name: string) =>
    argv.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
  return {
    fixMirror: argv.includes("--fix-mirror"),
    backupPath: get("backup"),
    outDir: get("out-dir") ?? path.resolve(process.cwd(), "reports"),
  };
}

function latestBackup(explicit?: string): { file: string; data: any } {
  const file =
    explicit ??
    (() => {
      const dir = path.resolve(process.cwd(), "backups");
      const candidates = fs
        .readdirSync(dir)
        .filter((f) => f.startsWith("pre-repair-"))
        .sort();
      if (!candidates.length) {
        throw new Error("No hay respaldo PRE en backups/");
      }
      return path.join(dir, candidates[candidates.length - 1]);
    })();

  return { file, data: JSON.parse(fs.readFileSync(file, "utf8")) };
}

export interface MemberVerification {
  uid: string;
  saldoAnteriorWallet: number | null;
  saldoAnteriorLegacy: number | null;
  saldoPosteriorWallet: number | null;
  saldoPosteriorLegacy: number | null;
  sumaLedger: number;
  transaccionesLedger: number;
  transaccionesReparadas: number;
  puntosReparados: number;
  ledgerCuadraConWallet: boolean;
  encadenadoCorrecto: boolean;
  espejoCuadraConWallet: boolean;
  espejoCorregido: boolean;
  problemas: string[];
}

export async function verifyMember(
  db: FirebaseFirestore.Firestore,
  uid: string,
  previo: { wallet: number | null; legacy: number | null },
  fixMirror: boolean,
): Promise<MemberVerification> {
  const [userSnap, walletSnap, ledgerSnap] = await Promise.all([
    db.collection(USUARIOS).doc(uid).get(),
    db.collection(LOYALTY_COLLECTIONS.WALLETS).doc(uid).get(),
    db
      .collection(LOYALTY_COLLECTIONS.TRANSACTIONS)
      .where("memberId", "==", uid)
      .get(),
  ]);

  const problemas: string[] = [];
  const wallet = walletSnap.exists ? walletSnap.data() : undefined;
  const walletPoints = wallet ? Number(wallet.availablePoints ?? 0) : null;
  const legacyPoints = userSnap.exists
    ? Number(userSnap.data()?.puntosActuales ?? 0)
    : null;

  const txns = ledgerSnap.docs
    .map((d) => d.data())
    .sort(
      (a, b) =>
        ((a.createdAt as Timestamp)?.toMillis?.() ?? 0) -
        ((b.createdAt as Timestamp)?.toMillis?.() ?? 0),
    );

  const sumaLedger = txns.reduce((acc, t) => acc + Number(t.points ?? 0), 0);
  const reparadas = txns.filter(
    (t) => (t.metadata as Record<string, unknown> | undefined)?.repair === true,
  );
  const puntosReparados = reparadas.reduce(
    (acc, t) => acc + Number(t.points ?? 0),
    0,
  );

  // Encadenado: cada transacción debe partir del saldo que dejó la anterior.
  let encadenadoCorrecto = true;
  let esperado = 0;
  for (const t of txns) {
    if (Number(t.balanceBefore ?? 0) !== esperado) {
      encadenadoCorrecto = false;
      break;
    }
    esperado = Number(t.balanceAfter ?? 0);
  }

  const ledgerCuadraConWallet = walletPoints !== null && sumaLedger === walletPoints;
  if (!ledgerCuadraConWallet) {
    problemas.push(
      `El ledger suma ${sumaLedger} pero el wallet dice ${walletPoints}`,
    );
  }
  if (!encadenadoCorrecto) {
    problemas.push("El encadenado balanceBefore/balanceAfter tiene huecos");
  }

  let espejoCuadraConWallet = walletPoints !== null && legacyPoints === walletPoints;
  let espejoCorregido = false;

  if (!espejoCuadraConWallet) {
    problemas.push(
      `El espejo legacy (${legacyPoints}) no refleja el wallet (${walletPoints})`,
    );

    // Sólo se corrige el espejo si el wallet ya quedó validado contra el
    // ledger. Si el desajuste está en el wallet, tocarlo aquí escondería el
    // problema real.
    if (fixMirror && ledgerCuadraConWallet && walletPoints !== null) {
      const level = conversionRulesService.calculateLevel(walletPoints);
      await db
        .collection(USUARIOS)
        .doc(uid)
        .set(
          {
            puntosActuales: walletPoints,
            nivel: level,
            updatedAt: Timestamp.now(),
          },
          { merge: true },
        );
      espejoCorregido = true;
      espejoCuadraConWallet = true;
    }
  }

  return {
    uid,
    saldoAnteriorWallet: previo.wallet,
    saldoAnteriorLegacy: previo.legacy,
    saldoPosteriorWallet: walletPoints,
    saldoPosteriorLegacy: espejoCorregido ? walletPoints : legacyPoints,
    sumaLedger,
    transaccionesLedger: txns.length,
    transaccionesReparadas: reparadas.length,
    puntosReparados,
    ledgerCuadraConWallet,
    encadenadoCorrecto,
    espejoCuadraConWallet,
    espejoCorregido,
    problemas,
  };
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const { file, data } = latestBackup(options.backupPath);

  console.log(`\n=== ${VERIFY_SCRIPT_VERSION} ===`);
  console.log(`Respaldo PRE: ${file}`);
  console.log(
    options.fixMirror
      ? "Modo: verificar + resincronizar espejo legacy"
      : "Modo: sólo verificar (usa --fix-mirror para resincronizar el espejo)",
  );

  const socios: Array<{ uid: string; wallet: number | null; legacy: number | null }> =
    (data.socios ?? []).map((s: any) => ({
      uid: s.uid,
      wallet: s.loyaltyWallet?.availablePoints ?? null,
      legacy: s.usuariosApp?.puntosActuales ?? null,
    }));

  const resultados: MemberVerification[] = [];
  for (const socio of socios) {
    resultados.push(
      await verifyMember(
        firestoreApp,
        socio.uid,
        { wallet: socio.wallet, legacy: socio.legacy },
        options.fixMirror,
      ),
    );
    if (resultados.length % 25 === 0) {
      console.log(`  ${resultados.length}/${socios.length}`);
    }
  }

  const resumen = {
    script: VERIFY_SCRIPT_VERSION,
    generatedAt: new Date().toISOString(),
    respaldoPre: file,
    fixMirror: options.fixMirror,
    sociosVerificados: resultados.length,
    sociosReparados: resultados.filter((r) => r.transaccionesReparadas > 0).length,
    transaccionesReparadas: resultados.reduce(
      (a, r) => a + r.transaccionesReparadas,
      0,
    ),
    puntosIncorporados: resultados.reduce((a, r) => a + r.puntosReparados, 0),
    sociosSinCambios: resultados.filter((r) => r.transaccionesReparadas === 0)
      .length,
    ledgerCuadraConWallet: resultados.filter((r) => r.ledgerCuadraConWallet)
      .length,
    encadenadoCorrecto: resultados.filter((r) => r.encadenadoCorrecto).length,
    espejoCuadraConWallet: resultados.filter((r) => r.espejoCuadraConWallet)
      .length,
    espejosCorregidos: resultados.filter((r) => r.espejoCorregido).length,
    sociosConProblemas: resultados.filter(
      (r) => r.problemas.length > 0 && !r.espejoCorregido,
    ).length,
  };

  console.log("\n--- RESUMEN POST-REPAIR ---");
  console.log(JSON.stringify(resumen, null, 2));

  const pendientes = resultados.filter(
    (r) => !r.ledgerCuadraConWallet || !r.encadenadoCorrecto || !r.espejoCuadraConWallet,
  );
  if (pendientes.length) {
    console.log("\nSocios que siguen con problemas:");
    pendientes.forEach((r) =>
      console.log(` - ${r.uid}: ${r.problemas.join("; ")}`),
    );
  } else {
    console.log("\nTodos los socios verificados: ledger = wallet = espejo.");
  }

  fs.mkdirSync(options.outDir, { recursive: true });
  const target = path.join(options.outDir, "pos-repair-post.json");
  fs.writeFileSync(
    target,
    JSON.stringify({ resumen, socios: resultados }, null, 2),
    "utf8",
  );
  console.log(`\nReporte POST: ${target}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error("Error verificando:", error);
    process.exit(1);
  });
}
