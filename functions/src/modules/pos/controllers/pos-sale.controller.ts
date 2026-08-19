/**
 * Ventas presenciales, pagos y tickets.
 *
 * El cliente solo envía intención (`productoId`, `tallaId`, `quantity`, código, importe
 * recibido). Precio, descuento, total, inventario y estado los decide el backend; los
 * pagos y las devoluciones van siempre por idempotencia.
 */

import { NextFunction, Request, Response } from "express";
import type { PosSaleStatus } from "../models/pos.enums";
import { posPaymentService } from "../services/pos-payment.service";
import { posReturnService } from "../services/pos-return.service";
import { posSaleService } from "../services/pos-sale.service";
import { posTicketService } from "../services/pos-ticket.service";
import {
  contextOf,
  idempotencyKeyHashOf,
  requireActor,
  runIdempotent,
  sendJson,
} from "./pos-controller.support";
import { toPosJson, toPosPage } from "./pos.serializers";

// ------------------------------------------------------------------ ventas

export async function createSale(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = requireActor(req);
    const sale = await posSaleService.create(actor, req.body, contextOf(req));
    sendJson(res, { sale: toPosJson(sale) }, 201);
  } catch (error) {
    next(error);
  }
}

export async function listSales(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = requireActor(req);
    const page = await posSaleService.list(actor, {
      status: req.query.status as PosSaleStatus | undefined,
      registerId: req.query.registerId as string | undefined,
      sessionId: req.query.sessionId as string | undefined,
      shiftId: req.query.shiftId as string | undefined,
      cashierUid: req.query.cashierUid as string | undefined,
      operationalDate: req.query.operationalDate as string | undefined,
      folio: req.query.folio as string | undefined,
      limit: req.query.limit as number | undefined,
      cursor: req.query.cursor as string | undefined,
    });
    sendJson(res, toPosPage(page));
  } catch (error) {
    next(error);
  }
}

export async function getSale(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = requireActor(req);
    const sale = await posSaleService.get(actor, req.params.saleId);
    sendJson(res, { sale: toPosJson(sale) });
  } catch (error) {
    next(error);
  }
}

export async function addSaleItem(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = requireActor(req);
    const result = await posSaleService.addItem(
      actor,
      req.params.saleId,
      req.body,
      contextOf(req),
    );
    sendJson(res, toPosJson(result) as Record<string, unknown>, 201);
  } catch (error) {
    next(error);
  }
}

export async function updateSaleItem(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = requireActor(req);
    const result = await posSaleService.updateItem(
      actor,
      req.params.saleId,
      req.params.itemId,
      req.body,
      contextOf(req),
    );
    sendJson(res, toPosJson(result) as Record<string, unknown>);
  } catch (error) {
    next(error);
  }
}

export async function removeSaleItem(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = requireActor(req);
    const result = await posSaleService.removeItem(
      actor,
      req.params.saleId,
      req.params.itemId,
      contextOf(req),
    );
    sendJson(res, toPosJson(result) as Record<string, unknown>);
  } catch (error) {
    next(error);
  }
}

export async function repriceSale(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = requireActor(req);
    const result = await posSaleService.reprice(
      actor,
      req.params.saleId,
      contextOf(req),
    );
    sendJson(res, toPosJson(result) as Record<string, unknown>);
  } catch (error) {
    next(error);
  }
}

export async function applySaleCode(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = requireActor(req);
    const result = await posSaleService.applyCode(
      actor,
      req.params.saleId,
      req.body.codigo,
      contextOf(req),
    );
    sendJson(res, toPosJson(result) as Record<string, unknown>);
  } catch (error) {
    next(error);
  }
}

export async function removeSaleCode(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = requireActor(req);
    const result = await posSaleService.removeCode(
      actor,
      req.params.saleId,
      contextOf(req),
    );
    sendJson(res, toPosJson(result) as Record<string, unknown>);
  } catch (error) {
    next(error);
  }
}

export async function applyManualDiscount(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = requireActor(req);
    const result = await posSaleService.applyManualDiscount(
      actor,
      req.params.saleId,
      req.body,
      contextOf(req),
    );
    sendJson(res, toPosJson(result) as Record<string, unknown>);
  } catch (error) {
    next(error);
  }
}

export async function suspendSale(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = requireActor(req);
    const sale = await posSaleService.suspend(
      actor,
      req.params.saleId,
      contextOf(req),
    );
    sendJson(res, { sale: toPosJson(sale) });
  } catch (error) {
    next(error);
  }
}

export async function resumeSale(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = requireActor(req);
    const result = await posSaleService.resume(
      actor,
      req.params.saleId,
      contextOf(req),
    );
    sendJson(res, toPosJson(result) as Record<string, unknown>);
  } catch (error) {
    next(error);
  }
}

export async function returnSaleToDraft(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = requireActor(req);
    const sale = await posSaleService.returnToDraft(
      actor,
      req.params.saleId,
      contextOf(req),
    );
    sendJson(res, { sale: toPosJson(sale) });
  } catch (error) {
    next(error);
  }
}

export async function cancelSale(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = requireActor(req);
    const sale = await posSaleService.cancel(
      actor,
      req.params.saleId,
      req.body.reason,
      contextOf(req),
    );
    sendJson(res, { sale: toPosJson(sale) });
  } catch (error) {
    next(error);
  }
}

export async function checkoutPreview(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = requireActor(req);
    const preview = await posSaleService.checkoutPreview(
      actor,
      req.params.saleId,
      contextOf(req),
    );
    sendJson(res, toPosJson(preview) as Record<string, unknown>);
  } catch (error) {
    next(error);
  }
}

/** Cancelación de una venta ya pagada: genera devolución y reembolso, nunca borra la venta. */
export async function voidPaidSale(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = requireActor(req);
    await runIdempotent(req, res, {
      operation: "sales.void",
      resourceKey: `sale:${req.params.saleId}`,
      execute: () =>
        posReturnService.voidPaidSale(
          actor,
          req.params.saleId,
          req.body,
          idempotencyKeyHashOf(req),
          contextOf(req),
        ),
    });
  } catch (error) {
    next(error);
  }
}

// ------------------------------------------------------------------- pagos

export async function payCash(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = requireActor(req);
    await runIdempotent(req, res, {
      operation: "sales.payments.cash",
      resourceKey: `sale:${req.params.saleId}`,
      statusCode: 201,
      execute: () =>
        posPaymentService.payCash(
          actor,
          req.params.saleId,
          req.body,
          idempotencyKeyHashOf(req),
          contextOf(req),
        ),
    });
  } catch (error) {
    next(error);
  }
}

export async function payCardExternal(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = requireActor(req);
    await runIdempotent(req, res, {
      operation: "sales.payments.card-external",
      resourceKey: `sale:${req.params.saleId}`,
      statusCode: 201,
      execute: () =>
        posPaymentService.payCardExternal(
          actor,
          req.params.saleId,
          req.body,
          idempotencyKeyHashOf(req),
          contextOf(req),
        ),
    });
  } catch (error) {
    next(error);
  }
}

export async function payMixed(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = requireActor(req);
    await runIdempotent(req, res, {
      operation: "sales.payments.mixed",
      resourceKey: `sale:${req.params.saleId}`,
      statusCode: 201,
      execute: () =>
        posPaymentService.payMixed(
          actor,
          req.params.saleId,
          req.body,
          idempotencyKeyHashOf(req),
          contextOf(req),
        ),
    });
  } catch (error) {
    next(error);
  }
}

export async function listSalePayments(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = requireActor(req);
    const payments = await posPaymentService.listBySale(
      actor,
      req.params.saleId,
    );
    sendJson(res, { items: payments.map((payment) => toPosJson(payment)) });
  } catch (error) {
    next(error);
  }
}

export async function declinePayment(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = requireActor(req);
    const payment = await posPaymentService.decline(
      actor,
      req.params.saleId,
      req.params.paymentId,
      req.body.reason,
      contextOf(req),
    );
    sendJson(res, { payment: toPosJson(payment) });
  } catch (error) {
    next(error);
  }
}

export async function cancelPayment(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = requireActor(req);
    await runIdempotent(req, res, {
      operation: "sales.payments.cancel",
      resourceKey: `payment:${req.params.paymentId}`,
      execute: () =>
        posPaymentService.cancel(
          actor,
          req.params.saleId,
          req.params.paymentId,
          req.body.reason,
          contextOf(req),
        ),
    });
  } catch (error) {
    next(error);
  }
}

// ----------------------------------------------------------------- tickets

export async function getTicket(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = requireActor(req);
    const ticket = await posTicketService.get(
      actor,
      req.params.saleId,
      contextOf(req),
    );
    sendJson(res, { ticket: toPosJson(ticket) });
  } catch (error) {
    next(error);
  }
}

export async function reprintTicket(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = requireActor(req);
    const ticket = await posTicketService.reprint(
      actor,
      req.params.saleId,
      req.body?.reason,
      contextOf(req),
    );
    sendJson(res, { ticket: toPosJson(ticket) });
  } catch (error) {
    next(error);
  }
}

/** Consulta pública por token: no revela identidad del cajero ni datos internos. */
export async function getTicketByToken(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const ticket = await posTicketService.getByToken(req.params.token);
    sendJson(res, { ticket: toPosJson(ticket) });
  } catch (error) {
    next(error);
  }
}
