import * as fs from "fs";
import * as path from "path";
import { firestoreApp } from "../../../config/app.firebase";
import { admin } from "../../../config/firebase.admin";
import { LOYALTY_COLLECTIONS } from "../constants/loyalty.constants";
import {
  LoyaltyActorType,
  LoyaltyChannel,
  LoyaltyTransactionStatus,
  LoyaltyTransactionType,
} from "../models/loyalty.enums";
import { LoyaltyTransaction } from "../models/loyalty.types";
import conversionRulesService from "../services/conversion-rules.service";
import { TipoMovimientoPuntos } from "../../../models/usuario.model";

const USUARIOS_COLLECTION = "usuariosApp";
const MOVIMIENTOS_SUBCOLLECTION = "movimientos_puntos";
const DRY_RUN = process.argv.includes("--dry-run");
const BATCH_LIMIT = 400;

type MigrateReport = {
  generatedAt: string;
  dryRun: boolean;
  usersAnalyzed: number;
  usersWithoutPuntosActuales: number;
  walletsExisting: number;
  walletsToCreate: number;
  legacyMovementsFound: number;
  movementsToMigrate: number;
  movementsSkippedExisting: number;
  legacyBalanceTotal: number;
  errors: string[];
};

function parseReportPath(): string | null {
  const arg = process.argv.find((a) => a.startsWith("--report="));
  if (!arg) {
    return null;
  }
  return arg.slice("--report=".length);
}

function legacyTransactionDocId(memberId: string, movementId: string): string {
  return `legacy_${memberId}_${movementId}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 150);
}

function mapLegacyTipo(tipo: string): LoyaltyTransactionType {
  switch (tipo) {
    case TipoMovimientoPuntos.CANJE:
      return LoyaltyTransactionType.REDEMPTION_CONFIRM;
    case TipoMovimientoPuntos.AJUSTE:
      return LoyaltyTransactionType.ADJUSTMENT;
    case TipoMovimientoPuntos.EXPIRACION:
      return LoyaltyTransactionType.EXPIRATION;
    case TipoMovimientoPuntos.BONIFICACION:
      return LoyaltyTransactionType.BONUS;
    case TipoMovimientoPuntos.DEVOLUCION:
      return LoyaltyTransactionType.REVERSAL;
    case TipoMovimientoPuntos.ACUMULACION:
    default:
      return LoyaltyTransactionType.EARN;
  }
}

function mapLegacyChannel(origen: string | undefined): LoyaltyChannel {
  switch (origen) {
    case "tienda":
      return LoyaltyChannel.ECOMMERCE;
    case "admin":
      return LoyaltyChannel.ADMIN;
    case "promo":
      return LoyaltyChannel.SYSTEM;
    default:
      return LoyaltyChannel.STORE;
  }
}

async function migrateLedger(): Promise<void> {
  const reportPath = parseReportPath();
  const report: MigrateReport = {
    generatedAt: new Date().toISOString(),
    dryRun: DRY_RUN,
    usersAnalyzed: 0,
    usersWithoutPuntosActuales: 0,
    walletsExisting: 0,
    walletsToCreate: 0,
    legacyMovementsFound: 0,
    movementsToMigrate: 0,
    movementsSkippedExisting: 0,
    legacyBalanceTotal: 0,
    errors: [],
  };

  console.log(
    `\nMigracion ledger legacy -> loyalty (${DRY_RUN ? "DRY-RUN" : "EJECUCION"})`,
  );

  const usersSnap = await firestoreApp.collection(USUARIOS_COLLECTION).get();
  report.usersAnalyzed = usersSnap.size;

  let batch = firestoreApp.batch();
  let batchOps = 0;

  const commitBatch = async (): Promise<void> => {
    if (DRY_RUN || batchOps === 0) {
      return;
    }
    await batch.commit();
    batch = firestoreApp.batch();
    batchOps = 0;
  };

  for (const userDoc of usersSnap.docs) {
    const memberId = userDoc.id;
    const userData = userDoc.data();

    if (userData.puntosActuales === undefined || userData.puntosActuales === null) {
      report.usersWithoutPuntosActuales += 1;
    }

    const availablePoints = Math.max(0, Math.trunc(Number(userData.puntosActuales ?? 0)));
    report.legacyBalanceTotal += availablePoints;

    const level = conversionRulesService.calculateLevel(availablePoints);
    const walletRef = firestoreApp.collection(LOYALTY_COLLECTIONS.WALLETS).doc(memberId);
    const walletSnap = await walletRef.get();

    if (walletSnap.exists) {
      report.walletsExisting += 1;
    } else {
      report.walletsToCreate += 1;
      if (!DRY_RUN) {
        batch.set(walletRef, {
          memberId,
          availablePoints,
          heldPoints: 0,
          pendingPoints: 0,
          lifetimeEarnedPoints: availablePoints,
          lifetimeRedeemedPoints: 0,
          level,
          nextExpirationAt: userData.historialPuntos?.proximaExpiracionProgramada,
          createdAt: admin.firestore.Timestamp.now(),
          updatedAt: admin.firestore.Timestamp.now(),
          migratedFromLegacy: true,
        });
        batchOps += 1;
        if (batchOps >= BATCH_LIMIT) {
          await commitBatch();
        }
      }
    }

    const movementsSnap = await userDoc.ref
      .collection(MOVIMIENTOS_SUBCOLLECTION)
      .orderBy("createdAt", "asc")
      .get();

    report.legacyMovementsFound += movementsSnap.size;

    for (const movementDoc of movementsSnap.docs) {
      const movement = movementDoc.data();
      const transactionId = legacyTransactionDocId(memberId, movementDoc.id);
      const existing = await firestoreApp
        .collection(LOYALTY_COLLECTIONS.TRANSACTIONS)
        .doc(transactionId)
        .get();
      if (existing.exists) {
        report.movementsSkippedExisting += 1;
        continue;
      }

      const points = Math.trunc(Number(movement.puntos ?? 0));
      const balanceBefore = Math.trunc(Number(movement.saldoAnterior ?? 0));
      const balanceAfter = Math.trunc(Number(movement.saldoNuevo ?? 0));
      const createdAt =
        movement.createdAt ?? admin.firestore.Timestamp.fromDate(new Date(0));

      const entry: LoyaltyTransaction = {
        transactionId,
        memberId,
        actorId: String(movement.origenId ?? memberId),
        actorType: LoyaltyActorType.SERVICE,
        type: mapLegacyTipo(String(movement.tipo ?? TipoMovimientoPuntos.ACUMULACION)),
        status: LoyaltyTransactionStatus.CONFIRMED,
        points,
        balanceBefore,
        balanceAfter,
        channel: mapLegacyChannel(movement.origen as string | undefined),
        description: movement.descripcion ?? "Migracion legacy movimientos_puntos",
        externalTransactionId: `legacy-migration:${memberId}:${movementDoc.id}`,
        metadata: {
          legacyMovementId: movementDoc.id,
          legacyReferencia: movement.referencia ?? "",
        },
        createdAt,
      };

      report.movementsToMigrate += 1;
      if (!DRY_RUN) {
        batch.set(
          firestoreApp.collection(LOYALTY_COLLECTIONS.TRANSACTIONS).doc(transactionId),
          entry,
        );
        batchOps += 1;
        if (batchOps >= BATCH_LIMIT) {
          await commitBatch();
        }
      }
    }
  }

  await commitBatch();

  const output = JSON.stringify(report, null, 2);
  console.log(output);

  if (reportPath) {
    const resolved = path.resolve(reportPath);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, output, "utf8");
    console.log(`Reporte escrito en: ${resolved}`);
  }

  console.log(
    `Wallets a crear: ${report.walletsToCreate}, transacciones a migrar: ${report.movementsToMigrate}, omitidas: ${report.movementsSkippedExisting}`,
  );
}

migrateLedger().catch((error) => {
  console.error("Error en migracion ledger:", error);
  process.exit(1);
});
