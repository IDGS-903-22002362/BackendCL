/**
 * Devoluciones y reembolsos.
 *
 * Una venta pagada no se cancela: se devuelve. El reembolso se reparte entre los pagos
 * originales según la política del dominio y la reposición de inventario exige declarar la
 * condición física de la mercancía.
 */

import { NextFunction, Request, Response } from "express";
import type { PosReturnStatus } from "../models/pos.enums";
import { posReturnService } from "../services/pos-return.service";
import {
  contextOf,
  idempotencyKeyHashOf,
  requireActor,
  runIdempotent,
  sendJson,
} from "./pos-controller.support";
import { toPosJson, toPosPage } from "./pos.serializers";

export async function createReturn(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = requireActor(req);
    await runIdempotent(req, res, {
      operation: "sales.returns.create",
      resourceKey: `sale:${req.params.saleId}`,
      statusCode: 201,
      execute: () =>
        posReturnService.create(
          actor,
          req.params.saleId,
          req.body,
          contextOf(req),
        ),
      serialize: (entity) => ({ return: toPosJson(entity) }),
    });
  } catch (error) {
    next(error);
  }
}

export async function listReturns(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = requireActor(req);
    const page = await posReturnService.list(actor, {
      saleId: req.query.saleId as string | undefined,
      registerId: req.query.registerId as string | undefined,
      shiftId: req.query.shiftId as string | undefined,
      status: req.query.status as PosReturnStatus | undefined,
      operationalDate: req.query.operationalDate as string | undefined,
      limit: req.query.limit as number | undefined,
      cursor: req.query.cursor as string | undefined,
    });
    sendJson(res, toPosPage(page));
  } catch (error) {
    next(error);
  }
}

export async function getReturn(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = requireActor(req);
    const entity = await posReturnService.get(actor, req.params.returnId);
    sendJson(res, { return: toPosJson(entity) });
  } catch (error) {
    next(error);
  }
}

export async function approveReturn(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = requireActor(req);
    await runIdempotent(req, res, {
      operation: "returns.approve",
      resourceKey: `return:${req.params.returnId}`,
      execute: () =>
        posReturnService.approve(actor, req.params.returnId, contextOf(req)),
      serialize: (entity) => ({ return: toPosJson(entity) }),
    });
  } catch (error) {
    next(error);
  }
}

export async function rejectReturn(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = requireActor(req);
    const entity = await posReturnService.reject(
      actor,
      req.params.returnId,
      req.body.reason,
      contextOf(req),
    );
    sendJson(res, { return: toPosJson(entity) });
  } catch (error) {
    next(error);
  }
}

export async function cancelReturn(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = requireActor(req);
    const entity = await posReturnService.cancel(
      actor,
      req.params.returnId,
      req.body.reason,
      contextOf(req),
    );
    sendJson(res, { return: toPosJson(entity) });
  } catch (error) {
    next(error);
  }
}

/** Aplica el reembolso, repone inventario si corresponde y cierra la devolución. */
export async function completeReturn(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = requireActor(req);
    await runIdempotent(req, res, {
      operation: "returns.complete",
      resourceKey: `return:${req.params.returnId}`,
      execute: () =>
        posReturnService.complete(
          actor,
          req.params.returnId,
          req.body ?? {},
          idempotencyKeyHashOf(req),
          contextOf(req),
        ),
    });
  } catch (error) {
    next(error);
  }
}
