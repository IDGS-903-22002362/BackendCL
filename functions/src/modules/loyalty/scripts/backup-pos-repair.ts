/**
 * Respaldo lógico PREVIO a la reparación POS → ledger.
 *
 * Sólo lee. Toma la lista de socios del reporte de dry-run y guarda, para cada
 * uno, la fotografía completa de lo que la reparación podría tocar:
 * `usuariosApp`, `loyalty_wallets`, su ledger actual, los movimientos
 * `pos_acc_*`, las entradas del índice externo y las operaciones que el repair
 * pretende crear.
 *
 * El archivo lleva datos personales de socios: se escribe en `backups/`, que
 * está en .gitignore, y no debe versionarse ni salir del equipo.
 *
 * Uso:
 *   node lib/modules/loyalty/scripts/backup-pos-repair.js
 *   node lib/modules/loyalty/scripts/backup-pos-repair.js --report=<ruta.json>
 */
import * as fs from "fs";
import * as path from "path";
import { firestoreApp } from "../../../config/app.firebase";
import { LOYALTY_COLLECTIONS } from "../constants/loyalty.constants";
import conversionRulesService from "../services/conversion-rules.service";
import {
  buildPosSaleExternalTxnId,
  POS_SALE_CHANNEL,
} from "../utils/pos-sale.util";

export const BACKUP_SCRIPT_VERSION = "pos-repair-backup@1.0.0";

const USUARIOS = "usuariosApp";
const MOVIMIENTOS = "movimientos_puntos";

interface ReportUser {
  uid: string;
  ventaIdsFaltantes?: string[];
  puntosPosFaltantes?: number;
}

function parseArgs(argv: string[]): { reportPath: string; outDir: string } {
  const reportArg = argv.find((a) => a.startsWith("--report="));
  const outArg = argv.find((a) => a.startsWith("--out-dir="));
  return {
    reportPath: reportArg
      ? reportArg.slice("--report=".length)
      : path.resolve(process.cwd(), "reports", "pos-ledger-repair.json"),
    outDir: outArg
      ? outArg.slice("--out-dir=".length)
      : path.resolve(process.cwd(), "backups"),
  };
}

/** Serializa Timestamps y referencias a algo que sobreviva a JSON. */
function plain(value: unknown): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (typeof value !== "object") return value;
  const anyValue = value as { toDate?: () => Date };
  if (typeof anyValue.toDate === "function") {
    return anyValue.toDate().toISOString();
  }
  if (Array.isArray(value)) return value.map(plain);
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([k, v]) => [
      k,
      plain(v),
    ]),
  );
}

async function main(): Promise<void> {
  const { reportPath, outDir } = parseArgs(process.argv.slice(2));

  if (!fs.existsSync(reportPath)) {
    throw new Error(
      `No existe el reporte de dry-run en ${reportPath}. Ejecuta primero repair:pos-ledger.`,
    );
  }

  const report = JSON.parse(fs.readFileSync(reportPath, "utf8")) as {
    summary?: Record<string, unknown>;
    usuarios?: ReportUser[];
  };
  const usuarios = report.usuarios ?? [];
  console.log(`Socios a respaldar: ${usuarios.length}`);

  const snapshot = {
    script: BACKUP_SCRIPT_VERSION,
    generatedAt: new Date().toISOString(),
    sourceReport: path.resolve(reportPath),
    resumenDryRun: report.summary ?? null,
    socios: [] as Array<Record<string, unknown>>,
  };

  let procesados = 0;

  for (const usuario of usuarios) {
    const uid = usuario.uid;

    const [userSnap, walletSnap, movsSnap, ledgerSnap] = await Promise.all([
      firestoreApp.collection(USUARIOS).doc(uid).get(),
      firestoreApp.collection(LOYALTY_COLLECTIONS.WALLETS).doc(uid).get(),
      firestoreApp
        .collection(USUARIOS)
        .doc(uid)
        .collection(MOVIMIENTOS)
        .get(),
      firestoreApp
        .collection(LOYALTY_COLLECTIONS.TRANSACTIONS)
        .where("memberId", "==", uid)
        .get(),
    ]);

    const ventaIds = usuario.ventaIdsFaltantes ?? [];
    const indices: Array<Record<string, unknown>> = [];
    for (const ventaId of ventaIds) {
      const extKey = conversionRulesService.buildExternalTxnKey(
        POS_SALE_CHANNEL,
        buildPosSaleExternalTxnId(ventaId),
      );
      const extSnap = await firestoreApp
        .collection(LOYALTY_COLLECTIONS.EXTERNAL_TXN_INDEX)
        .doc(extKey)
        .get();
      indices.push({
        ventaId,
        externalKey: extKey,
        existe: extSnap.exists,
        data: extSnap.exists ? plain(extSnap.data()) : null,
      });
    }

    snapshot.socios.push({
      uid,
      usuariosApp: userSnap.exists ? plain(userSnap.data()) : null,
      loyaltyWallet: walletSnap.exists ? plain(walletSnap.data()) : null,
      movimientosPuntos: movsSnap.docs.map((d) => ({
        id: d.id,
        ...(plain(d.data()) as Record<string, unknown>),
      })),
      ledgerActual: ledgerSnap.docs.map((d) => ({
        id: d.id,
        ...(plain(d.data()) as Record<string, unknown>),
      })),
      indicesExternos: indices,
      operacionesQueElRepairCrearia: {
        ventaIds,
        puntos: usuario.puntosPosFaltantes ?? 0,
      },
    });

    procesados += 1;
    if (procesados % 25 === 0) {
      console.log(`  ${procesados}/${usuarios.length}`);
    }
  }

  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const target = path.join(outDir, `pre-repair-${stamp}.json`);
  fs.writeFileSync(target, JSON.stringify(snapshot, null, 2), "utf8");

  const bytes = fs.statSync(target).size;
  console.log(`\nRespaldo PRE escrito: ${target}`);
  console.log(`Socios: ${snapshot.socios.length} | Tamaño: ${bytes} bytes`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error("Error generando respaldo:", error);
    process.exit(1);
  });
}
