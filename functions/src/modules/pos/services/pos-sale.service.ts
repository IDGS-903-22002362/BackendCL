/**
 * Ventas presenciales: borrador, líneas, repricing, códigos, descuento manual, suspensión y
 * preparación del cobro.
 *
 * Principios:
 *
 * - El backend es la fuente de verdad. El cliente solo envía `productoId`, `tallaId`,
 *   `quantity`, `promotionCode`, notas y motivos. Cualquier precio, descuento o total
 *   enviado se ignora: no existe un campo de entrada que los acepte.
 * - Toda modificación recalcula la venta completa contra el catálogo y guarda snapshots
 *   históricos, de modo que un cambio posterior de precio no altere una venta pagada.
 * - Un borrador no reserva inventario (DEC-06). La disponibilidad se valida al agregar
 *   líneas y al preparar el cobro, y se confirma de forma atómica al pagar.
 * - Las escrituras usan versión optimista: si otro dispositivo modificó la venta, la
 *   operación falla con `CONCURRENT_MODIFICATION` en lugar de sobrescribir.
 */

import { randomBytes, randomUUID } from "crypto";
import { Timestamp } from "firebase-admin/firestore";
import { POS_STORE_ID, POS_TEXT_LIMITS } from "../constants/pos.constants";
import { assertNonNegativeMinor, percentOfMinor } from "../domain/money";
import { computeSaleTotals } from "../domain/sale-totals";
import { assertTransition } from "../domain/state-machines";
import PosProblemError from "../errors/pos-problem.error";
import {
  PosAuditEntity,
  PosAuditEventType,
  PosCapability,
  PosPaymentMethod,
  PosRole,
  PosSaleStatus,
  PosShiftStatus,
} from "../models/pos.enums";
import type {
  OperationalDate,
  PosActor,
  PosPageResult,
  PosRequestContext,
  PosSale,
  PosSaleItem,
  PosSaleTotals,
  PosSettings,
  PosShift,
} from "../models/pos.types";
import { nowTimestamp, runPosTransaction } from "../repositories/pos-firestore";
import {
  posRegisterRepository,
  posSaleRepository,
  posShiftRepository,
} from "../repositories/pos-operational.repository";
import { posAuditService } from "./pos-audit.service";
import { posAuthorizationService } from "./pos-authorization.service";
import posFolioService from "./pos-folio.service";
import {
  posInventoryService,
  type PosProductSnapshot,
} from "./pos-inventory.service";
import { posPricingService } from "./pos-pricing.service";
import posSettingsService from "./pos-settings.service";

/** Cambio detectado al revalidar una venta. Se informa al cajero antes de cobrar. */
export interface SaleChange {
  code:
    | "PRICE_CHANGED"
    | "PROMOTION_CHANGED"
    | "STOCK_REDUCED"
    | "PRODUCT_UNAVAILABLE"
    | "CODE_REMOVED"
    | "MANUAL_DISCOUNT_ADJUSTED";
  itemId: string | null;
  message: string;
  beforeMinor: number | null;
  afterMinor: number | null;
}

export interface SaleWithChanges {
  sale: PosSale;
  changes: SaleChange[];
}

export interface SaleAvailabilityIssue {
  itemId: string;
  productoId: string;
  tallaId: string | null;
  requested: number;
  available: number;
}

export interface CheckoutPreview {
  sale: PosSale;
  changes: SaleChange[];
  pendingMinor: number;
  allowedMethods: PosPaymentMethod[];
}

const EMPTY_PAYMENT_SUMMARY = Object.freeze({
  paidMinor: 0,
  pendingMinor: 0,
  cashMinor: 0,
  cardMinor: 0,
  changeMinor: 0,
  refundedMinor: 0,
  methods: [] as PosPaymentMethod[],
});

function sanitizeText(value: string | undefined | null, max: number): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed.slice(0, max);
}

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

/** Límite de descuento manual del actor según su rol POS. */
export function manualDiscountLimitFor(
  actor: PosActor,
  settings: PosSettings,
): number {
  switch (actor.posRole) {
    case PosRole.CASHIER:
      return settings.cashierManualDiscountLimitMinor;
    case PosRole.SENIOR_CASHIER:
      return settings.seniorCashierManualDiscountLimitMinor;
    case PosRole.SUPERVISOR:
      return settings.supervisorManualDiscountLimitMinor;
    default:
      return settings.adminManualDiscountLimitMinor;
  }
}

function minutesSince(timestamp: Timestamp): number {
  return (Date.now() - timestamp.toDate().getTime()) / 60_000;
}

class PosSaleService {
  // ---------------------------------------------------------------- lectura

  async get(actor: PosActor, saleId: string): Promise<PosSale> {
    const sale = await posSaleRepository.requireById(saleId);
    posAuthorizationService.assertCanReadOwned(
      actor,
      sale.cashierUid,
      PosCapability.SHIFT_READ_ALL,
    );
    return sale;
  }

  async list(
    actor: PosActor,
    filters: {
      status?: PosSaleStatus;
      registerId?: string;
      shiftId?: string;
      sessionId?: string;
      cashierUid?: string;
      operationalDate?: OperationalDate;
      folio?: string;
      limit?: number;
      cursor?: string;
    },
  ): Promise<PosPageResult<PosSale>> {
    const settings = await posSettingsService.get();
    const limit = Math.min(
      filters.limit ?? settings.defaultPageSize,
      settings.maxPageSize,
    );
    const cashierUid = posAuthorizationService.scopeCashierFilter(
      actor,
      PosCapability.SHIFT_READ_ALL,
      filters.cashierUid,
    );

    const equals: Array<{ field: string; value: unknown }> = [];
    if (filters.status) equals.push({ field: "status", value: filters.status });
    if (filters.registerId) {
      equals.push({ field: "registerId", value: filters.registerId });
    }
    if (filters.sessionId) {
      equals.push({ field: "sessionId", value: filters.sessionId });
    }
    if (filters.operationalDate) {
      equals.push({ field: "operationalDate", value: filters.operationalDate });
    }
    if (filters.folio) equals.push({ field: "folio", value: filters.folio });
    if (cashierUid) equals.push({ field: "cashierUid", value: cashierUid });

    // Listados del turno activo (suspendidas, borradores): sin índice compuesto.
    if (filters.shiftId) {
      return posSaleRepository.listPageForShift({
        shiftId: filters.shiftId,
        status: filters.status,
        cashierUid: cashierUid ?? undefined,
        limit,
      });
    }

    // Histórico por fecha operativa (supervisión admin).
    if (filters.operationalDate) {
      return posSaleRepository.listPageForOperationalDate({
        operationalDate: filters.operationalDate,
        status: filters.status,
        registerId: filters.registerId,
        cashierUid: cashierUid ?? undefined,
        folio: filters.folio,
        limit,
      });
    }

    return posSaleRepository.list({
      limit,
      cursor: filters.cursor,
      orderByField: "createdAt",
      direction: "desc",
      equals,
    });
  }

  // ---------------------------------------------------------------- creación

  async create(
    actor: PosActor,
    input: { customerName?: string; note?: string },
    context: PosRequestContext | null,
  ): Promise<PosSale> {
    posAuthorizationService.requireCapability(actor, PosCapability.SALE_CREATE);
    const settings = await posSettingsService.get();
    const shift = await this.requireOwnActiveShift(actor);

    return runPosTransaction(async (transaction) => {
      const liveShift = await posShiftRepository.requireByIdInTransaction(
        transaction,
        shift.id,
      );
      if (liveShift.status !== PosShiftStatus.ACTIVE) {
        throw new PosProblemError("NO_ACTIVE_SHIFT");
      }

      const sequenceValue = await posFolioService.readValueInTransaction(
        transaction,
        "SALE",
        liveShift.operationalDate,
        liveShift.registerCode,
      );
      const folio = posFolioService.reserveInTransaction(
        transaction,
        "SALE",
        liveShift.operationalDate,
        sequenceValue,
        liveShift.registerCode,
      );

      const sale = posSaleRepository.createInTransaction(transaction, {
        storeId: POS_STORE_ID,
        folio,
        registerId: liveShift.registerId,
        registerCode: liveShift.registerCode,
        sessionId: liveShift.sessionId,
        shiftId: liveShift.id,
        cashierUid: actor.uid,
        operationalDate: liveShift.operationalDate,
        status: PosSaleStatus.DRAFT,
        items: [],
        totals: emptyTotals(),
        appliedCode: null,
        manualDiscount: null,
        payment: { ...EMPTY_PAYMENT_SUMMARY },
        customerName: sanitizeText(input.customerName, POS_TEXT_LIMITS.NAME_MAX),
        note: sanitizeText(input.note, settings.maxNoteLength),
        modificationCount: 0,
        reprintCount: 0,
        ticketToken: randomBytes(16).toString("hex"),
        cancelReason: null,
        voidReason: null,
        suspendedAt: null,
        paidAt: null,
        cancelledAt: null,
        voidedAt: null,
        inventoryCommitted: false,
      });

      posAuditService.recordInTransaction(transaction, {
        eventType: PosAuditEventType.SALE_CREATED,
        entity: PosAuditEntity.SALE,
        entityId: sale.id,
        actor,
        context,
        operationalDate: sale.operationalDate,
        registerId: sale.registerId,
        sessionId: sale.sessionId,
        shiftId: sale.shiftId,
        after: { folio: sale.folio, status: sale.status },
      });

      return sale;
    });
  }

  // ---------------------------------------------------------------- líneas

  async addItem(
    actor: PosActor,
    saleId: string,
    input: { productoId: string; tallaId?: string | null; quantity: number },
    context: PosRequestContext | null,
  ): Promise<SaleWithChanges> {
    posAuthorizationService.requireCapability(actor, PosCapability.SALE_CREATE);
    const settings = await posSettingsService.get();
    const sale = await this.requireEditableSale(actor, saleId);

    if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
      throw new PosProblemError(
        "POS_VALIDATION_ERROR",
        "La cantidad debe ser un entero mayor a cero.",
      );
    }
    if (input.quantity > settings.maxQuantityPerLine) {
      throw new PosProblemError(
        "SALE_LIMIT_EXCEEDED",
        `La cantidad máxima por línea es ${settings.maxQuantityPerLine}.`,
      );
    }

    const tallaId = input.tallaId ?? null;
    const existing = sale.items.find(
      (item) => item.productoId === input.productoId && item.tallaId === tallaId,
    );

    let drafts: SaleLineDraft[];
    if (existing) {
      const nextQuantity = existing.quantity + input.quantity;
      if (nextQuantity > settings.maxQuantityPerLine) {
        throw new PosProblemError(
          "SALE_LIMIT_EXCEEDED",
          `La cantidad máxima por línea es ${settings.maxQuantityPerLine}.`,
        );
      }
      drafts = sale.items.map((item) =>
        item.itemId === existing.itemId
          ? { itemId: item.itemId, productoId: item.productoId, tallaId: item.tallaId, quantity: nextQuantity }
          : toDraft(item),
      );
    } else {
      if (sale.items.length + 1 > settings.maxLinesPerSale) {
        throw new PosProblemError(
          "SALE_LIMIT_EXCEEDED",
          `La venta admite un máximo de ${settings.maxLinesPerSale} líneas.`,
        );
      }
      drafts = [
        ...sale.items.map(toDraft),
        {
          itemId: randomUUID(),
          productoId: input.productoId,
          tallaId,
          quantity: input.quantity,
        },
      ];
    }

    return this.applyRecalculation(actor, sale, drafts, settings, context, {
      eventType: PosAuditEventType.SALE_UPDATED,
      reason: null,
      enforceAvailability: true,
    });
  }

  async updateItem(
    actor: PosActor,
    saleId: string,
    itemId: string,
    input: { quantity: number },
    context: PosRequestContext | null,
  ): Promise<SaleWithChanges> {
    posAuthorizationService.requireCapability(actor, PosCapability.SALE_CREATE);
    const settings = await posSettingsService.get();
    const sale = await this.requireEditableSale(actor, saleId);

    if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
      throw new PosProblemError(
        "POS_VALIDATION_ERROR",
        "La cantidad debe ser un entero mayor a cero.",
      );
    }
    if (input.quantity > settings.maxQuantityPerLine) {
      throw new PosProblemError(
        "SALE_LIMIT_EXCEEDED",
        `La cantidad máxima por línea es ${settings.maxQuantityPerLine}.`,
      );
    }
    if (!sale.items.some((item) => item.itemId === itemId)) {
      throw new PosProblemError("SALE_ITEM_NOT_FOUND");
    }

    const drafts = sale.items.map((item) =>
      item.itemId === itemId
        ? { ...toDraft(item), quantity: input.quantity }
        : toDraft(item),
    );

    return this.applyRecalculation(actor, sale, drafts, settings, context, {
      eventType: PosAuditEventType.SALE_UPDATED,
      reason: null,
      enforceAvailability: true,
    });
  }

  async removeItem(
    actor: PosActor,
    saleId: string,
    itemId: string,
    context: PosRequestContext | null,
  ): Promise<SaleWithChanges> {
    posAuthorizationService.requireCapability(actor, PosCapability.SALE_CREATE);
    const settings = await posSettingsService.get();
    const sale = await this.requireEditableSale(actor, saleId);

    if (!sale.items.some((item) => item.itemId === itemId)) {
      throw new PosProblemError("SALE_ITEM_NOT_FOUND");
    }

    const drafts = sale.items
      .filter((item) => item.itemId !== itemId)
      .map(toDraft);

    return this.applyRecalculation(actor, sale, drafts, settings, context, {
      eventType: PosAuditEventType.SALE_UPDATED,
      reason: null,
      enforceAvailability: false,
    });
  }

  /** Revalidación explícita contra catálogo, ofertas, código e inventario. */
  async reprice(
    actor: PosActor,
    saleId: string,
    context: PosRequestContext | null,
  ): Promise<SaleWithChanges> {
    posAuthorizationService.requireCapability(actor, PosCapability.SALE_CREATE);
    const settings = await posSettingsService.get();
    const sale = await this.requireEditableSale(actor, saleId);

    return this.applyRecalculation(
      actor,
      sale,
      sale.items.map(toDraft),
      settings,
      context,
      {
        eventType: PosAuditEventType.SALE_UPDATED,
        reason: null,
        enforceAvailability: false,
      },
    );
  }

  // ---------------------------------------------------------------- descuentos

  async applyCode(
    actor: PosActor,
    saleId: string,
    codigo: string,
    context: PosRequestContext | null,
  ): Promise<SaleWithChanges> {
    posAuthorizationService.requireCapability(actor, PosCapability.SALE_CREATE);
    const settings = await posSettingsService.get();
    const sale = await this.requireEditableSale(actor, saleId);

    const normalized = codigo.trim().toUpperCase();
    if (normalized.length === 0) {
      throw new PosProblemError("PROMOTION_CODE_INVALID");
    }
    if (sale.items.length === 0) {
      throw new PosProblemError("SALE_EMPTY");
    }

    return this.applyRecalculation(
      actor,
      sale,
      sale.items.map(toDraft),
      settings,
      context,
      {
        eventType: PosAuditEventType.SALE_CODE_APPLIED,
        reason: null,
        enforceAvailability: false,
        overrideCode: normalized,
        // Un código inválido debe fallar la petición, no removerse en silencio.
        strictCode: true,
      },
    );
  }

  async removeCode(
    actor: PosActor,
    saleId: string,
    context: PosRequestContext | null,
  ): Promise<SaleWithChanges> {
    posAuthorizationService.requireCapability(actor, PosCapability.SALE_CREATE);
    const settings = await posSettingsService.get();
    const sale = await this.requireEditableSale(actor, saleId);

    if (!sale.appliedCode) {
      throw new PosProblemError(
        "PROMOTION_CODE_INVALID",
        "La venta no tiene un código aplicado.",
      );
    }

    return this.applyRecalculation(
      actor,
      sale,
      sale.items.map(toDraft),
      settings,
      context,
      {
        eventType: PosAuditEventType.SALE_CODE_REMOVED,
        reason: null,
        enforceAvailability: false,
        removeCode: true,
      },
    );
  }

  /**
   * Descuento manual autorizado. El solicitante nunca puede autorizar por encima de su
   * límite: si lo excede debe intervenir otro actor con capacidad y límite suficiente.
   */
  async applyManualDiscount(
    actor: PosActor,
    saleId: string,
    input: {
      amountMinor?: number;
      percent?: number;
      reason: string;
      authorizedBy?: string;
    },
    context: PosRequestContext | null,
  ): Promise<SaleWithChanges> {
    posAuthorizationService.requireCapability(
      actor,
      PosCapability.SALE_DISCOUNT_MANUAL,
    );
    const settings = await posSettingsService.get();
    const sale = await this.requireEditableSale(actor, saleId);

    if (sale.items.length === 0) {
      throw new PosProblemError("SALE_EMPTY");
    }
    const reason = assertReason(input.reason);

    const baseMinor = sale.totals.subtotalOriginalMinor
      - sale.totals.offerDiscountMinor
      - sale.totals.codeDiscountMinor;

    let amountMinor: number;
    let percent: number | null = null;
    if (input.percent !== undefined) {
      if (
        !Number.isFinite(input.percent) ||
        input.percent <= 0 ||
        input.percent > settings.manualDiscountMaxPercent
      ) {
        throw new PosProblemError(
          "MANUAL_DISCOUNT_LIMIT_EXCEEDED",
          `El porcentaje debe estar entre 0 y ${settings.manualDiscountMaxPercent}.`,
        );
      }
      percent = input.percent;
      amountMinor = percentOfMinor(baseMinor, input.percent);
    } else {
      amountMinor = assertNonNegativeMinor(input.amountMinor, "amountMinor");
    }
    if (amountMinor <= 0) {
      throw new PosProblemError(
        "POS_VALIDATION_ERROR",
        "El descuento manual debe ser mayor a cero.",
      );
    }

    const authorizerUid = await this.resolveDiscountAuthorizer(
      actor,
      amountMinor,
      settings,
      input.authorizedBy,
    );

    return this.applyRecalculation(
      actor,
      sale,
      sale.items.map(toDraft),
      settings,
      context,
      {
        eventType: PosAuditEventType.SALE_MANUAL_DISCOUNT_APPLIED,
        reason,
        enforceAvailability: false,
        manualDiscount: {
          amountMinor,
          percent,
          reason,
          requestedBy: actor.uid,
          authorizedBy: authorizerUid,
          appliedAt: nowTimestamp(),
        },
      },
    );
  }

  // ---------------------------------------------------------------- estados

  async suspend(
    actor: PosActor,
    saleId: string,
    context: PosRequestContext | null,
  ): Promise<PosSale> {
    posAuthorizationService.requireCapability(actor, PosCapability.SALE_SUSPEND);
    const current = await posSaleRepository.requireById(saleId);
    if (
      current.status === PosSaleStatus.PAYMENT_PENDING &&
      current.payment.paidMinor === 0
    ) {
      await this.returnToDraft(actor, saleId, context);
    }
    return this.transition(actor, saleId, "suspend", context, {
      eventType: PosAuditEventType.SALE_SUSPENDED,
      patch: { suspendedAt: nowTimestamp() },
    });
  }

  /**
   * Reanuda una venta suspendida y la revalida: precios, promociones e inventario pueden
   * haber cambiado mientras estuvo guardada (Flujo C).
   */
  async resume(
    actor: PosActor,
    saleId: string,
    context: PosRequestContext | null,
  ): Promise<SaleWithChanges> {
    posAuthorizationService.requireCapability(actor, PosCapability.SALE_RESUME);
    const settings = await posSettingsService.get();
    const sale = await posSaleRepository.requireById(saleId);
    await this.assertOwnedByOperableShift(actor, sale);

    if (sale.status !== PosSaleStatus.SUSPENDED) {
      throw new PosProblemError("SALE_NOT_EDITABLE");
    }
    if (
      sale.suspendedAt &&
      minutesSince(sale.suspendedAt) > settings.suspendedSaleTtlMinutes
    ) {
      throw new PosProblemError(
        "SALE_NOT_EDITABLE",
        "La venta suspendida excedió su vigencia y debe cancelarse.",
      );
    }

    const target = assertTransition("sale", "resume", sale.status) as PosSaleStatus;
    return this.applyRecalculation(
      actor,
      sale,
      sale.items.map(toDraft),
      settings,
      context,
      {
        eventType: PosAuditEventType.SALE_RESUMED,
        reason: null,
        enforceAvailability: false,
        nextStatus: target,
        extraPatch: { suspendedAt: null },
        allowedStatuses: [PosSaleStatus.SUSPENDED],
      },
    );
  }

  async cancel(
    actor: PosActor,
    saleId: string,
    reason: string,
    context: PosRequestContext | null,
  ): Promise<PosSale> {
    posAuthorizationService.requireCapability(
      actor,
      PosCapability.SALE_CANCEL_UNPAID,
    );
    const validReason = assertReason(reason);
    return this.transition(actor, saleId, "cancel", context, {
      eventType: PosAuditEventType.SALE_CANCELLED,
      reason: validReason,
      patch: { cancelReason: validReason, cancelledAt: nowTimestamp() },
      // Una venta con pagos aprobados no se cancela: se anula o se devuelve.
      forbidWhenPaid: true,
    });
  }

  /**
   * Revalidación final antes de cobrar. Cuando detecta cambios los persiste y responde 409:
   * el cajero debe revisar la venta y volver a confirmar. Sin cambios, la venta pasa a
   * `PAYMENT_PENDING` y queda lista para registrar pagos.
   */
  async checkoutPreview(
    actor: PosActor,
    saleId: string,
    context: PosRequestContext | null,
  ): Promise<CheckoutPreview> {
    posAuthorizationService.requireCapability(actor, PosCapability.SALE_CREATE);
    const settings = await posSettingsService.get();
    const sale = await posSaleRepository.requireById(saleId);
    await this.assertOwnedByOperableShift(actor, sale);

    if (sale.status === PosSaleStatus.PAYMENT_PENDING) {
      return {
        sale,
        changes: [],
        pendingMinor: sale.totals.totalMinor - sale.payment.paidMinor,
        allowedMethods: await this.allowedMethods(sale),
      };
    }
    if (sale.status !== PosSaleStatus.DRAFT) {
      throw new PosProblemError("SALE_NOT_EDITABLE");
    }
    if (sale.items.length === 0) {
      throw new PosProblemError("SALE_EMPTY");
    }
    if (minutesSince(sale.createdAt) > settings.draftSaleTtlMinutes) {
      throw new PosProblemError(
        "SALE_NOT_EDITABLE",
        "El borrador excedió su vigencia. Crea una venta nueva.",
      );
    }
    if (sale.totals.totalMinor > settings.maxSaleTotalMinor) {
      throw new PosProblemError(
        "SALE_LIMIT_EXCEEDED",
        "El total de la venta excede el límite configurado.",
      );
    }

    const recalculated = await this.recalculate(
      sale,
      sale.items.map(toDraft),
      settings,
      {},
    );

    if (recalculated.changes.length > 0) {
      // Se persiste el estado corregido para que el cajero vea la venta real y decida.
      const updated = await this.persist(actor, sale, recalculated, context, {
        eventType: PosAuditEventType.SALE_UPDATED,
        reason: "Revalidación previa al cobro",
      });
      throw new PosProblemError(
        recalculated.changes.some((change) => change.code === "PROMOTION_CHANGED")
          ? "PROMOTION_CHANGED"
          : recalculated.changes.some((change) => change.code === "PRICE_CHANGED")
            ? "PRICE_CHANGED"
            : "INSUFFICIENT_STOCK",
        "La venta cambió al revalidarla. Revisa el detalle y confirma de nuevo.",
        {
          changes: recalculated.changes,
          totals: updated.sale.totals,
        },
      );
    }

    const unavailable = await this.findAvailabilityIssues(
      recalculated.items,
      recalculated.products,
    );
    if (unavailable.length > 0) {
      throw new PosProblemError(
        "INSUFFICIENT_STOCK",
        "No hay existencias suficientes para cobrar la venta.",
        { items: unavailable },
      );
    }

    const target = assertTransition("sale", "checkout", sale.status) as PosSaleStatus;
    const updated = await runPosTransaction(async (transaction) => {
      const live = await posSaleRepository.requireByIdInTransaction(
        transaction,
        sale.id,
      );
      if (live.version !== sale.version) {
        throw new PosProblemError("CONCURRENT_MODIFICATION");
      }
      posSaleRepository.updateInTransaction(
        transaction,
        sale.id,
        {
          status: target,
          payment: {
            ...live.payment,
            pendingMinor: live.totals.totalMinor - live.payment.paidMinor,
          },
        },
        live.version,
      );
      posAuditService.recordInTransaction(transaction, {
        eventType: PosAuditEventType.SALE_CHECKOUT_STARTED,
        entity: PosAuditEntity.SALE,
        entityId: sale.id,
        actor,
        context,
        operationalDate: sale.operationalDate,
        registerId: sale.registerId,
        sessionId: sale.sessionId,
        shiftId: sale.shiftId,
        before: { status: live.status },
        after: { status: target, totalMinor: live.totals.totalMinor },
      });
      return {
        ...live,
        status: target,
        version: live.version + 1,
      } as PosSale;
    });

    return {
      sale: updated,
      changes: [],
      pendingMinor: updated.totals.totalMinor - updated.payment.paidMinor,
      allowedMethods: await this.allowedMethods(updated),
    };
  }

  /**
   * Revierte `PAYMENT_PENDING` a `DRAFT` cuando aún no hay pagos aplicados.
   *
   * Cubre el caso del cajero que abre el cobro, cancela el modal y quiere seguir
   * editando el carrito. Si ya hay efectivo/tarjeta aplicados (`paidMinor > 0`),
   * no se permite: hay que cancelar esos pagos primero.
   */
  async returnToDraft(
    actor: PosActor,
    saleId: string,
    context: PosRequestContext | null,
  ): Promise<PosSale> {
    posAuthorizationService.requireCapability(actor, PosCapability.SALE_CREATE);
    const sale = await posSaleRepository.requireById(saleId);
    await this.assertOwnedByOperableShift(actor, sale);

    if (sale.status === PosSaleStatus.DRAFT) {
      return sale;
    }

    const target = assertTransition(
      "sale",
      "return-to-draft",
      sale.status,
    ) as PosSaleStatus;

    if (sale.payment.paidMinor > 0) {
      throw new PosProblemError(
        "SALE_PAYMENT_INCOMPLETE",
        "Hay pagos aplicados. Cancélalos o completa el cobro antes de editar la venta.",
      );
    }

    return runPosTransaction(async (transaction) => {
      const live = await posSaleRepository.requireByIdInTransaction(
        transaction,
        sale.id,
      );
      if (live.status === PosSaleStatus.DRAFT) {
        return live;
      }
      if (live.status !== PosSaleStatus.PAYMENT_PENDING) {
        throw new PosProblemError("SALE_NOT_EDITABLE");
      }
      if (live.payment.paidMinor > 0) {
        throw new PosProblemError(
          "SALE_PAYMENT_INCOMPLETE",
          "Hay pagos aplicados. Cancélalos o completa el cobro antes de editar la venta.",
        );
      }

      posSaleRepository.updateInTransaction(
        transaction,
        sale.id,
        {
          status: target,
          payment: {
            ...live.payment,
            pendingMinor: live.totals.totalMinor,
          },
        },
        live.version,
      );
      posAuditService.recordInTransaction(transaction, {
        eventType: PosAuditEventType.SALE_RETURNED_TO_DRAFT,
        entity: PosAuditEntity.SALE,
        entityId: sale.id,
        actor,
        context,
        operationalDate: sale.operationalDate,
        registerId: sale.registerId,
        sessionId: sale.sessionId,
        shiftId: sale.shiftId,
        before: { status: live.status },
        after: { status: target },
        reason: "Cobro cancelado; la venta vuelve a ser editable",
      });

      return {
        ...live,
        status: target,
        payment: {
          ...live.payment,
          pendingMinor: live.totals.totalMinor,
        },
        version: live.version + 1,
      } as PosSale;
    });
  }

  // ---------------------------------------------------------------- internos

  /** Turno propio en estado ACTIVE. Ninguna venta puede operarse sin él. */
  private async requireOwnActiveShift(actor: PosActor): Promise<PosShift> {
    const shift = await posShiftRepository.findActiveByCashier(actor.uid);
    if (!shift || shift.status !== PosShiftStatus.ACTIVE) {
      throw new PosProblemError("NO_ACTIVE_SHIFT");
    }
    return shift;
  }

  /**
   * Una venta solo puede modificarla su propio cajero, con su turno activo.
   * Un supervisor puede leerla, pero no operarla en nombre del cajero.
   */
  private async assertOwnedByOperableShift(
    actor: PosActor,
    sale: PosSale,
  ): Promise<PosShift> {
    if (sale.cashierUid !== actor.uid) {
      throw new PosProblemError("POS_RESOURCE_NOT_FOUND");
    }
    const shift = await this.requireOwnActiveShift(actor);
    if (shift.id !== sale.shiftId) {
      throw new PosProblemError(
        "NO_ACTIVE_SHIFT",
        "La venta pertenece a un turno distinto del activo.",
      );
    }
    return shift;
  }

  private async requireEditableSale(
    actor: PosActor,
    saleId: string,
  ): Promise<PosSale> {
    const sale = await posSaleRepository.requireById(saleId);
    await this.assertOwnedByOperableShift(actor, sale);
    if (
      sale.status === PosSaleStatus.PAYMENT_PENDING &&
      sale.payment.paidMinor === 0
    ) {
      // El cajero abrió el cobro y volvió al carrito: desbloqueamos sin fricción.
      return this.returnToDraft(actor, saleId, null);
    }
    if (sale.status !== PosSaleStatus.DRAFT) {
      throw new PosProblemError("SALE_NOT_EDITABLE");
    }
    return sale;
  }

  private async allowedMethods(sale: PosSale): Promise<PosPaymentMethod[]> {
    const register = await posRegisterRepository.getById(sale.registerId);
    const methods: PosPaymentMethod[] = [];
    if (register?.config.allowCash !== false) methods.push(PosPaymentMethod.CASH);
    if (register?.config.allowCardExternal !== false) {
      methods.push(PosPaymentMethod.CARD_EXTERNAL);
    }
    return methods;
  }

  private async resolveDiscountAuthorizer(
    actor: PosActor,
    amountMinor: number,
    settings: PosSettings,
    authorizedBy?: string,
  ): Promise<string> {
    const ownLimit = manualDiscountLimitFor(actor, settings);
    if (amountMinor <= ownLimit) {
      return actor.uid;
    }
    if (!authorizedBy) {
      throw new PosProblemError(
        "AUTHORIZER_REQUIRED",
        "El descuento excede tu límite y requiere autorización de un supervisor.",
      );
    }
    if (authorizedBy === actor.uid) {
      throw new PosProblemError("SELF_APPROVAL_FORBIDDEN");
    }

    // El autorizador se valida contra su propio registro de operador: el cliente solo envía
    // el UID, nunca el rol ni el límite.
    const authorizer = await posAuthorizationService.resolveActorByUid(authorizedBy);
    posAuthorizationService.requireCapability(
      authorizer,
      PosCapability.SALE_DISCOUNT_MANUAL,
    );
    if (amountMinor > manualDiscountLimitFor(authorizer, settings)) {
      throw new PosProblemError("MANUAL_DISCOUNT_LIMIT_EXCEEDED");
    }
    return authorizer.uid;
  }

  private async findAvailabilityIssues(
    items: readonly PosSaleItem[],
    products: Map<string, PosProductSnapshot>,
  ): Promise<SaleAvailabilityIssue[]> {
    const required = new Map<string, { item: PosSaleItem; quantity: number }>();
    for (const item of items) {
      const key = `${item.productoId}::${item.tallaId ?? ""}`;
      const current = required.get(key);
      required.set(key, {
        item,
        quantity: (current?.quantity ?? 0) + item.quantity,
      });
    }

    const issues: SaleAvailabilityIssue[] = [];
    for (const entry of required.values()) {
      const product = products.get(entry.item.productoId);
      const available = product
        ? posInventoryService.availableFor(product, entry.item.tallaId)
        : 0;
      if (available < entry.quantity) {
        issues.push({
          itemId: entry.item.itemId,
          productoId: entry.item.productoId,
          tallaId: entry.item.tallaId,
          requested: entry.quantity,
          available,
        });
      }
    }
    return issues;
  }

  /**
   * Recalcula la venta completa contra el catálogo y devuelve los nuevos snapshots junto con
   * la lista de cambios detectados. No escribe nada.
   */
  private async recalculate(
    sale: PosSale,
    drafts: readonly SaleLineDraft[],
    settings: PosSettings,
    options: {
      overrideCode?: string;
      removeCode?: boolean;
      strictCode?: boolean;
      manualDiscount?: PosSale["manualDiscount"];
    },
  ): Promise<RecalculationResult> {
    const changes: SaleChange[] = [];
    const products = await posInventoryService.loadProducts(
      drafts.map((draft) => draft.productoId),
    );
    const offers = await posPricingService.loadActiveOffers();
    const sizeCodes = await posInventoryService.loadSizeCodes(
      drafts.map((draft) => draft.tallaId).filter((id): id is string => Boolean(id)),
    );

    const priced = posPricingService.priceLines(drafts, products, offers);

    // Comparación contra el snapshot previo para informar cambios reales de catálogo.
    for (const line of priced) {
      const previous = sale.items.find((item) => item.itemId === line.itemId);
      if (!previous) continue;
      if (previous.unitPriceOriginalMinor !== line.unitPriceOriginalMinor) {
        changes.push({
          code: "PRICE_CHANGED",
          itemId: line.itemId,
          message: "El precio público del producto cambió.",
          beforeMinor: previous.unitPriceOriginalMinor,
          afterMinor: line.unitPriceOriginalMinor,
        });
      }
      if (
        previous.offerId !== line.offerId ||
        previous.unitPriceMinor !== line.unitPriceMinor
      ) {
        changes.push({
          code: "PROMOTION_CHANGED",
          itemId: line.itemId,
          message: "La oferta aplicable al producto cambió.",
          beforeMinor: previous.unitPriceMinor,
          afterMinor: line.unitPriceMinor,
        });
      }
    }

    let appliedCode = sale.appliedCode;
    let codeDiscountPerLine = priced.map(() => 0);

    const requestedCode = options.removeCode
      ? null
      : (options.overrideCode ?? sale.appliedCode?.codigo ?? null);

    if (options.removeCode && sale.appliedCode) {
      appliedCode = null;
      changes.push({
        code: "CODE_REMOVED",
        itemId: null,
        message: "Se retiró el código promocional.",
        beforeMinor: sale.appliedCode.discountMinor,
        afterMinor: 0,
      });
    } else if (requestedCode && priced.length > 0) {
      try {
        const result = await posPricingService.validateCode(
          requestedCode,
          priced,
          products,
        );
        codeDiscountPerLine = result.perLineMinor;
        appliedCode = {
          codigoPromocionId: result.codigoPromocionId,
          codigo: result.codigo,
          titulo: result.titulo,
          discountMinor: result.totalDiscountMinor,
          appliedBy: sale.appliedCode?.appliedBy ?? sale.cashierUid,
          appliedAt: sale.appliedCode?.appliedAt ?? nowTimestamp(),
        };
        if (
          sale.appliedCode &&
          sale.appliedCode.discountMinor !== result.totalDiscountMinor
        ) {
          changes.push({
            code: "PROMOTION_CHANGED",
            itemId: null,
            message: "El descuento del código promocional cambió.",
            beforeMinor: sale.appliedCode.discountMinor,
            afterMinor: result.totalDiscountMinor,
          });
        }
      } catch (error) {
        if (options.strictCode) {
          throw error;
        }
        // El código dejó de ser válido (venció, se agotó o ya no aplica): se retira y se
        // informa, en lugar de conservar un descuento inexistente.
        appliedCode = null;
        codeDiscountPerLine = priced.map(() => 0);
        if (sale.appliedCode) {
          changes.push({
            code: "CODE_REMOVED",
            itemId: null,
            message:
              error instanceof PosProblemError
                ? error.message
                : "El código promocional dejó de ser válido.",
            beforeMinor: sale.appliedCode.discountMinor,
            afterMinor: 0,
          });
        }
      }
    } else if (requestedCode && priced.length === 0) {
      appliedCode = null;
    }

    const manualDiscount =
      options.manualDiscount !== undefined
        ? options.manualDiscount
        : sale.manualDiscount;

    const linesForTotals = priced.map((line, index) => ({
      itemId: line.itemId,
      quantity: line.quantity,
      unitPriceOriginalMinor: line.unitPriceOriginalMinor,
      unitPriceMinor: line.unitPriceMinor,
      offerDiscountMinor: line.offerDiscountMinor,
      codeDiscountMinor: codeDiscountPerLine[index] ?? 0,
    }));

    const baseAfterCode = linesForTotals.reduce(
      (total, line) =>
        total + line.unitPriceMinor * line.quantity - line.codeDiscountMinor,
      0,
    );

    let manualAmountMinor = manualDiscount?.amountMinor ?? 0;
    if (manualDiscount && manualDiscount.percent !== null) {
      manualAmountMinor = percentOfMinor(baseAfterCode, manualDiscount.percent);
    }
    if (manualAmountMinor > baseAfterCode) {
      changes.push({
        code: "MANUAL_DISCOUNT_ADJUSTED",
        itemId: null,
        message: "El descuento manual se ajustó al nuevo importe de la venta.",
        beforeMinor: manualAmountMinor,
        afterMinor: baseAfterCode,
      });
      manualAmountMinor = baseAfterCode;
    }

    const computed = computeSaleTotals(linesForTotals, manualAmountMinor);

    const items: PosSaleItem[] = priced.map((line, index) => {
      const previous = sale.items.find((item) => item.itemId === line.itemId);
      const product = products.get(line.productoId);
      const computedLine = computed.lines[index];
      return {
        itemId: line.itemId,
        productoId: line.productoId,
        clave: product?.clave ?? previous?.clave ?? "",
        descripcion: product?.descripcion ?? previous?.descripcion ?? "",
        // El catálogo ecommerce no maneja código de barras; se conserva el campo para
        // compatibilidad con lectores y se llena con la clave del producto.
        barcode: product?.clave ?? previous?.barcode ?? null,
        tallaId: line.tallaId,
        tallaCodigo: line.tallaId
          ? (sizeCodes.get(line.tallaId) ?? previous?.tallaCodigo ?? null)
          : null,
        quantity: line.quantity,
        unitPriceOriginalMinor: line.unitPriceOriginalMinor,
        unitPriceMinor: line.unitPriceMinor,
        offerDiscountMinor: line.offerDiscountMinor,
        codeDiscountMinor: codeDiscountPerLine[index] ?? 0,
        manualDiscountMinor: computedLine.manualDiscountMinor,
        taxMinor: computedLine.taxMinor,
        lineTotalMinor: computedLine.lineTotalMinor,
        offerId: line.offerId,
        offerTitle: line.offerTitle,
        returnedQuantity: previous?.returnedQuantity ?? 0,
        refundedMinor: previous?.refundedMinor ?? 0,
        createdAt: previous?.createdAt ?? nowTimestamp(),
        updatedAt: nowTimestamp(),
      };
    });

    if (computed.totals.totalMinor > settings.maxSaleTotalMinor) {
      throw new PosProblemError(
        "SALE_LIMIT_EXCEEDED",
        "El total de la venta excede el límite configurado.",
      );
    }

    return {
      items,
      totals: computed.totals,
      appliedCode,
      manualDiscount: manualDiscount
        ? { ...manualDiscount, amountMinor: manualAmountMinor }
        : null,
      changes,
      products,
    };
  }

  private async applyRecalculation(
    actor: PosActor,
    sale: PosSale,
    drafts: readonly SaleLineDraft[],
    settings: PosSettings,
    context: PosRequestContext | null,
    options: {
      eventType: PosAuditEventType;
      reason: string | null;
      enforceAvailability: boolean;
      overrideCode?: string;
      removeCode?: boolean;
      strictCode?: boolean;
      manualDiscount?: PosSale["manualDiscount"];
      nextStatus?: PosSaleStatus;
      extraPatch?: Record<string, unknown>;
      allowedStatuses?: PosSaleStatus[];
    },
  ): Promise<SaleWithChanges> {
    if (sale.modificationCount >= settings.maxSaleModifications) {
      throw new PosProblemError(
        "SALE_LIMIT_EXCEEDED",
        "La venta alcanzó el número máximo de modificaciones.",
      );
    }

    const recalculated = await this.recalculate(sale, drafts, settings, {
      overrideCode: options.overrideCode,
      removeCode: options.removeCode,
      strictCode: options.strictCode,
      manualDiscount: options.manualDiscount,
    });

    if (options.enforceAvailability) {
      const issues = await this.findAvailabilityIssues(
        recalculated.items,
        recalculated.products,
      );
      if (issues.length > 0) {
        throw new PosProblemError(
          "INSUFFICIENT_STOCK",
          "No hay existencias suficientes para la cantidad solicitada.",
          { items: issues },
        );
      }
    }

    return this.persist(actor, sale, recalculated, context, {
      eventType: options.eventType,
      reason: options.reason,
      nextStatus: options.nextStatus,
      extraPatch: options.extraPatch,
      allowedStatuses: options.allowedStatuses,
    });
  }

  private async persist(
    actor: PosActor,
    sale: PosSale,
    recalculated: RecalculationResult,
    context: PosRequestContext | null,
    options: {
      eventType: PosAuditEventType;
      reason: string | null;
      nextStatus?: PosSaleStatus;
      extraPatch?: Record<string, unknown>;
      allowedStatuses?: PosSaleStatus[];
    },
  ): Promise<SaleWithChanges> {
    const allowed = options.allowedStatuses ?? [PosSaleStatus.DRAFT];

    const updated = await runPosTransaction(async (transaction) => {
      const live = await posSaleRepository.requireByIdInTransaction(
        transaction,
        sale.id,
      );
      if (live.version !== sale.version) {
        throw new PosProblemError("CONCURRENT_MODIFICATION");
      }
      if (!allowed.includes(live.status)) {
        throw new PosProblemError("SALE_NOT_EDITABLE");
      }

      const patch: Record<string, unknown> = {
        items: recalculated.items,
        totals: recalculated.totals,
        appliedCode: recalculated.appliedCode,
        manualDiscount: recalculated.manualDiscount,
        modificationCount: live.modificationCount + 1,
        payment: {
          ...live.payment,
          pendingMinor: Math.max(
            0,
            recalculated.totals.totalMinor - live.payment.paidMinor,
          ),
        },
        ...(options.nextStatus ? { status: options.nextStatus } : {}),
        ...(options.extraPatch ?? {}),
      };

      posSaleRepository.updateInTransaction(
        transaction,
        sale.id,
        patch,
        live.version,
      );

      posAuditService.recordInTransaction(transaction, {
        eventType: options.eventType,
        entity: PosAuditEntity.SALE,
        entityId: sale.id,
        actor,
        context,
        operationalDate: sale.operationalDate,
        registerId: sale.registerId,
        sessionId: sale.sessionId,
        shiftId: sale.shiftId,
        before: {
          status: live.status,
          totalMinor: live.totals.totalMinor,
          itemCount: live.items.length,
        },
        after: {
          status: options.nextStatus ?? live.status,
          totalMinor: recalculated.totals.totalMinor,
          itemCount: recalculated.items.length,
          appliedCode: recalculated.appliedCode?.codigo ?? null,
          manualDiscountMinor: recalculated.totals.manualDiscountMinor,
        },
        reason: options.reason,
      });

      return {
        ...live,
        items: recalculated.items,
        totals: recalculated.totals,
        appliedCode: recalculated.appliedCode,
        manualDiscount: recalculated.manualDiscount,
        modificationCount: live.modificationCount + 1,
        status: options.nextStatus ?? live.status,
        version: live.version + 1,
      } as PosSale;
    });

    return { sale: updated, changes: recalculated.changes };
  }

  private async transition(
    actor: PosActor,
    saleId: string,
    action: "suspend" | "cancel",
    context: PosRequestContext | null,
    options: {
      eventType: PosAuditEventType;
      reason?: string | null;
      patch: Record<string, unknown>;
      forbidWhenPaid?: boolean;
    },
  ): Promise<PosSale> {
    const sale = await posSaleRepository.requireById(saleId);
    await this.assertOwnedByOperableShift(actor, sale);

    return runPosTransaction(async (transaction) => {
      const live = await posSaleRepository.requireByIdInTransaction(
        transaction,
        saleId,
      );
      const target = assertTransition("sale", action, live.status) as PosSaleStatus;
      if (options.forbidWhenPaid && live.payment.paidMinor > 0) {
        throw new PosProblemError(
          "SALE_ALREADY_PAID",
          "La venta tiene pagos aprobados: usa anulación o devolución.",
        );
      }

      posSaleRepository.updateInTransaction(
        transaction,
        saleId,
        { status: target, ...options.patch },
        live.version,
      );

      posAuditService.recordInTransaction(transaction, {
        eventType: options.eventType,
        entity: PosAuditEntity.SALE,
        entityId: saleId,
        actor,
        context,
        operationalDate: live.operationalDate,
        registerId: live.registerId,
        sessionId: live.sessionId,
        shiftId: live.shiftId,
        before: { status: live.status },
        after: { status: target },
        reason: options.reason ?? null,
      });

      return { ...live, status: target, version: live.version + 1 } as PosSale;
    });
  }
}

interface SaleLineDraft {
  itemId: string;
  productoId: string;
  tallaId: string | null;
  quantity: number;
}

interface RecalculationResult {
  items: PosSaleItem[];
  totals: PosSaleTotals;
  appliedCode: PosSale["appliedCode"];
  manualDiscount: PosSale["manualDiscount"];
  changes: SaleChange[];
  products: Map<string, PosProductSnapshot>;
}

function toDraft(item: PosSaleItem): SaleLineDraft {
  return {
    itemId: item.itemId,
    productoId: item.productoId,
    tallaId: item.tallaId,
    quantity: item.quantity,
  };
}

function emptyTotals(): PosSaleTotals {
  return {
    subtotalOriginalMinor: 0,
    offerDiscountMinor: 0,
    codeDiscountMinor: 0,
    manualDiscountMinor: 0,
    discountMinor: 0,
    subtotalMinor: 0,
    taxMinor: 0,
    totalMinor: 0,
  };
}

export const posSaleService = new PosSaleService();
export default posSaleService;
