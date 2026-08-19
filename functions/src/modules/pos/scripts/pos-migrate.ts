/**
 * Migración idempotente del POS.
 *
 * Uso:
 *   npm run pos:migrate:dry-run
 *   npm run pos:migrate:emulator
 *   npm run build && node lib/modules/pos/scripts/pos-migrate.js --staging
 *   POS_MIGRATION_CONFIRM=I_UNDERSTAND npm run pos:migrate:production
 *
 * No borra datos. No sobrescribe `posSettings` existentes. Solo crea operadores
 * faltantes para `EMPLEADO` con rol mínimo CASHIER.
 */

import * as fs from "fs";
import * as path from "path";
import { firestoreTienda } from "../../../config/firebase";
import { RolUsuario } from "../../../models/usuario.model";
import { POS_STORE_ID, SHARED_COLLECTIONS } from "../constants/pos.constants";
import { PosRole } from "../models/pos.enums";
import { buildDefaultSettings } from "../services/pos-settings.service";
import {
  posOperatorRepository,
  posSettingsRepository,
  posUserDirectoryRepository,
} from "../repositories/pos-support.repository";

const DRY_RUN = process.argv.includes("--dry-run");
const IS_PRODUCTION = process.argv.includes("--production");
const IS_STAGING = process.argv.includes("--staging");
const IS_EMULATOR =
  process.argv.includes("--emulator") ||
  Boolean(process.env.FIRESTORE_EMULATOR_HOST);

type MigrateReport = {
  generatedAt: string;
  dryRun: boolean;
  environment: string;
  settingsCreated: boolean;
  settingsAlreadyPresent: boolean;
  operatorsCreated: number;
  operatorsSkippedExisting: number;
  employeesAnalyzed: number;
  inventoryIssues: Array<{ productId: string; issue: string }>;
  orphanHints: string[];
  errors: string[];
};

function parseReportPath(): string {
  const arg = process.argv.find((entry) => entry.startsWith("--report="));
  if (arg) {
    return arg.slice("--report=".length);
  }
  return path.join(
    process.cwd(),
    "reports",
    `pos-migrate-${Date.now()}.json`,
  );
}

function assertProductionGate(): void {
  if (!IS_PRODUCTION) {
    return;
  }
  if (process.env.POS_MIGRATION_CONFIRM !== "I_UNDERSTAND") {
    throw new Error(
      "Migración de producción bloqueada. Define POS_MIGRATION_CONFIRM=I_UNDERSTAND.",
    );
  }
}

async function ensureSettings(report: MigrateReport): Promise<void> {
  const existing = await posSettingsRepository.get();
  if (existing) {
    report.settingsAlreadyPresent = true;
    return;
  }
  report.settingsCreated = true;
  if (DRY_RUN) {
    return;
  }
  await posSettingsRepository.create(buildDefaultSettings("system:migrate"));
}

async function ensureOperators(report: MigrateReport): Promise<void> {
  const employees = await posUserDirectoryRepository.listByRole(
    RolUsuario.EMPLEADO,
    1_000,
  );
  report.employeesAnalyzed = employees.length;

  for (const employee of employees) {
    if (!employee.uid || employee.activo === false) {
      continue;
    }
    const existing = await posOperatorRepository.get(employee.uid);
    if (existing) {
      report.operatorsSkippedExisting += 1;
      continue;
    }
    report.operatorsCreated += 1;
    if (DRY_RUN) {
      continue;
    }
    await posOperatorRepository.upsert({
      uid: employee.uid,
      posRole: PosRole.CASHIER,
      active: true,
      updatedBy: "system:migrate",
    });
  }
}

async function reportInventoryIssues(report: MigrateReport): Promise<void> {
  const snapshot = await firestoreTienda
    .collection(SHARED_COLLECTIONS.PRODUCTS)
    .limit(500)
    .get();

  for (const doc of snapshot.docs) {
    const data = doc.data() as Record<string, unknown>;
    const hasGlobal =
      data.inventarioGlobal && typeof data.inventarioGlobal === "object";
    const hasSizes = Array.isArray(data.inventarioPorTalla);
    if (!hasGlobal && !hasSizes) {
      report.inventoryIssues.push({
        productId: doc.id,
        issue: "missing_inventory_buckets",
      });
    }
  }
}

async function hintOrphans(report: MigrateReport): Promise<void> {
  const settings = await posSettingsRepository.get();
  if (!settings && !DRY_RUN) {
    report.orphanHints.push("posSettings ausente tras migración");
  }
  if (settings && settings.storeId !== POS_STORE_ID) {
    report.orphanHints.push(
      `posSettings.storeId inesperado: ${settings.storeId}`,
    );
  }
}

async function main(): Promise<void> {
  assertProductionGate();

  const report: MigrateReport = {
    generatedAt: new Date().toISOString(),
    dryRun: DRY_RUN,
    environment: IS_PRODUCTION
      ? "production"
      : IS_STAGING
        ? "staging"
        : IS_EMULATOR
          ? "emulator"
          : "local",
    settingsCreated: false,
    settingsAlreadyPresent: false,
    operatorsCreated: 0,
    operatorsSkippedExisting: 0,
    employeesAnalyzed: 0,
    inventoryIssues: [],
    orphanHints: [],
    errors: [],
  };

  console.log(
    `\nPOS migrate (${report.environment}${DRY_RUN ? ", dry-run" : ""})`,
  );

  try {
    await ensureSettings(report);
    await ensureOperators(report);
    await reportInventoryIssues(report);
    await hintOrphans(report);
  } catch (error) {
    report.errors.push(
      error instanceof Error ? error.message : String(error),
    );
  }

  const reportPath = parseReportPath();
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");
  console.log(JSON.stringify(report, null, 2));
  console.log(`Reporte: ${reportPath}`);

  if (report.errors.length > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
