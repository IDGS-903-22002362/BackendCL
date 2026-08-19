/**
 * Cierre consolidado del día.
 *
 * `readiness` y `preview` no mutan nada. `close` exige cero bloqueos; `force-close` exige
 * motivo, capacidad especial y deja incidencia con la lista de bloqueos ignorados. La
 * unicidad la garantiza el documento por fecha operativa, no la idempotencia.
 */

import { NextFunction, Request, Response } from "express";
import type { PosDailyCloseStatus } from "../models/pos.enums";
import { posDailyCloseService } from "../services/pos-daily-close.service";
import {
  contextOf,
  requireActor,
  runIdempotent,
  sendJson,
} from "./pos-controller.support";
import { toPosJson, toPosPage } from "./pos.serializers";

export async function getReadiness(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = requireActor(req);
    const readiness = await posDailyCloseService.readiness(
      actor,
      req.params.operationalDate,
    );
    sendJson(res, toPosJson(readiness) as Record<string, unknown>);
  } catch (error) {
    next(error);
  }
}

export async function previewDailyClose(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = requireActor(req);
    const preview = await posDailyCloseService.preview(
      actor,
      req.params.operationalDate,
      contextOf(req),
    );
    sendJson(res, toPosJson(preview) as Record<string, unknown>);
  } catch (error) {
    next(error);
  }
}

export async function closeDay(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = requireActor(req);
    await runIdempotent(req, res, {
      operation: "daily-close.close",
      resourceKey: `date:${req.params.operationalDate}`,
      statusCode: 201,
      execute: () =>
        posDailyCloseService.close(
          actor,
          req.params.operationalDate,
          contextOf(req),
        ),
      serialize: (entity) => ({ dailyClose: toPosJson(entity) }),
    });
  } catch (error) {
    next(error);
  }
}

export async function forceCloseDay(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = requireActor(req);
    await runIdempotent(req, res, {
      operation: "daily-close.force-close",
      resourceKey: `date:${req.params.operationalDate}`,
      statusCode: 201,
      execute: () =>
        posDailyCloseService.forceClose(
          actor,
          req.params.operationalDate,
          req.body.reason,
          contextOf(req),
        ),
      serialize: (entity) => ({ dailyClose: toPosJson(entity) }),
    });
  } catch (error) {
    next(error);
  }
}

export async function listDailyCloses(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = requireActor(req);
    const page = await posDailyCloseService.list(actor, {
      status: req.query.status as PosDailyCloseStatus | undefined,
      from: req.query.from as string | undefined,
      to: req.query.to as string | undefined,
      limit: req.query.limit as number | undefined,
      cursor: req.query.cursor as string | undefined,
    });
    sendJson(res, toPosPage(page));
  } catch (error) {
    next(error);
  }
}

export async function getDailyClose(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = requireActor(req);
    const entity = await posDailyCloseService.get(
      actor,
      req.params.dailyCloseId,
    );
    sendJson(res, { dailyClose: toPosJson(entity) });
  } catch (error) {
    next(error);
  }
}
