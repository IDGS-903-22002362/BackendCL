/**
 * Cortes de caja y conciliación.
 *
 * El cierre es autónomo del cajero: el envío del conteo aprueba el corte sin un
 * supervisor. Los totales se filtran por capacidades dentro del servicio.
 */

import { NextFunction, Request, Response } from "express";
import type {
  PosCutClassification,
  PosCutScope,
  PosCutStatus,
} from "../models/pos.enums";
import { posCutService } from "../services/pos-cut.service";
import {
  contextOf,
  requireActor,
  runIdempotent,
  sendJson,
} from "./pos-controller.support";
import { toPosJson, toPosPage } from "./pos.serializers";

// ------------------------------------------------------------------ arqueos

/** Congela el turno y abre el arqueo. Sin este paso no se puede capturar el conteo. */
export async function startCount(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = requireActor(req);
    await runIdempotent(req, res, {
      operation: "shifts.start-count",
      resourceKey: `shift:${req.params.shiftId}`,
      statusCode: 201,
      execute: () =>
        posCutService.startCount(actor, req.params.shiftId, contextOf(req)),
      serialize: (cut) => ({ cut: toPosJson(cut) }),
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Envía el conteo (total o denominaciones). El backend recalcula desde denominaciones
 * cuando existen; si solo hay total, valida el entero. Cierra el corte de forma autónoma.
 */
export async function submitCashCount(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = requireActor(req);
    await runIdempotent(req, res, {
      operation: "shifts.cash-counts.submit",
      resourceKey: `shift:${req.params.shiftId}`,
      statusCode: 201,
      execute: () =>
        posCutService.submitCount(
          actor,
          req.params.shiftId,
          req.body,
          contextOf(req),
        ),
      serialize: (result) => ({
        count: toPosJson(result.count),
        cut: toPosJson(result.cut),
      }),
    });
  } catch (error) {
    next(error);
  }
}

/** Cancela el conteo en curso y reabre el turno para ventas. */
export async function cancelCount(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = requireActor(req);
    await runIdempotent(req, res, {
      operation: "shifts.cancel-count",
      resourceKey: `shift:${req.params.shiftId}`,
      statusCode: 200,
      execute: () =>
        posCutService.cancelCount(actor, req.params.shiftId, contextOf(req)),
      serialize: (cut) => ({ cut: toPosJson(cut) }),
    });
  } catch (error) {
    next(error);
  }
}

/** Vista previa del corte del turno con totales calculados en backend. */
export async function previewCut(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = requireActor(req);
    const preview = await posCutService.previewCut(actor, req.params.shiftId);
    sendJson(res, { preview: toPosJson(preview) });
  } catch (error) {
    next(error);
  }
}

export async function listCashCounts(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = requireActor(req);
    const counts = await posCutService.listCounts(actor, req.params.shiftId);
    sendJson(res, { items: counts.map((count) => toPosJson(count)) });
  } catch (error) {
    next(error);
  }
}

export async function getCashCount(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = requireActor(req);
    const count = await posCutService.getCount(actor, req.params.countId);
    sendJson(res, { count: toPosJson(count) });
  } catch (error) {
    next(error);
  }
}

// ------------------------------------------------------------------- cortes

export async function listCuts(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = requireActor(req);
    const page = await posCutService.list(actor, {
      registerId: req.query.registerId as string | undefined,
      sessionId: req.query.sessionId as string | undefined,
      shiftId: req.query.shiftId as string | undefined,
      cashierUid: req.query.cashierUid as string | undefined,
      status: req.query.status as PosCutStatus | undefined,
      classification: req.query.classification as
        | PosCutClassification
        | undefined,
      scope: req.query.scope as PosCutScope | undefined,
      operationalDate: req.query.operationalDate as string | undefined,
      limit: req.query.limit as number | undefined,
      cursor: req.query.cursor as string | undefined,
    });
    sendJson(res, toPosPage(page));
  } catch (error) {
    next(error);
  }
}

export async function getCut(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = requireActor(req);
    const cut = await posCutService.get(actor, req.params.cutId);
    sendJson(res, { cut: toPosJson(cut) });
  } catch (error) {
    next(error);
  }
}

export async function listCutVersions(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = requireActor(req);
    const versions = await posCutService.listVersions(actor, req.params.cutId);
    sendJson(res, { items: versions.map((version) => toPosJson(version)) });
  } catch (error) {
    next(error);
  }
}

export async function reviewCut(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = requireActor(req);
    const cut = await posCutService.review(
      actor,
      req.params.cutId,
      contextOf(req),
    );
    sendJson(res, { cut: toPosJson(cut) });
  } catch (error) {
    next(error);
  }
}

export async function requestCutClarification(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = requireActor(req);
    const cut = await posCutService.requestClarification(
      actor,
      req.params.cutId,
      req.body.reason,
      contextOf(req),
    );
    sendJson(res, { cut: toPosJson(cut) });
  } catch (error) {
    next(error);
  }
}

export async function requestSecondCount(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = requireActor(req);
    const cut = await posCutService.requestSecondCount(
      actor,
      req.params.cutId,
      req.body.reason,
      contextOf(req),
    );
    sendJson(res, { cut: toPosJson(cut) });
  } catch (error) {
    next(error);
  }
}

export async function approveCut(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = requireActor(req);
    await runIdempotent(req, res, {
      operation: "cuts.approve",
      resourceKey: `cut:${req.params.cutId}`,
      execute: () =>
        posCutService.approve(
          actor,
          req.params.cutId,
          req.body?.observations,
          contextOf(req),
        ),
      serialize: (cut) => ({ cut: toPosJson(cut) }),
    });
  } catch (error) {
    next(error);
  }
}

export async function rejectCut(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = requireActor(req);
    const cut = await posCutService.reject(
      actor,
      req.params.cutId,
      req.body.reason,
      contextOf(req),
    );
    sendJson(res, { cut: toPosJson(cut) });
  } catch (error) {
    next(error);
  }
}

export async function escalateCut(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = requireActor(req);
    const cut = await posCutService.escalate(
      actor,
      req.params.cutId,
      req.body.reason,
      contextOf(req),
    );
    sendJson(res, { cut: toPosJson(cut) });
  } catch (error) {
    next(error);
  }
}

export async function reopenCut(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = requireActor(req);
    const cut = await posCutService.reopen(
      actor,
      req.params.cutId,
      req.body.reason,
      contextOf(req),
    );
    sendJson(res, { cut: toPosJson(cut) });
  } catch (error) {
    next(error);
  }
}

/** Corte consolidado de la sesión de caja a partir de los cortes de turno. */
export async function buildSessionCut(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = requireActor(req);
    await runIdempotent(req, res, {
      operation: "sessions.cuts.build",
      resourceKey: `session:${req.params.sessionId}`,
      statusCode: 201,
      execute: () =>
        posCutService.buildSessionCut(
          actor,
          req.params.sessionId,
          contextOf(req),
        ),
      serialize: (cut) => ({ cut: toPosJson(cut) }),
    });
  } catch (error) {
    next(error);
  }
}
