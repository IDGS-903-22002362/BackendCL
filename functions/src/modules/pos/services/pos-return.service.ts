/**
 * Devoluciones, reembolsos y anulación de ventas pagadas.
 *
 * Distinciones que el módulo mantiene explícitas:
 *
 * - Cancelar una venta no pagada (borrador, suspendida o en cobro) es una operación de venta y
 *   vive en `pos-sale.service`. Aquí solo se tratan ventas ya pagadas.
 * - Una venta pagada nunca desaparece ni pasa a `CANCELLED`: genera una devolución con su
 *   reembolso asociado y termina en `PARTIALLY_REFUNDED`, `REFUNDED` o `VOIDED`.
 * - La devolución (mercancía) y el reembolso (dinero) son efectos distintos del mismo
 *   documento: se puede devolver sin reponer inventario si la mercancía no regresó o no es
 *   apta para reventa.
 *
 * Garantías:
 *
 * - No se devuelven más unidades de las vendidas ni se reembolsa más dinero del cobrado: los
 *   límites se recalculan en la transacción contra `posSaleItems` y `posPayments` reales.
 * - Una devolución solo se completa una vez (`RETURN_NOT_ACTIONABLE`), y el reingreso de
 *   inventario se marca con `inventoryRestocked` para no reponer dos veces la misma unidad.
 * - El reembolso en efectivo escribe `CASH_REFUND` en el ledger del turno que lo paga, de modo
 *   que afecta el efectivo esperado del corte correcto.
 * - El reembolso con tarjeta no simula ninguna conexión bancaria: registra que la devolución
 *   se procesó fuera del sistema, con referencia, actor y fecha.
 */

import { POS_STORE_ID, POS_TEXT_LIMITS } from "../constants/pos.constants";
import { computeExpectedCash } from "../domain/expected-cash";
import {
  allocateRefund,
  lineRefundMinor,
  type RefundablePayment,
} from "../domain/refund-allocation";
import { assertTransition } from "../domain/state-machines";
import PosProblemError from "../errors/pos-problem.error";
import {
  PosAuditEntity,
  PosAuditEventType,
  PosCapability,
  PosCashMovementStatus,
  PosCashMovementType,
  PosPaymentMethod,
  PosPaymentStatus,
  PosReturnPhysicalCondition,
  PosReturnStatus,
  PosSaleStatus,
  PosShiftStatus,
} from "../models/pos.enums";
import type {
  OperationalDate,
  PosActor,
  PosPayment,
  PosRefundAllocationEntry,
  PosRequestContext,
  PosReturn,
  PosReturnItem,
  PosPageResult,
  PosSale,
  PosSaleItem,
} from "../models/pos.types";
import { nowTimestamp, runPosTransaction } from "../repositories/pos-firestore";
import {
  posCashMovementRepository,
  posPaymentRepository,
  posReturnRepository,
  posSaleRepository,
  posShiftRepository,
} from "../repositories/pos-operational.repository";
import { posAuditService } from "./pos-audit.service";
import { posAuthorizationService } from "./pos-authorization.service";
import { appendLedgerEntryInTransaction } from "./pos-cash-ledger.service";
import { posFolioService } from "./pos-folio.service";
import { posInventoryService } from "./pos-inventory.service";
import posSettingsService from "./pos-settings.service";
import { posShiftService } from "./pos-shift.service";

export interface ReturnLineInput {
  itemId: string;
  quantity: number;
  physicalCondition: PosReturnPhysicalCondition;
}

export interface CreateReturnInput {
  items: readonly ReturnLineInput[];
  reason: string;
}

export interface CompleteReturnInput {
  /** Referencia del reembolso bancario procesado en la terminal, si hubo parte con tarjeta. */
  cardRefundReference?: string;
  note?: string;
}

export interface ReturnResult {
  return: PosReturn;
  sale: PosSale;
}

const REFUNDABLE_SALE_STATUSES: readonly PosSaleStatus[] = [
  PosSaleStatus.PAID,
  PosSaleStatus.PARTIALLY_REFUNDED,
];

function assertReason(reason: string | undefined): string {
  const trimmed = (reason ?? "").trim();
  if (trimmed.length < POS_TEXT_LIMITS.REASON_MIN) {
    throw new PosProblemError(
      "REASON_REQUIRED",
      `El motivo debe tener al menos ${POS_TEXT_LIMITS.REASON_MIN} caracteres.`,
    );
  }
  return trimmed.slice(0, POS_TEXT_LIMITS.REASON_MAX);
}

function toRefundablePayment(payment: PosPayment): RefundablePayment {
  return {
    id: payment.id,
    method: payment.method,
    status: payment.status,
    amountMinor: payment.amountMinor,
    refundedMinor: payment.refundedMinor,
    approvedAtMs:
      payment.approvedAt?.toMillis() ?? payment.createdAt.toMillis(),
  };
}

/** Solo la mercancía que regresó y es apta para reventa vuelve al inventario. */
function isRestockable(condition: PosReturnPhysicalCondition): boolean {
  return condition === PosReturnPhysicalCondition.RETURNED_RESELLABLE;
}

class PosReturnService {
  /**
   * Registra la devolución solicitada. Calcula el reembolso por línea con los precios y
   * descuentos originales y lo reparte entre los pagos reales de la venta.
   */
  async create(
    actor: PosActor,
    saleId: string,
    input: CreateReturnInput,
    context: PosRequestContext | null,
  ): Promise<PosReturn> {
    posAuthorizationService.requireCapability(actor, PosCapability.SALE_REFUND);
    const reason = assertReason(input.reason);
    if (input.items.length === 0) {
      throw new PosProblemError(
        "POS_VALIDATION_ERROR",
        "La devolución debe incluir al menos una línea.",
      );
    }

    const shift = await posShiftService.requireOperableShift(actor);

    const created = await runPosTransaction(async (transaction) => {
      const sale = await posSaleRepository.requireByIdInTransaction(
        transaction,
        saleId,
      );
      if (!REFUNDABLE_SALE_STATUSES.includes(sale.status)) {
        throw new PosProblemError(
          "RETURN_NOT_ACTIONABLE",
          "Solo una venta pagada admite devoluciones.",
        );
      }

      const payments = await posPaymentRepository.listBySaleInTransaction(
        transaction,
        saleId,
      );
      const existingReturns = await posReturnRepository.listBySaleInTransaction(
        transaction,
        saleId,
      );
      const folioValue = await posFolioService.readValueInTransaction(
        transaction,
        "RETURN",
        shift.operationalDate,
        shift.registerCode,
      );

      // Unidades ya comprometidas por devoluciones abiertas: impiden reservar dos veces la
      // misma unidad aunque todavía no se hayan completado.
      const committed = new Map<string, number>();
      for (const entry of existingReturns) {
        if (
          entry.status === PosReturnStatus.REJECTED ||
          entry.status === PosReturnStatus.CANCELLED
        ) {
          continue;
        }
        for (const line of entry.items) {
          committed.set(
            line.itemId,
            (committed.get(line.itemId) ?? 0) + line.quantity,
          );
        }
      }

      const items: PosReturnItem[] = [];
      let refundTotalMinor = 0;

      for (const line of input.items) {
        const saleItem = sale.items.find((entry) => entry.itemId === line.itemId);
        if (!saleItem) {
          throw new PosProblemError("SALE_ITEM_NOT_FOUND");
        }
        const alreadyCommitted = committed.get(line.itemId) ?? 0;
        const availableToReturn =
          saleItem.quantity - saleItem.returnedQuantity - alreadyCommitted;
        if (line.quantity > availableToReturn) {
          throw new PosProblemError(
            "RETURN_QUANTITY_EXCEEDED",
            `Solo quedan ${Math.max(0, availableToReturn)} unidades por devolver de ${saleItem.clave}.`,
          );
        }

        const refundMinor = lineRefundMinor({
          lineTotalMinor: saleItem.lineTotalMinor,
          quantity: saleItem.quantity,
          returnQuantity: line.quantity,
          alreadyReturnedQuantity: saleItem.returnedQuantity + alreadyCommitted,
          alreadyRefundedMinor: saleItem.refundedMinor,
        });
        refundTotalMinor += refundMinor;

        items.push({
          itemId: saleItem.itemId,
          productoId: saleItem.productoId,
          tallaId: saleItem.tallaId,
          clave: saleItem.clave,
          descripcion: saleItem.descripcion,
          quantity: line.quantity,
          unitPriceMinor: saleItem.unitPriceMinor,
          refundMinor,
          physicalCondition: line.physicalCondition,
          restockable: isRestockable(line.physicalCondition),
        });
      }

      if (refundTotalMinor <= 0) {
        throw new PosProblemError(
          "POS_VALIDATION_ERROR",
          "La devolución no genera importe a reembolsar.",
        );
      }

      const allocation = allocateRefund(
        refundTotalMinor,
        payments.map(toRefundablePayment),
      );

      const folio = posFolioService.reserveInTransaction(
        transaction,
        "RETURN",
        shift.operationalDate,
        folioValue,
        shift.registerCode,
      );

      const entity = posReturnRepository.createInTransaction(transaction, {
        storeId: POS_STORE_ID,
        folio,
        saleId: sale.id,
        saleFolio: sale.folio,
        registerId: shift.registerId,
        sessionId: shift.sessionId,
        shiftId: shift.id,
        operationalDate: shift.operationalDate,
        status: PosReturnStatus.PENDING_APPROVAL,
        items,
        refundTotalMinor,
        refundAllocation: allocation.allocations.map((entry) => ({
          paymentId: entry.paymentId,
          method: entry.method,
          amountMinor: entry.amountMinor,
          externalReference: null,
          externalProcessedBy: null,
          externalProcessedAt: null,
        })),
        cashRefundMinor: allocation.cashRefundMinor,
        cardRefundMinor: allocation.cardRefundMinor,
        reason,
        requestedBy: actor.uid,
        authorizedBy: null,
        rejectionReason: null,
        inventoryRestocked: false,
        completedAt: null,
      });

      posAuditService.recordInTransaction(transaction, {
        eventType: PosAuditEventType.RETURN_CREATED,
        entity: PosAuditEntity.RETURN,
        entityId: entity.id,
        actor,
        context,
        operationalDate: shift.operationalDate,
        registerId: shift.registerId,
        sessionId: shift.sessionId,
        shiftId: shift.id,
        after: {
          folio,
          saleId: sale.id,
          refundTotalMinor,
          cashRefundMinor: allocation.cashRefundMinor,
          cardRefundMinor: allocation.cardRefundMinor,
          lines: items.length,
        },
        reason,
      });

      return entity;
    });

    return created;
  }

  /** Autoriza la devolución. El solicitante no puede autorizarse a sí mismo. */
  async approve(
    actor: PosActor,
    returnId: string,
    context: PosRequestContext | null,
  ): Promise<PosReturn> {
    posAuthorizationService.requireCapability(actor, PosCapability.SALE_REFUND);

    return runPosTransaction(async (transaction) => {
      const entity = await posReturnRepository.requireByIdInTransaction(
        transaction,
        returnId,
      );
      posAuthorizationService.assertNotSelfApproval(actor, entity.requestedBy);
      const target = assertTransition(
        "return",
        "approve",
        entity.status,
      ) as PosReturnStatus;

      posReturnRepository.updateInTransaction(
        transaction,
        entity.id,
        { status: target, authorizedBy: actor.uid },
        entity.version,
      );

      posAuditService.recordInTransaction(transaction, {
        eventType: PosAuditEventType.RETURN_APPROVED,
        entity: PosAuditEntity.RETURN,
        entityId: entity.id,
        actor,
        context,
        operationalDate: entity.operationalDate,
        registerId: entity.registerId,
        sessionId: entity.sessionId,
        shiftId: entity.shiftId,
        before: { status: entity.status },
        after: { status: target },
      });

      return {
        ...entity,
        status: target,
        authorizedBy: actor.uid,
        version: entity.version + 1,
      };
    });
  }

  async reject(
    actor: PosActor,
    returnId: string,
    reason: string,
    context: PosRequestContext | null,
  ): Promise<PosReturn> {
    posAuthorizationService.requireCapability(actor, PosCapability.SALE_REFUND);
    const validReason = assertReason(reason);

    return runPosTransaction(async (transaction) => {
      const entity = await posReturnRepository.requireByIdInTransaction(
        transaction,
        returnId,
      );
      posAuthorizationService.assertNotSelfApproval(actor, entity.requestedBy);
      const target = assertTransition(
        "return",
        "reject",
        entity.status,
      ) as PosReturnStatus;

      posReturnRepository.updateInTransaction(
        transaction,
        entity.id,
        { status: target, rejectionReason: validReason, authorizedBy: actor.uid },
        entity.version,
      );

      posAuditService.recordInTransaction(transaction, {
        eventType: PosAuditEventType.RETURN_REJECTED,
        entity: PosAuditEntity.RETURN,
        entityId: entity.id,
        actor,
        context,
        operationalDate: entity.operationalDate,
        registerId: entity.registerId,
        sessionId: entity.sessionId,
        shiftId: entity.shiftId,
        before: { status: entity.status },
        after: { status: target },
        reason: validReason,
      });

      return {
        ...entity,
        status: target,
        rejectionReason: validReason,
        version: entity.version + 1,
      };
    });
  }

  async cancel(
    actor: PosActor,
    returnId: string,
    reason: string,
    context: PosRequestContext | null,
  ): Promise<PosReturn> {
    posAuthorizationService.requireCapability(actor, PosCapability.SALE_REFUND);
    const validReason = assertReason(reason);

    return runPosTransaction(async (transaction) => {
      const entity = await posReturnRepository.requireByIdInTransaction(
        transaction,
        returnId,
      );
      if (
        entity.requestedBy !== actor.uid &&
        !actor.capabilities.includes(PosCapability.CUT_APPROVE)
      ) {
        throw new PosProblemError("POS_RESOURCE_NOT_FOUND");
      }
      const target = assertTransition(
        "return",
        "cancel",
        entity.status,
      ) as PosReturnStatus;

      posReturnRepository.updateInTransaction(
        transaction,
        entity.id,
        { status: target, rejectionReason: validReason },
        entity.version,
      );

      posAuditService.recordInTransaction(transaction, {
        eventType: PosAuditEventType.RETURN_REJECTED,
        entity: PosAuditEntity.RETURN,
        entityId: entity.id,
        actor,
        context,
        operationalDate: entity.operationalDate,
        registerId: entity.registerId,
        sessionId: entity.sessionId,
        shiftId: entity.shiftId,
        before: { status: entity.status },
        after: { status: target },
        reason: validReason,
      });

      return { ...entity, status: target, version: entity.version + 1 };
    });
  }

  /**
   * Aplica el reembolso: actualiza pagos, venta, ledger de efectivo y, si corresponde,
   * repone inventario. Todo en una sola transacción.
   */
  async complete(
    actor: PosActor,
    returnId: string,
    input: CompleteReturnInput,
    idempotencyKeyHash: string | null,
    context: PosRequestContext | null,
  ): Promise<ReturnResult> {
    posAuthorizationService.requireCapability(actor, PosCapability.SALE_REFUND);

    return runPosTransaction(async (transaction) =>
      this.applyRefundInTransaction(transaction, actor, returnId, input, {
        idempotencyKeyHash,
        context,
        saleAction: null,
      }),
    );
  }

  /**
   * Anulación de una venta pagada: devuelve todas las unidades pendientes, reembolsa el total
   * cobrado y deja la venta en `VOIDED`. Requiere capacidad de cancelación de venta pagada.
   */
  async voidPaidSale(
    actor: PosActor,
    saleId: string,
    input: {
      reason: string;
      physicalCondition: PosReturnPhysicalCondition;
      cardRefundReference?: string;
    },
    idempotencyKeyHash: string | null,
    context: PosRequestContext | null,
  ): Promise<ReturnResult> {
    posAuthorizationService.requireCapability(
      actor,
      PosCapability.SALE_CANCEL_PAID,
    );
    posAuthorizationService.requireCapability(actor, PosCapability.SALE_REFUND);
    const reason = assertReason(input.reason);

    const settings = await posSettingsService.get();
    const sale = await posSaleRepository.requireById(saleId);
    if (sale.status !== PosSaleStatus.PAID) {
      throw new PosProblemError(
        "RETURN_NOT_ACTIONABLE",
        "Solo una venta pagada sin devoluciones previas puede anularse.",
      );
    }
    if (!settings.allowPaidSaleVoidSameShift) {
      throw new PosProblemError(
        "POS_PERMISSION_DENIED",
        "La anulación de ventas pagadas está deshabilitada por configuración.",
      );
    }

    const draft = await this.create(
      actor,
      saleId,
      {
        reason,
        items: sale.items
          .filter((item) => item.quantity - item.returnedQuantity > 0)
          .map((item) => ({
            itemId: item.itemId,
            quantity: item.quantity - item.returnedQuantity,
            physicalCondition: input.physicalCondition,
          })),
      },
      context,
    );

    // La anulación la ejecuta un actor con capacidad de cancelar ventas pagadas, que actúa
    // como autorizador distinto del cajero que cobró.
    const approved = await runPosTransaction(async (transaction) => {
      const entity = await posReturnRepository.requireByIdInTransaction(
        transaction,
        draft.id,
      );
      const target = assertTransition(
        "return",
        "approve",
        entity.status,
      ) as PosReturnStatus;
      posReturnRepository.updateInTransaction(
        transaction,
        entity.id,
        { status: target, authorizedBy: actor.uid },
        entity.version,
      );
      return { ...entity, status: target, version: entity.version + 1 };
    });

    return runPosTransaction(async (transaction) =>
      this.applyRefundInTransaction(transaction, actor, approved.id, input, {
        idempotencyKeyHash,
        context,
        saleAction: "void",
      }),
    );
  }

  async get(actor: PosActor, returnId: string): Promise<PosReturn> {
    const entity = await posReturnRepository.requireById(returnId);
    if (
      !actor.capabilities.includes(PosCapability.SHIFT_READ_ALL) &&
      entity.requestedBy !== actor.uid
    ) {
      throw new PosProblemError("POS_RESOURCE_NOT_FOUND");
    }
    return entity;
  }

  async list(
    actor: PosActor,
    filters: {
      saleId?: string;
      registerId?: string;
      shiftId?: string;
      status?: PosReturnStatus;
      operationalDate?: OperationalDate;
      limit?: number;
      cursor?: string;
    },
  ): Promise<PosPageResult<PosReturn>> {
    const settings = await posSettingsService.get();
    const limit = Math.min(
      filters.limit ?? settings.defaultPageSize,
      settings.maxPageSize,
    );

    const equals: Array<{ field: string; value: unknown }> = [];
    if (filters.saleId) equals.push({ field: "saleId", value: filters.saleId });
    if (filters.registerId) {
      equals.push({ field: "registerId", value: filters.registerId });
    }
    if (filters.shiftId) equals.push({ field: "shiftId", value: filters.shiftId });
    if (filters.status) equals.push({ field: "status", value: filters.status });
    if (filters.operationalDate) {
      equals.push({ field: "operationalDate", value: filters.operationalDate });
    }
    if (!actor.capabilities.includes(PosCapability.SHIFT_READ_ALL)) {
      equals.push({ field: "requestedBy", value: actor.uid });
    }

    return posReturnRepository.list({
      limit,
      cursor: filters.cursor,
      orderByField: "createdAt",
      direction: "desc",
      equals,
    });
  }

  // ------------------------------------------------------------------ internos

  /**
   * Núcleo transaccional del reembolso. Se usa tanto para completar una devolución como para
   * anular una venta pagada; la única diferencia es el estado final de la venta.
   */
  private async applyRefundInTransaction(
    transaction: FirebaseFirestore.Transaction,
    actor: PosActor,
    returnId: string,
    input: CompleteReturnInput,
    options: {
      idempotencyKeyHash: string | null;
      context: PosRequestContext | null;
      saleAction: "void" | null;
    },
  ): Promise<ReturnResult> {
    const entity = await posReturnRepository.requireByIdInTransaction(
      transaction,
      returnId,
    );
    const target = assertTransition(
      "return",
      "complete",
      entity.status,
    ) as PosReturnStatus;
    if (entity.inventoryRestocked) {
      throw new PosProblemError(
        "RETURN_NOT_ACTIONABLE",
        "La devolución ya repuso inventario.",
      );
    }

    const sale = await posSaleRepository.requireByIdInTransaction(
      transaction,
      entity.saleId,
    );
    const payments = await posPaymentRepository.listBySaleInTransaction(
      transaction,
      entity.saleId,
    );
    const shift = await posShiftRepository.requireByIdInTransaction(
      transaction,
      entity.shiftId,
    );
    if (shift.status !== PosShiftStatus.ACTIVE) {
      throw new PosProblemError(
        "NO_ACTIVE_SHIFT",
        "El turno que registró la devolución ya no está activo.",
      );
    }

    const restockLines = entity.items.filter((line) => line.restockable);
    const products =
      restockLines.length > 0
        ? await posInventoryService.loadProductsInTransaction(
            transaction,
            restockLines.map((line) => line.productoId),
          )
        : new Map();

    // La validación de fondos usa el ledger, no una proyección acumulada.
    const movements = await posCashMovementRepository.listByShiftInTransaction(
      transaction,
      shift.id,
    );

    // El reparto se recalcula contra los pagos reales: entre la solicitud y la ejecución pudo
    // registrarse otro reembolso sobre la misma venta.
    const allocation = allocateRefund(
      entity.refundTotalMinor,
      payments.map(toRefundablePayment),
    );

    if (allocation.cashRefundMinor > 0) {
      const { expectedCashMinor } = computeExpectedCash({
        openingFloatMinor: shift.receivedFloatMinor,
        movements,
      });
      if (allocation.cashRefundMinor > expectedCashMinor) {
        throw new PosProblemError(
          "CASH_MOVEMENT_LIMIT_EXCEEDED",
          "No hay efectivo suficiente en la caja para pagar el reembolso.",
        );
      }
    }

    const now = nowTimestamp();
    const allocationEntries: PosRefundAllocationEntry[] = allocation.allocations.map(
      (line) => ({
        paymentId: line.paymentId,
        method: line.method,
        amountMinor: line.amountMinor,
        externalReference:
          line.method === PosPaymentMethod.CARD_EXTERNAL
            ? (input.cardRefundReference ?? null)
            : null,
        externalProcessedBy:
          line.method === PosPaymentMethod.CARD_EXTERNAL ? actor.uid : null,
        externalProcessedAt:
          line.method === PosPaymentMethod.CARD_EXTERNAL ? now : null,
      }),
    );

    if (
      allocation.cardRefundMinor > 0 &&
      !input.cardRefundReference
    ) {
      throw new PosProblemError(
        "POS_VALIDATION_ERROR",
        "Un reembolso con tarjeta requiere la referencia de la operación procesada en la terminal.",
      );
    }

    // Pagos: refundedMinor acumulado y estado derivado.
    for (const line of allocation.allocations) {
      const payment = payments.find((entry) => entry.id === line.paymentId);
      if (!payment) {
        throw new PosProblemError("POS_RESOURCE_NOT_FOUND");
      }
      const refundedMinor = payment.refundedMinor + line.amountMinor;
      const fully = refundedMinor >= payment.amountMinor;
      const paymentTarget = assertTransition(
        "payment",
        fully ? "refund" : "partially-refund",
        payment.status,
      ) as PosPaymentStatus;
      posPaymentRepository.updateInTransaction(
        transaction,
        payment.id,
        { refundedMinor, status: paymentTarget },
        payment.version,
      );
    }

    // Venta: unidades devueltas e importes reembolsados por línea.
    const returnedByItem = new Map<string, { quantity: number; refundMinor: number }>();
    for (const line of entity.items) {
      const current = returnedByItem.get(line.itemId) ?? {
        quantity: 0,
        refundMinor: 0,
      };
      returnedByItem.set(line.itemId, {
        quantity: current.quantity + line.quantity,
        refundMinor: current.refundMinor + line.refundMinor,
      });
    }

    const nextItems: PosSaleItem[] = sale.items.map((item) => {
      const applied = returnedByItem.get(item.itemId);
      if (!applied) return item;
      return {
        ...item,
        returnedQuantity: item.returnedQuantity + applied.quantity,
        refundedMinor: item.refundedMinor + applied.refundMinor,
        updatedAt: now,
      };
    });

    const totalRefundedMinor =
      sale.payment.refundedMinor + entity.refundTotalMinor;
    const fullyReturned = nextItems.every(
      (item) => item.returnedQuantity >= item.quantity,
    );

    const saleAction =
      options.saleAction ??
      (fullyReturned || totalRefundedMinor >= sale.totals.totalMinor
        ? "refund"
        : "partially-refund");
    const saleTarget = assertTransition(
      "sale",
      saleAction,
      sale.status,
    ) as PosSaleStatus;

    posSaleRepository.updateInTransaction(
      transaction,
      sale.id,
      {
        status: saleTarget,
        items: nextItems,
        payment: {
          ...sale.payment,
          refundedMinor: totalRefundedMinor,
        },
        ...(saleAction === "void"
          ? { voidReason: entity.reason, voidedAt: now }
          : {}),
      },
      sale.version,
    );

    // Efectivo: el reembolso sale del cajón del turno que lo paga.
    if (allocation.cashRefundMinor > 0) {
      appendLedgerEntryInTransaction(transaction, {
        registerId: entity.registerId,
        sessionId: entity.sessionId,
        shiftId: entity.shiftId,
        operationalDate: entity.operationalDate,
        type: PosCashMovementType.CASH_REFUND,
        status: PosCashMovementStatus.APPROVED,
        amountMinor: allocation.cashRefundMinor,
        reason: `Reembolso en efectivo de la venta ${sale.folio}`,
        description: input.note ?? null,
        requestedBy: actor.uid,
        authorizedBy: entity.authorizedBy ?? actor.uid,
        saleId: sale.id,
        returnId: entity.id,
        idempotencyKeyHash: options.idempotencyKeyHash,
      });
    }

    // Inventario: solo la mercancía declarada apta para reventa vuelve a existencias.
    if (restockLines.length > 0) {
      posInventoryService.restockLinesInTransaction(
        transaction,
        products,
        restockLines.map((line) => ({
          productoId: line.productoId,
          tallaId: line.tallaId,
          quantity: line.quantity,
        })),
        {
          returnId: entity.id,
          saleId: sale.id,
          registerId: entity.registerId,
          shiftId: entity.shiftId,
          operationalDate: entity.operationalDate,
          actorUid: actor.uid,
          actorRole: actor.posRole,
          reason: `Devolución POS ${entity.folio}`,
          idempotencyKey: options.idempotencyKeyHash,
        },
      );
    }

    posShiftRepository.updateInTransaction(
      transaction,
      shift.id,
      {
        totals: {
          ...shift.totals,
          cashRefundsMinor:
            shift.totals.cashRefundsMinor + allocation.cashRefundMinor,
          cardRefundsMinor:
            shift.totals.cardRefundsMinor + allocation.cardRefundMinor,
          ...(saleAction === "void"
            ? {
                voidedSalesMinor:
                  shift.totals.voidedSalesMinor + sale.totals.totalMinor,
              }
            : {}),
        },
      },
      shift.version,
    );

    posReturnRepository.updateInTransaction(
      transaction,
      entity.id,
      {
        status: target,
        refundAllocation: allocationEntries,
        cashRefundMinor: allocation.cashRefundMinor,
        cardRefundMinor: allocation.cardRefundMinor,
        inventoryRestocked: restockLines.length > 0,
        completedAt: now,
      },
      entity.version,
    );

    posAuditService.recordInTransaction(transaction, {
      eventType: PosAuditEventType.REFUND_CREATED,
      entity: PosAuditEntity.RETURN,
      entityId: entity.id,
      actor,
      context: options.context,
      operationalDate: entity.operationalDate,
      registerId: entity.registerId,
      sessionId: entity.sessionId,
      shiftId: entity.shiftId,
      before: { returnStatus: entity.status, saleStatus: sale.status },
      after: {
        returnStatus: target,
        saleStatus: saleTarget,
        refundTotalMinor: entity.refundTotalMinor,
        cashRefundMinor: allocation.cashRefundMinor,
        cardRefundMinor: allocation.cardRefundMinor,
        restockedLines: restockLines.length,
        cardRefundReference: input.cardRefundReference ?? null,
      },
      reason: entity.reason,
    });

    if (saleAction === "void") {
      posAuditService.recordInTransaction(transaction, {
        eventType: PosAuditEventType.SALE_VOIDED,
        entity: PosAuditEntity.SALE,
        entityId: sale.id,
        actor,
        context: options.context,
        operationalDate: sale.operationalDate,
        registerId: sale.registerId,
        sessionId: sale.sessionId,
        shiftId: sale.shiftId,
        before: { status: sale.status },
        after: { status: saleTarget },
        reason: entity.reason,
      });
    }

    return {
      return: {
        ...entity,
        status: target,
        refundAllocation: allocationEntries,
        cashRefundMinor: allocation.cashRefundMinor,
        cardRefundMinor: allocation.cardRefundMinor,
        inventoryRestocked: restockLines.length > 0,
        version: entity.version + 1,
      },
      sale: {
        ...sale,
        status: saleTarget,
        items: nextItems,
        payment: { ...sale.payment, refundedMinor: totalRefundedMinor },
        version: sale.version + 1,
      },
    };
  }
}

export const posReturnService = new PosReturnService();
export default posReturnService;
