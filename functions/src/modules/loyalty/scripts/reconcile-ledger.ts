import * as fs from "fs";
import * as path from "path";
import { firestoreApp } from "../../../config/app.firebase";
import { LOYALTY_COLLECTIONS } from "../constants/loyalty.constants";
import {
  LoyaltyTransactionStatus,
} from "../models/loyalty.enums";

const USUARIOS_COLLECTION = "usuariosApp";

type MemberDiff = {
  memberId: string;
  puntosActuales: number;
  walletAvailable: number | null;
  walletHeld: number | null;
  walletPending: number | null;
  ledgerReconstructed: number;
  walletMissing: boolean;
  critical: boolean;
  notes: string[];
};

type ReconcileReport = {
  generatedAt: string;
  dryRun: boolean;
  usersAnalyzed: number;
  usersWithoutPuntosActuales: number;
  walletsExisting: number;
  walletsMissing: number;
  criticalDifferences: number;
  warnings: number;
  duplicateExternalTransactionIds: string[];
  memberDiffs: MemberDiff[];
  legacyBalanceTotal: number;
  walletBalanceTotal: number;
  ledgerBalanceTotal: number;
  errors: string[];
};

function parseReportPath(): string | null {
  const arg = process.argv.find((a) => a.startsWith("--report="));
  if (!arg) {
    return null;
  }
  return arg.slice("--report=".length);
}

function getLatestLedgerBalance(
  transactions: Array<{ data: () => Record<string, unknown> }>,
): number | null {
  let latestBalance: number | null = null;
  let latestTs = -1;

  for (const doc of transactions) {
    const data = doc.data();
    if (data.status !== LoyaltyTransactionStatus.CONFIRMED) {
      continue;
    }
    const createdAt = data.createdAt as { toMillis?: () => number } | undefined;
    const ts =
      typeof createdAt?.toMillis === "function"
        ? createdAt.toMillis()
        : Number(data.createdAt ?? 0);
    const balanceAfter = Math.trunc(Number(data.balanceAfter ?? NaN));
    if (!Number.isFinite(balanceAfter)) {
      continue;
    }
    if (ts >= latestTs) {
      latestTs = ts;
      latestBalance = balanceAfter;
    }
  }

  return latestBalance;
}

async function findDuplicateExternalIds(): Promise<string[]> {
  const snap = await firestoreApp
    .collection(LOYALTY_COLLECTIONS.TRANSACTIONS)
    .where("externalTransactionId", "!=", "")
    .get();

  const counts = new Map<string, number>();
  for (const doc of snap.docs) {
    const extId = String(doc.data().externalTransactionId ?? "").trim();
    if (!extId || extId.startsWith("legacy-migration:")) {
      continue;
    }
    counts.set(extId, (counts.get(extId) ?? 0) + 1);
  }

  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([id]) => id);
}

async function reconcileLedger(): Promise<void> {
  const reportPath = parseReportPath();
  const report: ReconcileReport = {
    generatedAt: new Date().toISOString(),
    dryRun: true,
    usersAnalyzed: 0,
    usersWithoutPuntosActuales: 0,
    walletsExisting: 0,
    walletsMissing: 0,
    criticalDifferences: 0,
    warnings: 0,
    duplicateExternalTransactionIds: [],
    memberDiffs: [],
    legacyBalanceTotal: 0,
    walletBalanceTotal: 0,
    ledgerBalanceTotal: 0,
    errors: [],
  };

  try {
    report.duplicateExternalTransactionIds = await findDuplicateExternalIds();

    const usersSnap = await firestoreApp.collection(USUARIOS_COLLECTION).get();
    report.usersAnalyzed = usersSnap.size;

    for (const userDoc of usersSnap.docs) {
      const memberId = userDoc.id;
      const userData = userDoc.data();
      const puntosActuales = Math.max(
        0,
        Math.trunc(Number(userData.puntosActuales ?? 0)),
      );

      if (userData.puntosActuales === undefined || userData.puntosActuales === null) {
        report.usersWithoutPuntosActuales += 1;
      }

      report.legacyBalanceTotal += puntosActuales;

      const walletSnap = await firestoreApp
        .collection(LOYALTY_COLLECTIONS.WALLETS)
        .doc(memberId)
        .get();

      const walletMissing = !walletSnap.exists;
      let walletAvailable: number | null = null;
      let walletHeld: number | null = null;
      let walletPending: number | null = null;

      if (walletSnap.exists) {
        report.walletsExisting += 1;
        const wallet = walletSnap.data()!;
        walletAvailable = Math.trunc(Number(wallet.availablePoints ?? 0));
        walletHeld = Math.trunc(Number(wallet.heldPoints ?? 0));
        walletPending = Math.trunc(Number(wallet.pendingPoints ?? 0));
        report.walletBalanceTotal += walletAvailable;
      } else {
        report.walletsMissing += 1;
      }

      const txSnap = await firestoreApp
        .collection(LOYALTY_COLLECTIONS.TRANSACTIONS)
        .where("memberId", "==", memberId)
        .get();

      const ledgerBalance = getLatestLedgerBalance(txSnap.docs);
      const ledgerReconstructed = ledgerBalance ?? 0;
      if (ledgerBalance !== null) {
        report.ledgerBalanceTotal += ledgerBalance;
      }

      const notes: string[] = [];
      let critical = false;

      if (walletMissing && puntosActuales > 0) {
        notes.push("wallet_missing_with_balance");
        critical = true;
      }

      if (walletAvailable !== null && walletAvailable !== puntosActuales) {
        notes.push(`wallet_vs_puntosActuales:${walletAvailable}!=${puntosActuales}`);
        critical = true;
      }

      if (
        walletAvailable !== null &&
        ledgerBalance !== null &&
        walletAvailable !== ledgerBalance
      ) {
        if (walletAvailable === puntosActuales) {
          notes.push(
            `legacy_history_incomplete:ledger=${ledgerBalance},wallet=${walletAvailable}`,
          );
        } else {
          notes.push(
            `wallet_vs_ledger:${walletAvailable}!=${ledgerBalance}`,
          );
          critical = true;
        }
      }

      if (notes.length > 0) {
        if (critical) {
          report.criticalDifferences += 1;
        } else {
          report.warnings += 1;
        }
        report.memberDiffs.push({
          memberId,
          puntosActuales,
          walletAvailable,
          walletHeld,
          walletPending,
          ledgerReconstructed,
          walletMissing,
          critical,
          notes,
        });
      }
    }
  } catch (error) {
    report.errors.push(error instanceof Error ? error.message : String(error));
  }

  const output = JSON.stringify(report, null, 2);
  console.log(output);

  if (reportPath) {
    const resolved = path.resolve(reportPath);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, output, "utf8");
    console.log(`Reporte escrito en: ${resolved}`);
  }

  console.log(
    `\nResumen: ${report.usersAnalyzed} usuarios, ${report.criticalDifferences} diferencias criticas, ${report.warnings} advertencias, ${report.duplicateExternalTransactionIds.length} externalTransactionId duplicados`,
  );

  if (report.errors.length > 0 || report.criticalDifferences > 0) {
    process.exit(1);
  }
}

reconcileLedger().catch((error) => {
  console.error("Error en conciliacion ledger:", error);
  process.exit(1);
});
