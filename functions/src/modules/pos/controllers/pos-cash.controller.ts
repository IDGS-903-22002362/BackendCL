/**
 * Movimientos de efectivo: entradas, salidas, retiros de seguridad, reposiciones y
 * transferencias entre cajas.
 *
 * Todo movimiento nace de una solicitud con motivo y termina aprobado, rechazado,
 * cancelado o recibido. Nada se edita: una corrección crea una reversa.
 */

import { NextFunction, Request, Response } from "express";
import type {
  PosCashMovementStatus,
  PosCashMovementType,
} from "../models/pos.enums";
import { posCashMovementService } from "../services/pos-cash-movement.service";
import {
  contextOf,
  idempotencyKeyHashOf,
  requireActor,
  runIdempotent,
  sendJson,
} from "./pos-controller.support";
import { toPosJson, toPosPage } from "./pos.serializers";

export async function listCashMovements(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = requireActor(req);
    const page = await posCashMovementService.list(actor, {
      registerId: req.query.registerId as string | undefined,
      sessionId: req.query.sessionId as string | undefined,
      shiftId: req.query.shiftId as string | undefined,
      type: req.query.type as PosCashMovementType | undefined,
      status: req.query.status as PosCashMovementStatus | undefined,
      operationalDate: req.query.operationalDate as string | undefined,
      limit: req.query.limit as number | undefined,
      cursor: req.query.cursor as string | undefined,
    });
    sendJson(res, toPosPage(page));
  } catch (error) {
    next(error);
  }
}

export async function createCashMovement(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = requireActor(req);
    await runIdempotent(req, res, {
      operation: "cash-movements.create",
      resourceKey: `shift:${req.body.shiftId ?? "own"}`,
      statusCode: 201,
      execute: () =>
        posCashMovementService.create(
          actor,
          req.body,
          idempotencyKeyHashOf(req),
          contextOf(req),
        ),
      serialize: (movement) => ({ movement: toPosJson(movement) }),
    });
  } catch (error) {
    next(error);
  }
}

export async function getCashMovement(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = requireActor(req);
    const movement = await posCashMovementService.get(
      actor,
      req.params.movementId,
    );
    sendJson(res, { movement: toPosJson(movement) });
  } catch (error) {
    next(error);
  }
}

export async function approveCashMovement(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = requireActor(req);
    await runIdempotent(req, res, {
      operation: "cash-movements.approve",
      resourceKey: `movement:${req.params.movementId}`,
      execute: () =>
        posCashMovementService.approve(
          actor,
          req.params.movementId,
          req.body?.note,
          contextOf(req),
        ),
      serialize: (movement) => ({ movement: toPosJson(movement) }),
    });
  } catch (error) {
    next(error);
  }
}

export async function rejectCashMovement(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = requireActor(req);
    const movement = await posCashMovementService.reject(
      actor,
      req.params.movementId,
      req.body.reason,
      contextOf(req),
    );
    sendJson(res, { movement: toPosJson(movement) });
  } catch (error) {
    next(error);
  }
}

export async function cancelCashMovement(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = requireActor(req);
    const movement = await posCashMovementService.cancel(
      actor,
      req.params.movementId,
      req.body.reason,
      contextOf(req),
    );
    sendJson(res, { movement: toPosJson(movement) });
  } catch (error) {
    next(error);
  }
}

export async function confirmCashMovementDelivery(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = requireActor(req);
    await runIdempotent(req, res, {
      operation: "cash-movements.confirm-delivery",
      resourceKey: `movement:${req.params.movementId}`,
      execute: () =>
        posCashMovementService.confirmDelivery(
          actor,
          req.params.movementId,
          contextOf(req),
        ),
      serialize: (movement) => ({ movement: toPosJson(movement) }),
    });
  } catch (error) {
    next(error);
  }
}

export async function confirmCashMovementReceipt(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = requireActor(req);
    await runIdempotent(req, res, {
      operation: "cash-movements.confirm-receipt",
      resourceKey: `movement:${req.params.movementId}`,
      execute: () =>
        posCashMovementService.confirmReceipt(
          actor,
          req.params.movementId,
          req.body ?? {},
          contextOf(req),
        ),
    });
  } catch (error) {
    next(error);
  }
}

/** Reversa contable de un movimiento ya efectivo. El original no se modifica. */
export async function reverseCashMovement(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = requireActor(req);
    await runIdempotent(req, res, {
      operation: "cash-movements.reverse",
      resourceKey: `movement:${req.params.movementId}`,
      statusCode: 201,
      execute: () =>
        posCashMovementService.reverse(
          actor,
          req.params.movementId,
          req.body.reason,
          contextOf(req),
        ),
      serialize: (movement) => ({ movement: toPosJson(movement) }),
    });
  } catch (error) {
    next(error);
  }
}
