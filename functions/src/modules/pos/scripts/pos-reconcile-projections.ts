/**
 * Reconciliación de proyecciones del POS contra el ledger y las ventas canónicas.
 *
 * Recalcula totales de un turno a partir de `posCashMovements` + `posSales` + `posPayments`
 * y reporta diferencias contra `posShifts.totals`. No escribe por defecto.
 *
 * Uso:
 *   npm run build && node lib/modules/pos/scripts/pos-reconcile-projections.js --shift=<id>
 *   ... --apply --confirm=APPLY
 */

import * as fs from "fs";
import * as path from "path";
import { computeExpectedCash } from "../domain/expected-cash";
import {
  PosCashMovementStatus,
  PosCashMovementType,
  PosPaymentMethod,
  PosPaymentStatus,
  PosSaleStatus,
} from "../models/pos.enums";
import type { PosPayment } from "../models/pos.types";
import {
  posCashMovementRepository,
  posPaymentRepository,
  posSaleRepository,
  posShiftRepository,
} from "../repositories/pos-operational.repository";

const APPLY = process.argv.includes("--apply");
const CONFIRM = process.argv
  .find((entry) => entry.startsWith("--confirm="))
  ?.slice("--confirm=".length);

function shiftIdArg(): string {
  const arg = process.argv.find((entry) => entry.startsWith("--shift="));
  if (!arg) {
    throw new Error("Requiere --shift=<shiftId>");
  }
  return arg.slice("--shift=".length);
}

function sumPayments(
  payments: readonly PosPayment[],
  method: PosPaymentMethod,
): number {
  return payments
    .filter(
      (payment) =>
        payment.method === method &&
        payment.status === PosPaymentStatus.APPROVED,
    )
    .reduce((total, payment) => total + payment.amountMinor, 0);
}

function sumMovements(
  types: readonly PosCashMovementType[],
  movements: Awaited<ReturnType<typeof posCashMovementRepository.listByShift>>,
): number {
  const approved = new Set<PosCashMovementStatus>([
    PosCashMovementStatus.APPROVED,
    PosCashMovementStatus.RECEIVED,
  ]);
  return movements
    .filter(
      (movement) =>
        types.includes(movement.type) && approved.has(movement.status),
    )
    .reduce((total, movement) => total + movement.amountMinor, 0);
}

async function main(): Promise<void> {
  const shiftId = shiftIdArg();
  const shift = await posShiftRepository.requireById(shiftId);

  const sales = await posSaleRepository.listByShift(shiftId);
  const movements = await posCashMovementRepository.listByShift(shiftId);
  const payments = await posPaymentRepository.listByShift(shiftId);

  const paidLike = sales.filter((sale) =>
    [
      PosSaleStatus.PAID,
      PosSaleStatus.PARTIALLY_REFUNDED,
      PosSaleStatus.REFUNDED,
      PosSaleStatus.VOIDED,
    ].includes(sale.status),
  );

  const nonVoided = paidLike.filter(
    (sale) => sale.status !== PosSaleStatus.VOIDED,
  );

  const expectedCashMinor = computeExpectedCash({
    openingFloatMinor: shift.receivedFloatMinor,
    movements,
  }).expectedCashMinor;

  const rebuilt = {
    salesCount: nonVoided.length,
    grossSalesMinor: paidLike.reduce(
      (total, sale) => total + sale.totals.subtotalOriginalMinor,
      0,
    ),
    discountMinor: paidLike.reduce(
      (total, sale) => total + sale.totals.discountMinor,
      0,
    ),
    netSalesMinor: nonVoided.reduce(
      (total, sale) => total + sale.totals.totalMinor,
      0,
    ),
    cashSalesMinor: sumPayments(payments, PosPaymentMethod.CASH),
    cardSalesMinor: sumPayments(payments, PosPaymentMethod.CARD_EXTERNAL),
    cashRefundsMinor: sumMovements(
      [PosCashMovementType.CASH_REFUND],
      movements,
    ),
    cardRefundsMinor: shift.totals.cardRefundsMinor,
    voidedSalesMinor: paidLike
      .filter((sale) => sale.status === PosSaleStatus.VOIDED)
      .reduce((total, sale) => total + sale.totals.totalMinor, 0),
    cashInMinor: sumMovements(
      [
        PosCashMovementType.CASH_IN,
        PosCashMovementType.CASH_REPLENISHMENT,
      ],
      movements,
    ),
    cashOutMinor: sumMovements([PosCashMovementType.CASH_OUT], movements),
    securityDropsMinor: sumMovements(
      [PosCashMovementType.SECURITY_DROP],
      movements,
    ),
    transfersInMinor: sumMovements(
      [PosCashMovementType.TRANSFER_IN],
      movements,
    ),
    transfersOutMinor: sumMovements(
      [PosCashMovementType.TRANSFER_OUT],
      movements,
    ),
  };

  const deltas: Record<string, { stored: number; rebuilt: number }> = {};
  for (const [key, rebuiltValue] of Object.entries(rebuilt)) {
    const storedValue =
      (shift.totals as unknown as Record<string, number>)[key] ?? 0;
    if (storedValue !== rebuiltValue) {
      deltas[key] = { stored: storedValue, rebuilt: rebuiltValue };
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    shiftId,
    expectedCashMinor,
    deltas,
    balanced: Object.keys(deltas).length === 0,
    applied: false,
  };

  if (APPLY) {
    if (CONFIRM !== "APPLY") {
      throw new Error("Para escribir totales usa --apply --confirm=APPLY");
    }
    await posShiftRepository.update(
      shiftId,
      { totals: { ...shift.totals, ...rebuilt } },
      shift.version,
    );
    report.applied = true;
  }

  const reportPath = path.join(
    process.cwd(),
    "reports",
    `pos-reconcile-${shiftId}-${Date.now()}.json`,
  );
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");
  console.log(JSON.stringify(report, null, 2));
  console.log(`Reporte: ${reportPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
