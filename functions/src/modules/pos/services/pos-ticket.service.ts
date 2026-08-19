/**
 * Tickets comerciales no fiscales.
 *
 * El ticket es una proyección de lectura de la venta y sus pagos: no almacena importes
 * propios ni recalcula nada, de modo que nunca puede divergir de la venta. No contiene UUID
 * fiscal, RFC, ni datos de CFDI, y de los pagos con tarjeta solo expone referencia y código
 * de autorización, jamás datos de la tarjeta.
 */

import { POS_CURRENCY } from "../constants/pos.constants";
import PosProblemError from "../errors/pos-problem.error";
import {
  PosAuditEntity,
  PosAuditEventType,
  PosCapability,
  PosPaymentMethod,
  PosPaymentStatus,
  PosSaleStatus,
} from "../models/pos.enums";
import type {
  PosActor,
  PosPayment,
  PosRequestContext,
  PosSale,
  PosTicket,
} from "../models/pos.types";
import {
  posPaymentRepository,
  posSaleRepository,
} from "../repositories/pos-operational.repository";
import { posUserDirectoryRepository } from "../repositories/pos-support.repository";
import { posAuditService } from "./pos-audit.service";
import { posAuthorizationService } from "./pos-authorization.service";
import posSettingsService from "./pos-settings.service";

/** Estados en los que la venta ya tiene un ticket entregable al cliente. */
const TICKETABLE_STATUSES: readonly PosSaleStatus[] = [
  PosSaleStatus.PAID,
  PosSaleStatus.PARTIALLY_REFUNDED,
  PosSaleStatus.REFUNDED,
  PosSaleStatus.VOIDED,
];

const APPLIED_PAYMENT_STATUSES: readonly PosPaymentStatus[] = [
  PosPaymentStatus.APPROVED,
  PosPaymentStatus.PARTIALLY_REFUNDED,
  PosPaymentStatus.REFUNDED,
];

class PosTicketService {
  /** Ticket de una venta. Requiere `pos.ticket.read` y ownership o lectura global. */
  async get(
    actor: PosActor,
    saleId: string,
    context: PosRequestContext | null,
  ): Promise<PosTicket> {
    posAuthorizationService.requireCapability(actor, PosCapability.TICKET_READ);
    const sale = await posSaleRepository.requireById(saleId);
    posAuthorizationService.assertCanReadOwned(
      actor,
      sale.cashierUid,
      PosCapability.SHIFT_READ_ALL,
    );
    this.assertTicketable(sale);

    const ticket = await this.build(sale);

    // La consulta del ticket se audita para saber quién vio una venta ajena.
    await posAuditService.record({
      eventType: PosAuditEventType.TICKET_READ,
      entity: PosAuditEntity.TICKET,
      entityId: sale.id,
      actor,
      context,
      operationalDate: sale.operationalDate,
      registerId: sale.registerId,
      sessionId: sale.sessionId,
      shiftId: sale.shiftId,
      after: { folio: sale.folio, reprintCount: sale.reprintCount },
    });

    return ticket;
  }

  /**
   * Reimpresión. Incrementa el contador con versión optimista para que dos reimpresiones
   * concurrentes no se pierdan y queden ambas registradas.
   */
  async reprint(
    actor: PosActor,
    saleId: string,
    reason: string | undefined,
    context: PosRequestContext | null,
  ): Promise<PosTicket> {
    posAuthorizationService.requireCapability(
      actor,
      PosCapability.TICKET_REPRINT,
    );
    const sale = await posSaleRepository.requireById(saleId);
    posAuthorizationService.assertCanReadOwned(
      actor,
      sale.cashierUid,
      PosCapability.SHIFT_READ_ALL,
    );
    this.assertTicketable(sale);

    const updated = await posSaleRepository.update(
      sale.id,
      { reprintCount: sale.reprintCount + 1 },
      sale.version,
    );

    await posAuditService.record({
      eventType: PosAuditEventType.TICKET_REPRINTED,
      entity: PosAuditEntity.TICKET,
      entityId: sale.id,
      actor,
      context,
      operationalDate: sale.operationalDate,
      registerId: sale.registerId,
      sessionId: sale.sessionId,
      shiftId: sale.shiftId,
      before: { reprintCount: sale.reprintCount },
      after: { reprintCount: updated.reprintCount },
      reason: reason ?? null,
    });

    return this.build(updated);
  }

  /** Consulta pública por token: no revela datos de otros clientes ni del personal. */
  async getByToken(token: string): Promise<PosTicket> {
    if (!/^[a-f0-9]{32}$/.test(token)) {
      throw new PosProblemError("POS_RESOURCE_NOT_FOUND");
    }
    const sale = await posSaleRepository.findByTicketToken(token);
    if (!sale || !TICKETABLE_STATUSES.includes(sale.status)) {
      throw new PosProblemError("POS_RESOURCE_NOT_FOUND");
    }
    return this.build(sale, { includeCashierIdentity: false });
  }

  private assertTicketable(sale: PosSale): void {
    if (!TICKETABLE_STATUSES.includes(sale.status)) {
      throw new PosProblemError(
        "SALE_PAYMENT_INCOMPLETE",
        "La venta aún no tiene un ticket: no está pagada.",
      );
    }
  }

  private async build(
    sale: PosSale,
    options: { includeCashierIdentity?: boolean } = {},
  ): Promise<PosTicket> {
    const includeCashierIdentity = options.includeCashierIdentity !== false;
    const [settings, payments] = await Promise.all([
      posSettingsService.get(),
      posPaymentRepository.listBySale(sale.id),
    ]);

    const applied = payments.filter((payment) =>
      APPLIED_PAYMENT_STATUSES.includes(payment.status),
    );

    const cashierName = includeCashierIdentity
      ? ((await posUserDirectoryRepository.findByUid(sale.cashierUid))?.nombre ??
        undefined)
      : undefined;

    return {
      saleId: sale.id,
      folio: sale.folio,
      ticketToken: sale.ticketToken,
      operationalDate: sale.operationalDate,
      issuedAt: (sale.paidAt ?? sale.createdAt).toDate().toISOString(),
      store: {
        name: settings.storeName,
        ...(settings.storeAddress ? { address: settings.storeAddress } : {}),
        ...(settings.storePhone ? { phone: settings.storePhone } : {}),
      },
      register: { id: sale.registerId, code: sale.registerCode },
      cashier: {
        uid: includeCashierIdentity ? sale.cashierUid : "",
        ...(cashierName ? { name: cashierName } : {}),
      },
      items: sale.items.map((item) => ({
        clave: item.clave,
        descripcion: item.descripcion,
        tallaCodigo: item.tallaCodigo ?? null,
        quantity: item.quantity,
        unitPriceOriginalMinor: item.unitPriceOriginalMinor,
        unitPriceMinor: item.unitPriceMinor,
        discountMinor:
          item.offerDiscountMinor +
          item.codeDiscountMinor +
          item.manualDiscountMinor,
        lineTotalMinor: item.lineTotalMinor,
      })),
      totals: sale.totals,
      payments: applied.map((payment) => this.toTicketPayment(payment)),
      receivedMinor: applied.reduce(
        (total, payment) => total + (payment.receivedMinor ?? 0),
        0,
      ),
      changeMinor: applied.reduce(
        (total, payment) => total + (payment.changeMinor ?? 0),
        0,
      ),
      currency: POS_CURRENCY,
      legend: settings.ticketFooterLegend,
      lookupUrl: settings.ticketLookupBaseUrl
        ? `${settings.ticketLookupBaseUrl.replace(/\/+$/, "")}/${sale.ticketToken}`
        : null,
      reprintCount: sale.reprintCount,
    };
  }

  private toTicketPayment(payment: PosPayment): PosTicket["payments"][number] {
    return {
      method: payment.method,
      amountMinor: payment.amountMinor,
      receivedMinor: payment.receivedMinor,
      changeMinor: payment.changeMinor,
      // Referencia y autorización son datos de conciliación, no datos de tarjeta.
      reference:
        payment.method === PosPaymentMethod.CARD_EXTERNAL
          ? (payment.card?.reference ?? null)
          : null,
      authorizationCode:
        payment.method === PosPaymentMethod.CARD_EXTERNAL
          ? (payment.card?.authorizationCode ?? null)
          : null,
    };
  }
}

export const posTicketService = new PosTicketService();
export default posTicketService;
