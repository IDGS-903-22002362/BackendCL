/**
 * Pagos del POS: efectivo, tarjeta en terminal externa y pago mixto.
 *
 * Garantías:
 *
 * - Un pago nunca se aplica dos veces: la idempotencia se resuelve en el controlador y, en el
 *   fondo, el importe pendiente se recalcula dentro de la transacción a partir de los pagos
 *   aprobados reales, así que un segundo intento sobre una venta ya cubierta falla con
 *   `SALE_ALREADY_PAID`.
 * - La venta pasa a `PAID`, el inventario se descuenta y el ledger de efectivo se escribe en
 *   una sola transacción de Firestore. No existe venta pagada sin descuento de inventario ni
 *   descuento sin venta pagada.
 * - Un pago mixto genera dos registros de pago y una sola venta: los reportes suman por
 *   método sin duplicar el total.
 * - Nunca se almacena PAN, CVV, fecha de vencimiento, banda ni PIN. De la tarjeta solo se
 *   guarda terminal, referencia, código de autorización, marca y últimos cuatro dígitos.
 *
 * Abstracción de proveedor: `PosPaymentMethod.CARD_EXTERNAL` representa una operación ya
 * aprobada en una terminal física. La interfaz `CardTerminalOperation` deja preparado el
 * terreno para una terminal integrada sin acoplar el dominio a un proveedor.
 */

import { POS_TEXT_LIMITS } from "../constants/pos.constants";
import { assertNonNegativeMinor } from "../domain/money";
import { pendingAmountMinor } from "../domain/sale-totals";
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
  PosRegisterStatus,
  PosSaleStatus,
  PosShiftStatus,
} from "../models/pos.enums";
import type {
  PosActor,
  PosCardExternalDetails,
  PosPayment,
  PosRegister,
  PosRequestContext,
  PosSale,
  PosSalePaymentSummary,
  PosShift,
} from "../models/pos.types";
import { POS_METRICS, posMetric, posWarnMetric } from "../observability/pos-logger";
import { isAlreadyExistsError, nowTimestamp, runPosTransaction } from "../repositories/pos-firestore";
import {
  posPaymentRepository,
  posRegisterRepository,
  posSaleRepository,
  posShiftRepository,
} from "../repositories/pos-operational.repository";
import { posLockRepository } from "../repositories/pos-support.repository";
import { posAuditService } from "./pos-audit.service";
import { posAuthorizationService } from "./pos-authorization.service";
import { appendLedgerEntryInTransaction } from "./pos-cash-ledger.service";
import {
  posInventoryService,
  type PosProductSnapshot,
} from "./pos-inventory.service";
import { posPricingService } from "./pos-pricing.service";

/** Operación reportada por una terminal bancaria. Contrato estable para futuras terminales. */
export interface CardTerminalOperation {
  terminalId: string;
  reference: string;
  authorizationCode?: string | null;
  cardBrand?: string | null;
  last4?: string | null;
  approvedAtClientReported?: string | null;
}

export interface CashPaymentInput {
  amountMinor?: number;
  receivedMinor: number;
}

export interface CardPaymentInput extends Partial<CardTerminalOperation> {
  amountMinor: number;
  /** Resuelve un intento previamente registrado en lugar de crear uno nuevo. */
  attemptPaymentId?: string;
}

export interface MixedPaymentInput {
  cash: { amountMinor: number; receivedMinor: number };
  card: CardPaymentInput;
}

export interface PaymentResult {
  sale: PosSale;
  payments: PosPayment[];
  changeMinor: number;
  pendingMinor: number;
  paid: boolean;
}

const APPLIED_PAYMENT_STATUSES: readonly PosPaymentStatus[] = [
  PosPaymentStatus.APPROVED,
  PosPaymentStatus.PARTIALLY_REFUNDED,
  PosPaymentStatus.REFUNDED,
];

function cardReferenceLockKey(terminalId: string, reference: string): string {
  return `card-reference:${terminalId}:${reference}`;
}

function sanitizeReference(value: string | undefined | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length === 0
    ? null
    : trimmed.slice(0, POS_TEXT_LIMITS.REFERENCE_MAX);
}

function assertLast4(value: string | undefined | null): string | null {
  if (!value) return null;
  if (!/^\d{4}$/.test(value)) {
    throw new PosProblemError(
      "POS_VALIDATION_ERROR",
      "last4 debe contener exactamente cuatro dígitos.",
    );
  }
  return value;
}

function buildCardDetails(
  input: CardPaymentInput,
  operatorUid: string,
): PosCardExternalDetails {
  const terminalId = sanitizeReference(input.terminalId);
  const reference = sanitizeReference(input.reference);
  if (!terminalId || !reference) {
    throw new PosProblemError(
      "POS_VALIDATION_ERROR",
      "La terminal y la referencia son obligatorias para un pago aprobado con tarjeta.",
    );
  }
  return {
    terminalId,
    reference,
    authorizationCode: sanitizeReference(input.authorizationCode),
    cardBrand: input.cardBrand ? input.cardBrand.slice(0, 30) : null,
    last4: assertLast4(input.last4),
    operatorUid,
    approvedAtClientReported: input.approvedAtClientReported ?? null,
  };
}

function summarize(
  totals: { totalMinor: number },
  payments: readonly PosPayment[],
  previousChangeMinor: number,
): PosSalePaymentSummary {
  const applied = payments.filter((payment) =>
    APPLIED_PAYMENT_STATUSES.includes(payment.status),
  );
  const paidMinor = applied.reduce(
    (total, payment) => total + payment.amountMinor,
    0,
  );
  const cashMinor = applied
    .filter((payment) => payment.method === PosPaymentMethod.CASH)
    .reduce((total, payment) => total + payment.amountMinor, 0);
  const cardMinor = applied
    .filter((payment) => payment.method === PosPaymentMethod.CARD_EXTERNAL)
    .reduce((total, payment) => total + payment.amountMinor, 0);
  const refundedMinor = applied.reduce(
    (total, payment) => total + payment.refundedMinor,
    0,
  );

  return {
    paidMinor,
    pendingMinor: pendingAmountMinor(totals.totalMinor, paidMinor),
    cashMinor,
    cardMinor,
    changeMinor: previousChangeMinor,
    refundedMinor,
    methods: Array.from(new Set(applied.map((payment) => payment.method))),
  };
}

interface PaymentContext {
  sale: PosSale;
  shift: PosShift;
  register: PosRegister;
  payments: PosPayment[];
  products: Map<string, PosProductSnapshot>;
  pendingMinor: number;
}

class PosPaymentService {
  // ------------------------------------------------------------------ efectivo

  async payCash(
    actor: PosActor,
    saleId: string,
    input: CashPaymentInput,
    idempotencyKeyHash: string | null,
    context: PosRequestContext | null,
  ): Promise<PaymentResult> {
    posAuthorizationService.requireCapability(actor, PosCapability.SALE_CREATE);
    const receivedMinor = assertNonNegativeMinor(
      input.receivedMinor,
      "receivedMinor",
    );

    const result = await runPosTransaction(async (transaction) => {
      const ctx = await this.loadContext(transaction, actor, saleId);
      const amountMinor =
        input.amountMinor === undefined
          ? ctx.pendingMinor
          : assertNonNegativeMinor(input.amountMinor, "amountMinor");

      if (amountMinor <= 0) {
        throw new PosProblemError(
          "POS_VALIDATION_ERROR",
          "El importe del pago debe ser mayor a cero.",
        );
      }
      if (amountMinor > ctx.pendingMinor) {
        throw new PosProblemError(
          "PAYMENT_AMOUNT_MISMATCH",
          "El importe excede el saldo pendiente de la venta.",
        );
      }
      this.assertMethodAllowed(ctx, PosPaymentMethod.CASH);
      if (receivedMinor < amountMinor) {
        throw new PosProblemError("CASH_RECEIVED_INSUFFICIENT");
      }

      const changeMinor = receivedMinor - amountMinor;
      const payment = this.createPayment(transaction, ctx, {
        method: PosPaymentMethod.CASH,
        status: PosPaymentStatus.APPROVED,
        amountMinor,
        receivedMinor,
        changeMinor,
        card: null,
        registeredBy: actor.uid,
        idempotencyKeyHash,
      });

      // Solo el efectivo afecta el cajón: el movimiento se registra por el importe aplicado,
      // nunca por el recibido, para que el cambio entregado no distorsione el esperado.
      appendLedgerEntryInTransaction(transaction, {
        registerId: ctx.sale.registerId,
        sessionId: ctx.sale.sessionId,
        shiftId: ctx.sale.shiftId,
        operationalDate: ctx.sale.operationalDate,
        type: PosCashMovementType.CASH_SALE,
        status: PosCashMovementStatus.APPROVED,
        amountMinor,
        reason: `Venta en efectivo ${ctx.sale.folio}`,
        requestedBy: actor.uid,
        authorizedBy: actor.uid,
        saleId: ctx.sale.id,
        paymentId: payment.id,
        idempotencyKeyHash,
      });

      return this.finalize(transaction, actor, ctx, [payment], context, changeMinor);
    });

    await this.afterPaid(result);
    return result;
  }

  // ----------------------------------------------------------- tarjeta externa

  /**
   * Registra una operación de terminal externa.
   *
   * Sin `reference` se crea un intento en `PENDING`, que bloquea la venta contra un doble
   * cobro mientras la terminal responde. Con `reference` (o resolviendo un intento con
   * `attemptPaymentId`) el pago queda `APPROVED` y aplica al saldo.
   */
  async payCardExternal(
    actor: PosActor,
    saleId: string,
    input: CardPaymentInput,
    idempotencyKeyHash: string | null,
    context: PosRequestContext | null,
  ): Promise<PaymentResult> {
    posAuthorizationService.requireCapability(actor, PosCapability.SALE_CREATE);
    const amountMinor = assertNonNegativeMinor(input.amountMinor, "amountMinor");
    if (amountMinor <= 0) {
      throw new PosProblemError(
        "POS_VALIDATION_ERROR",
        "El importe del pago debe ser mayor a cero.",
      );
    }

    const isIntent = !input.reference && !input.attemptPaymentId;

    try {
      const result = await runPosTransaction(async (transaction) => {
        const ctx = await this.loadContext(transaction, actor, saleId);
        this.assertMethodAllowed(ctx, PosPaymentMethod.CARD_EXTERNAL);

        if (amountMinor > ctx.pendingMinor) {
          throw new PosProblemError(
            "PAYMENT_AMOUNT_MISMATCH",
            "El importe excede el saldo pendiente de la venta.",
          );
        }

        if (isIntent) {
          const attempt = this.createPayment(transaction, ctx, {
            method: PosPaymentMethod.CARD_EXTERNAL,
            status: PosPaymentStatus.PENDING,
            amountMinor,
            receivedMinor: null,
            changeMinor: null,
            card: null,
            registeredBy: actor.uid,
            idempotencyKeyHash,
          });

          posAuditService.recordInTransaction(transaction, {
            eventType: PosAuditEventType.PAYMENT_REGISTERED,
            entity: PosAuditEntity.PAYMENT,
            entityId: attempt.id,
            actor,
            context,
            operationalDate: ctx.sale.operationalDate,
            registerId: ctx.sale.registerId,
            sessionId: ctx.sale.sessionId,
            shiftId: ctx.sale.shiftId,
            after: {
              method: PosPaymentMethod.CARD_EXTERNAL,
              status: PosPaymentStatus.PENDING,
              amountMinor,
            },
          });

          return {
            sale: ctx.sale,
            payments: [attempt],
            changeMinor: 0,
            pendingMinor: ctx.pendingMinor,
            paid: false,
          } satisfies PaymentResult;
        }

        const card = buildCardDetails(input, actor.uid);
        // Unicidad lógica de la referencia: dos cobros no pueden reclamar la misma
        // operación de terminal.
        posLockRepository.acquireInTransaction(
          transaction,
          cardReferenceLockKey(card.terminalId, card.reference),
          {
            saleId: ctx.sale.id,
            registerId: ctx.sale.registerId,
            operationalDate: ctx.sale.operationalDate,
            actorUid: actor.uid,
          },
        );

        let payment: PosPayment;
        if (input.attemptPaymentId) {
          const attempt = ctx.payments.find(
            (entry) => entry.id === input.attemptPaymentId,
          );
          if (!attempt) {
            throw new PosProblemError("POS_RESOURCE_NOT_FOUND");
          }
          if (attempt.status !== PosPaymentStatus.PENDING) {
            throw new PosProblemError("PAYMENT_NOT_PENDING");
          }
          if (attempt.amountMinor !== amountMinor) {
            throw new PosProblemError(
              "PAYMENT_AMOUNT_MISMATCH",
              "El importe aprobado no coincide con el intento registrado.",
            );
          }
          assertTransition("payment", "approve", attempt.status);
          posPaymentRepository.updateInTransaction(
            transaction,
            attempt.id,
            {
              status: PosPaymentStatus.APPROVED,
              card,
              approvedAt: nowTimestamp(),
            },
            attempt.version,
          );
          payment = {
            ...attempt,
            status: PosPaymentStatus.APPROVED,
            card,
            version: attempt.version + 1,
          };
          ctx.payments = ctx.payments.map((entry) =>
            entry.id === payment.id ? payment : entry,
          );
        } else {
          payment = this.createPayment(transaction, ctx, {
            method: PosPaymentMethod.CARD_EXTERNAL,
            status: PosPaymentStatus.APPROVED,
            amountMinor,
            receivedMinor: null,
            changeMinor: null,
            card,
            registeredBy: actor.uid,
            idempotencyKeyHash,
          });
        }

        return this.finalize(transaction, actor, ctx, [payment], context, 0);
      });

      await this.afterPaid(result);
      return result;
    } catch (error) {
      if (isAlreadyExistsError(error)) {
        posWarnMetric(POS_METRICS.PAYMENT_DUPLICATE_PREVENTED, {
          saleId,
          userId: actor.uid,
          errorCode: "PAYMENT_REFERENCE_ALREADY_USED",
        });
        throw new PosProblemError("PAYMENT_REFERENCE_ALREADY_USED");
      }
      throw error;
    }
  }

  // ---------------------------------------------------------------- pago mixto

  /**
   * Pago mixto atómico: la suma de efectivo y tarjeta debe cubrir exactamente el saldo
   * pendiente. Solo la parte en efectivo entra al ledger; solo la parte de tarjeta entra a la
   * conciliación de terminal. La venta se contabiliza una sola vez.
   */
  async payMixed(
    actor: PosActor,
    saleId: string,
    input: MixedPaymentInput,
    idempotencyKeyHash: string | null,
    context: PosRequestContext | null,
  ): Promise<PaymentResult> {
    posAuthorizationService.requireCapability(actor, PosCapability.SALE_CREATE);
    const cashAmountMinor = assertNonNegativeMinor(
      input.cash.amountMinor,
      "cash.amountMinor",
    );
    const receivedMinor = assertNonNegativeMinor(
      input.cash.receivedMinor,
      "cash.receivedMinor",
    );
    const cardAmountMinor = assertNonNegativeMinor(
      input.card.amountMinor,
      "card.amountMinor",
    );
    if (cashAmountMinor <= 0 || cardAmountMinor <= 0) {
      throw new PosProblemError(
        "POS_VALIDATION_ERROR",
        "Un pago mixto requiere importe en efectivo y en tarjeta mayores a cero.",
      );
    }
    if (receivedMinor < cashAmountMinor) {
      throw new PosProblemError("CASH_RECEIVED_INSUFFICIENT");
    }

    try {
      const result = await runPosTransaction(async (transaction) => {
        const ctx = await this.loadContext(transaction, actor, saleId);
        this.assertMethodAllowed(ctx, PosPaymentMethod.CASH);
        this.assertMethodAllowed(ctx, PosPaymentMethod.CARD_EXTERNAL);

        if (cashAmountMinor + cardAmountMinor !== ctx.pendingMinor) {
          throw new PosProblemError(
            "PAYMENT_AMOUNT_MISMATCH",
            "La suma del pago mixto debe cubrir exactamente el saldo pendiente.",
          );
        }

        const card = buildCardDetails(input.card, actor.uid);
        posLockRepository.acquireInTransaction(
          transaction,
          cardReferenceLockKey(card.terminalId, card.reference),
          {
            saleId: ctx.sale.id,
            registerId: ctx.sale.registerId,
            operationalDate: ctx.sale.operationalDate,
            actorUid: actor.uid,
          },
        );

        const changeMinor = receivedMinor - cashAmountMinor;
        const cashPayment = this.createPayment(transaction, ctx, {
          method: PosPaymentMethod.CASH,
          status: PosPaymentStatus.APPROVED,
          amountMinor: cashAmountMinor,
          receivedMinor,
          changeMinor,
          card: null,
          registeredBy: actor.uid,
          idempotencyKeyHash,
        });
        const cardPayment = this.createPayment(transaction, ctx, {
          method: PosPaymentMethod.CARD_EXTERNAL,
          status: PosPaymentStatus.APPROVED,
          amountMinor: cardAmountMinor,
          receivedMinor: null,
          changeMinor: null,
          card,
          registeredBy: actor.uid,
          idempotencyKeyHash,
        });

        appendLedgerEntryInTransaction(transaction, {
          registerId: ctx.sale.registerId,
          sessionId: ctx.sale.sessionId,
          shiftId: ctx.sale.shiftId,
          operationalDate: ctx.sale.operationalDate,
          type: PosCashMovementType.CASH_SALE,
          status: PosCashMovementStatus.APPROVED,
          amountMinor: cashAmountMinor,
          reason: `Parte en efectivo de la venta ${ctx.sale.folio}`,
          requestedBy: actor.uid,
          authorizedBy: actor.uid,
          saleId: ctx.sale.id,
          paymentId: cashPayment.id,
          idempotencyKeyHash,
        });

        return this.finalize(
          transaction,
          actor,
          ctx,
          [cashPayment, cardPayment],
          context,
          changeMinor,
        );
      });

      await this.afterPaid(result);
      return result;
    } catch (error) {
      if (isAlreadyExistsError(error)) {
        posWarnMetric(POS_METRICS.PAYMENT_DUPLICATE_PREVENTED, {
          saleId,
          userId: actor.uid,
          errorCode: "PAYMENT_REFERENCE_ALREADY_USED",
        });
        throw new PosProblemError("PAYMENT_REFERENCE_ALREADY_USED");
      }
      throw error;
    }
  }

  // ------------------------------------------------------- rechazo/cancelación

  /** Registra el rechazo de un intento de terminal. No aplica dinero. */
  async decline(
    actor: PosActor,
    saleId: string,
    paymentId: string,
    reason: string,
    context: PosRequestContext | null,
  ): Promise<PosPayment> {
    posAuthorizationService.requireCapability(actor, PosCapability.SALE_CREATE);
    const validReason = this.assertReason(reason);

    return runPosTransaction(async (transaction) => {
      const payment = await posPaymentRepository.requireByIdInTransaction(
        transaction,
        paymentId,
      );
      if (payment.saleId !== saleId) {
        throw new PosProblemError("POS_RESOURCE_NOT_FOUND");
      }
      const sale = await posSaleRepository.requireByIdInTransaction(
        transaction,
        saleId,
      );
      if (sale.cashierUid !== actor.uid) {
        throw new PosProblemError("POS_RESOURCE_NOT_FOUND");
      }
      const target = assertTransition(
        "payment",
        "decline",
        payment.status,
      ) as PosPaymentStatus;

      posPaymentRepository.updateInTransaction(
        transaction,
        payment.id,
        { status: target, declineReason: validReason },
        payment.version,
      );

      posAuditService.recordInTransaction(transaction, {
        eventType: PosAuditEventType.PAYMENT_DECLINED,
        entity: PosAuditEntity.PAYMENT,
        entityId: payment.id,
        actor,
        context,
        operationalDate: payment.operationalDate,
        registerId: payment.registerId,
        sessionId: payment.sessionId,
        shiftId: payment.shiftId,
        before: { status: payment.status },
        after: { status: target },
        reason: validReason,
      });

      return { ...payment, status: target, version: payment.version + 1 };
    });
  }

  /**
   * Cancela un pago registrado por error mientras la venta sigue en cobro.
   * Si era efectivo se crea una reversa en el ledger: el movimiento original nunca se edita.
   */
  async cancel(
    actor: PosActor,
    saleId: string,
    paymentId: string,
    reason: string,
    context: PosRequestContext | null,
  ): Promise<PaymentResult> {
    posAuthorizationService.requireCapability(actor, PosCapability.SALE_CREATE);
    const validReason = this.assertReason(reason);

    return runPosTransaction(async (transaction) => {
      const sale = await posSaleRepository.requireByIdInTransaction(
        transaction,
        saleId,
      );
      if (sale.cashierUid !== actor.uid) {
        throw new PosProblemError("POS_RESOURCE_NOT_FOUND");
      }
      if (sale.status === PosSaleStatus.PAID) {
        throw new PosProblemError(
          "SALE_ALREADY_PAID",
          "La venta ya está pagada: usa una devolución o una anulación.",
        );
      }
      const payments = await posPaymentRepository.listBySaleInTransaction(
        transaction,
        saleId,
      );
      const payment = payments.find((entry) => entry.id === paymentId);
      if (!payment) {
        throw new PosProblemError("POS_RESOURCE_NOT_FOUND");
      }
      if (payment.refundedMinor > 0) {
        throw new PosProblemError(
          "PAYMENT_NOT_PENDING",
          "El pago tiene reembolsos registrados y no puede cancelarse.",
        );
      }
      const target = assertTransition(
        "payment",
        "cancel",
        payment.status,
      ) as PosPaymentStatus;

      posPaymentRepository.updateInTransaction(
        transaction,
        payment.id,
        { status: target, cancelReason: validReason },
        payment.version,
      );

      if (
        payment.method === PosPaymentMethod.CASH &&
        payment.status === PosPaymentStatus.APPROVED
      ) {
        appendLedgerEntryInTransaction(transaction, {
          registerId: payment.registerId,
          sessionId: payment.sessionId,
          shiftId: payment.shiftId,
          operationalDate: payment.operationalDate,
          type: PosCashMovementType.AUTHORIZED_ADJUSTMENT,
          status: PosCashMovementStatus.APPROVED,
          amountMinor: payment.amountMinor,
          direction: "OUT",
          reason: `Reversa de pago en efectivo cancelado: ${validReason}`,
          requestedBy: actor.uid,
          authorizedBy: actor.uid,
          saleId: sale.id,
          paymentId: payment.id,
        });
      }

      const updatedPayments = payments.map((entry) =>
        entry.id === payment.id ? { ...entry, status: target } : entry,
      );
      const summary = summarize(
        sale.totals,
        updatedPayments,
        sale.payment.changeMinor,
      );

      posSaleRepository.updateInTransaction(
        transaction,
        sale.id,
        { payment: summary },
        sale.version,
      );

      posAuditService.recordInTransaction(transaction, {
        eventType: PosAuditEventType.PAYMENT_CANCELLED,
        entity: PosAuditEntity.PAYMENT,
        entityId: payment.id,
        actor,
        context,
        operationalDate: payment.operationalDate,
        registerId: payment.registerId,
        sessionId: payment.sessionId,
        shiftId: payment.shiftId,
        before: { status: payment.status },
        after: { status: target, paidMinor: summary.paidMinor },
        reason: validReason,
      });

      return {
        sale: { ...sale, payment: summary, version: sale.version + 1 },
        payments: [{ ...payment, status: target, version: payment.version + 1 }],
        changeMinor: 0,
        pendingMinor: summary.pendingMinor,
        paid: false,
      };
    });
  }

  async listBySale(actor: PosActor, saleId: string): Promise<PosPayment[]> {
    const sale = await posSaleRepository.requireById(saleId);
    posAuthorizationService.assertCanReadOwned(
      actor,
      sale.cashierUid,
      PosCapability.SHIFT_READ_ALL,
    );
    return posPaymentRepository.listBySale(saleId);
  }

  // ---------------------------------------------------------------- internos

  private assertReason(reason: string): string {
    const trimmed = (reason ?? "").trim();
    if (trimmed.length < POS_TEXT_LIMITS.REASON_MIN) {
      throw new PosProblemError(
        "REASON_REQUIRED",
        `El motivo debe tener al menos ${POS_TEXT_LIMITS.REASON_MIN} caracteres.`,
      );
    }
    return trimmed.slice(0, POS_TEXT_LIMITS.REASON_MAX);
  }

  /**
   * Lecturas de la transacción. Firestore exige que todas ocurran antes de cualquier
   * escritura, así que aquí se cargan venta, turno, pagos y productos.
   */
  private async loadContext(
    transaction: FirebaseFirestore.Transaction,
    actor: PosActor,
    saleId: string,
  ): Promise<PaymentContext> {
    const sale = await posSaleRepository.requireByIdInTransaction(
      transaction,
      saleId,
    );
    if (sale.cashierUid !== actor.uid) {
      throw new PosProblemError("POS_RESOURCE_NOT_FOUND");
    }
    if (sale.status === PosSaleStatus.PAID) {
      throw new PosProblemError("SALE_ALREADY_PAID");
    }
    if (sale.status !== PosSaleStatus.PAYMENT_PENDING) {
      throw new PosProblemError(
        "INVALID_STATE_TRANSITION",
        "La venta debe estar en cobro para registrar pagos.",
      );
    }
    if (sale.items.length === 0) {
      throw new PosProblemError("SALE_EMPTY");
    }

    const shift = await posShiftRepository.requireByIdInTransaction(
      transaction,
      sale.shiftId,
    );
    if (shift.status !== PosShiftStatus.ACTIVE) {
      throw new PosProblemError("NO_ACTIVE_SHIFT");
    }
    if (shift.cashierUid !== actor.uid) {
      throw new PosProblemError("SHIFT_NOT_OWNED");
    }

    const register = await posRegisterRepository.requireByIdInTransaction(
      transaction,
      sale.registerId,
    );
    if (register.status !== PosRegisterStatus.OPEN) {
      throw new PosProblemError("REGISTER_NOT_OPEN");
    }

    const payments = await posPaymentRepository.listBySaleInTransaction(
      transaction,
      saleId,
    );
    const products = await posInventoryService.loadProductsInTransaction(
      transaction,
      sale.items.map((item) => item.productoId),
    );

    const appliedMinor = payments
      .filter((payment) => APPLIED_PAYMENT_STATUSES.includes(payment.status))
      .reduce((total, payment) => total + payment.amountMinor, 0);

    const pending = pendingAmountMinor(sale.totals.totalMinor, appliedMinor);
    if (pending <= 0) {
      throw new PosProblemError("SALE_ALREADY_PAID");
    }

    return { sale, shift, register, payments, products, pendingMinor: pending };
  }

  /** La caja puede tener deshabilitado un método (por ejemplo, caja sin terminal). */
  private assertMethodAllowed(ctx: PaymentContext, method: PosPaymentMethod): void {
    const allowed =
      method === PosPaymentMethod.CASH
        ? ctx.register.config.allowCash !== false
        : ctx.register.config.allowCardExternal !== false;
    if (!allowed) {
      throw new PosProblemError(
        "PAYMENT_METHOD_NOT_ALLOWED",
        `La caja ${ctx.register.code} no admite pagos con ${method}.`,
      );
    }
  }

  private createPayment(
    transaction: FirebaseFirestore.Transaction,
    ctx: PaymentContext,
    input: {
      method: PosPaymentMethod;
      status: PosPaymentStatus;
      amountMinor: number;
      receivedMinor: number | null;
      changeMinor: number | null;
      card: PosCardExternalDetails | null;
      registeredBy: string;
      idempotencyKeyHash: string | null;
    },
  ): PosPayment {
    const payment = posPaymentRepository.createInTransaction(transaction, {
      storeId: ctx.sale.storeId,
      saleId: ctx.sale.id,
      registerId: ctx.sale.registerId,
      sessionId: ctx.sale.sessionId,
      shiftId: ctx.sale.shiftId,
      operationalDate: ctx.sale.operationalDate,
      method: input.method,
      status: input.status,
      amountMinor: input.amountMinor,
      receivedMinor: input.receivedMinor,
      changeMinor: input.changeMinor,
      refundedMinor: 0,
      card: input.card,
      declineReason: null,
      cancelReason: null,
      registeredBy: input.registeredBy,
      idempotencyKeyHash: input.idempotencyKeyHash,
      approvedAt:
        input.status === PosPaymentStatus.APPROVED ? nowTimestamp() : null,
    });
    ctx.payments = [...ctx.payments, payment];
    return payment;
  }

  /**
   * Aplica el efecto de los pagos aprobados: resumen de la venta y, si el total queda
   * cubierto, transición a `PAID`, descuento de inventario y proyección de totales del turno.
   */
  private finalize(
    transaction: FirebaseFirestore.Transaction,
    actor: PosActor,
    ctx: PaymentContext,
    newPayments: readonly PosPayment[],
    context: PosRequestContext | null,
    changeMinor: number,
  ): PaymentResult {
    const summary = summarize(
      ctx.sale.totals,
      ctx.payments,
      ctx.sale.payment.changeMinor + changeMinor,
    );
    const paid = summary.pendingMinor === 0;

    const salePatch: Record<string, unknown> = { payment: summary };

    if (paid) {
      const target = assertTransition(
        "sale",
        "pay",
        ctx.sale.status,
      ) as PosSaleStatus;
      salePatch.status = target;
      salePatch.paidAt = nowTimestamp();
      salePatch.inventoryCommitted = true;

      // Descuento atómico: si alguna línea no alcanza, toda la transacción se revierte y la
      // venta no queda pagada.
      posInventoryService.commitSaleLinesInTransaction(
        transaction,
        ctx.products,
        ctx.sale.items.map((item) => ({
          productoId: item.productoId,
          tallaId: item.tallaId,
          quantity: item.quantity,
        })),
        {
          saleId: ctx.sale.id,
          registerId: ctx.sale.registerId,
          shiftId: ctx.sale.shiftId,
          operationalDate: ctx.sale.operationalDate,
          actorUid: actor.uid,
          actorRole: actor.posRole,
          reason: `Venta POS ${ctx.sale.folio}`,
          idempotencyKey: newPayments[0]?.idempotencyKeyHash ?? null,
        },
      );

      const cashSalesMinor = newPayments
        .filter((payment) => payment.method === PosPaymentMethod.CASH)
        .reduce((total, payment) => total + payment.amountMinor, 0);
      const cardSalesMinor = newPayments
        .filter((payment) => payment.method === PosPaymentMethod.CARD_EXTERNAL)
        .reduce((total, payment) => total + payment.amountMinor, 0);

      posShiftRepository.updateInTransaction(
        transaction,
        ctx.shift.id,
        {
          totals: {
            ...ctx.shift.totals,
            salesCount: ctx.shift.totals.salesCount + 1,
            grossSalesMinor:
              ctx.shift.totals.grossSalesMinor +
              ctx.sale.totals.subtotalOriginalMinor,
            discountMinor:
              ctx.shift.totals.discountMinor + ctx.sale.totals.discountMinor,
            netSalesMinor:
              ctx.shift.totals.netSalesMinor + ctx.sale.totals.totalMinor,
            cashSalesMinor: ctx.shift.totals.cashSalesMinor + summary.cashMinor,
            cardSalesMinor: ctx.shift.totals.cardSalesMinor + summary.cardMinor,
          },
        },
        ctx.shift.version,
      );

      posAuditService.recordInTransaction(transaction, {
        eventType: PosAuditEventType.SALE_PAID,
        entity: PosAuditEntity.SALE,
        entityId: ctx.sale.id,
        actor,
        context,
        operationalDate: ctx.sale.operationalDate,
        registerId: ctx.sale.registerId,
        sessionId: ctx.sale.sessionId,
        shiftId: ctx.sale.shiftId,
        before: { status: ctx.sale.status },
        after: {
          status: target,
          totalMinor: ctx.sale.totals.totalMinor,
          cashMinor: cashSalesMinor,
          cardMinor: cardSalesMinor,
          methods: summary.methods,
        },
      });
    }

    posSaleRepository.updateInTransaction(
      transaction,
      ctx.sale.id,
      salePatch,
      ctx.sale.version,
    );

    for (const payment of newPayments) {
      posAuditService.recordInTransaction(transaction, {
        eventType: PosAuditEventType.PAYMENT_REGISTERED,
        entity: PosAuditEntity.PAYMENT,
        entityId: payment.id,
        actor,
        context,
        operationalDate: payment.operationalDate,
        registerId: payment.registerId,
        sessionId: payment.sessionId,
        shiftId: payment.shiftId,
        after: {
          method: payment.method,
          status: payment.status,
          amountMinor: payment.amountMinor,
          // Solo referencia y autorización: nunca datos sensibles de la tarjeta.
          reference: payment.card?.reference ?? null,
          authorizationCode: payment.card?.authorizationCode ?? null,
        },
      });
    }

    return {
      sale: {
        ...ctx.sale,
        ...(paid
          ? { status: PosSaleStatus.PAID, inventoryCommitted: true }
          : {}),
        payment: summary,
        version: ctx.sale.version + 1,
      } as PosSale,
      payments: [...newPayments],
      changeMinor,
      pendingMinor: summary.pendingMinor,
      paid,
    };
  }

  /** Efectos externos no transaccionales, seguros ante reintento. */
  private async afterPaid(result: PaymentResult): Promise<void> {
    if (!result.paid) {
      return;
    }
    posMetric(POS_METRICS.SALE_PAID, {
      saleId: result.sale.id,
      registerId: result.sale.registerId,
      shiftId: result.sale.shiftId,
      operationalDate: result.sale.operationalDate,
      amountMinor: result.sale.totals.totalMinor,
    });

    if (result.sale.appliedCode) {
      try {
        await posPricingService.registerCodeUsage(
          result.sale.appliedCode.codigoPromocionId,
        );
      } catch {
        // El uso del código es contabilidad promocional, no parte del cobro: un fallo aquí
        // no debe revertir una venta ya pagada. Queda registrado en el log del proceso.
        posWarnMetric(POS_METRICS.SALE_FAILED, {
          saleId: result.sale.id,
          errorCode: "PROMOTION_USAGE_NOT_REGISTERED",
        });
      }
    }
  }
}

export const posPaymentService = new PosPaymentService();
export default posPaymentService;
