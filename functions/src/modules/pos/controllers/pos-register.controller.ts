/**
 * Cajas, sesiones de caja y turnos.
 *
 * Cada operación que crea estado (apertura, inicio de turno, entrega, cierre forzado) es
 * idempotente: el POS opera sobre red inestable y un doble clic o un reintento no puede
 * abrir dos sesiones ni duplicar un turno.
 */

import { NextFunction, Request, Response } from "express";
import type {
  PosRegisterStatus,
  PosSessionStatus,
  PosShiftStatus,
} from "../models/pos.enums";
import { posRegisterService } from "../services/pos-register.service";
import { posShiftService } from "../services/pos-shift.service";
import {
  contextOf,
  requireActor,
  runIdempotent,
  sendJson,
} from "./pos-controller.support";
import { toPosJson, toPosPage } from "./pos.serializers";

// ------------------------------------------------------------------- cajas

export async function listRegisters(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = requireActor(req);
    const page = await posRegisterService.list(actor, {
      status: req.query.status as PosRegisterStatus | undefined,
      includeArchived: req.query.includeArchived as boolean | undefined,
      limit: req.query.limit as number | undefined,
      cursor: req.query.cursor as string | undefined,
    });
    sendJson(res, toPosPage(page));
  } catch (error) {
    next(error);
  }
}

export async function createRegister(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = requireActor(req);
    const register = await posRegisterService.create(
      actor,
      req.body,
      contextOf(req),
    );
    sendJson(res, { register: toPosJson(register) }, 201);
  } catch (error) {
    next(error);
  }
}

export async function getRegister(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = requireActor(req);
    const state = await posRegisterService.getState(
      actor,
      req.params.registerId,
    );
    sendJson(res, toPosJson(state) as Record<string, unknown>);
  } catch (error) {
    next(error);
  }
}

export async function updateRegister(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = requireActor(req);
    const register = await posRegisterService.update(
      actor,
      req.params.registerId,
      req.body,
      contextOf(req),
    );
    sendJson(res, { register: toPosJson(register) });
  } catch (error) {
    next(error);
  }
}

export async function openRegister(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = requireActor(req);
    await runIdempotent(req, res, {
      operation: "registers.open",
      resourceKey: `register:${req.params.registerId}`,
      statusCode: 201,
      execute: () =>
        posRegisterService.open(
          actor,
          req.params.registerId,
          req.body,
          contextOf(req),
        ),
    });
  } catch (error) {
    next(error);
  }
}

export async function blockRegister(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = requireActor(req);
    const register = await posRegisterService.block(
      actor,
      req.params.registerId,
      req.body.reason,
      contextOf(req),
    );
    sendJson(res, { register: toPosJson(register) });
  } catch (error) {
    next(error);
  }
}

export async function unblockRegister(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = requireActor(req);
    const register = await posRegisterService.unblock(
      actor,
      req.params.registerId,
      req.body.reason,
      contextOf(req),
    );
    sendJson(res, { register: toPosJson(register) });
  } catch (error) {
    next(error);
  }
}

export async function archiveRegister(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = requireActor(req);
    const register = await posRegisterService.archive(
      actor,
      req.params.registerId,
      req.body.reason,
      contextOf(req),
    );
    sendJson(res, { register: toPosJson(register) });
  } catch (error) {
    next(error);
  }
}

export async function closeRegister(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = requireActor(req);
    await runIdempotent(req, res, {
      operation: "registers.close",
      resourceKey: `register:${req.params.registerId}`,
      execute: () =>
        posRegisterService.close(actor, req.params.registerId, contextOf(req)),
    });
  } catch (error) {
    next(error);
  }
}

export async function forceCloseRegister(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = requireActor(req);
    await runIdempotent(req, res, {
      operation: "registers.force-close",
      resourceKey: `register:${req.params.registerId}`,
      execute: () =>
        posRegisterService.forceClose(
          actor,
          req.params.registerId,
          req.body.reason,
          contextOf(req),
        ),
    });
  } catch (error) {
    next(error);
  }
}

// ---------------------------------------------------------------- sesiones

export async function listSessions(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = requireActor(req);
    const page = await posRegisterService.listSessions(actor, {
      registerId: req.query.registerId as string | undefined,
      status: req.query.status as PosSessionStatus | undefined,
      operationalDate: req.query.operationalDate as string | undefined,
      limit: req.query.limit as number | undefined,
      cursor: req.query.cursor as string | undefined,
    });
    sendJson(res, toPosPage(page));
  } catch (error) {
    next(error);
  }
}

export async function getSession(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = requireActor(req);
    const result = await posRegisterService.getSession(
      actor,
      req.params.sessionId,
    );
    sendJson(res, {
      session: toPosJson(result.session),
      shifts: result.shifts.map((shift) => toPosJson(shift)),
    });
  } catch (error) {
    next(error);
  }
}

// ------------------------------------------------------------------ turnos

export async function startShift(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = requireActor(req);
    await runIdempotent(req, res, {
      operation: "sessions.shifts.start",
      resourceKey: `session:${req.params.sessionId}`,
      statusCode: 201,
      execute: () =>
        posShiftService.startShiftInSession(
          actor,
          req.params.sessionId,
          req.body,
          contextOf(req),
        ),
      serialize: (shift) => ({ shift: toPosJson(shift) }),
    });
  } catch (error) {
    next(error);
  }
}

export async function listShifts(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = requireActor(req);
    const page = await posShiftService.list(actor, {
      registerId: req.query.registerId as string | undefined,
      sessionId: req.query.sessionId as string | undefined,
      cashierUid: req.query.cashierUid as string | undefined,
      status: req.query.status as PosShiftStatus | undefined,
      operationalDate: req.query.operationalDate as string | undefined,
      limit: req.query.limit as number | undefined,
      cursor: req.query.cursor as string | undefined,
    });
    sendJson(res, toPosPage(page));
  } catch (error) {
    next(error);
  }
}

export async function getMyShift(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = requireActor(req);
    const shift = await posShiftService.findMyActiveShift(actor);
    sendJson(res, { shift: shift ? toPosJson(shift) : null });
  } catch (error) {
    next(error);
  }
}

export async function getShift(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = requireActor(req);
    const shift = await posShiftService.get(actor, req.params.shiftId);
    sendJson(res, { shift: toPosJson(shift) });
  } catch (error) {
    next(error);
  }
}

export async function getShiftTimeline(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = requireActor(req);
    const timeline = await posShiftService.getTimeline(
      actor,
      req.params.shiftId,
    );
    sendJson(res, toPosJson(timeline) as Record<string, unknown>);
  } catch (error) {
    next(error);
  }
}

export async function requestHandoff(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = requireActor(req);
    await runIdempotent(req, res, {
      operation: "shifts.request-handoff",
      resourceKey: `shift:${req.params.shiftId}`,
      execute: () =>
        posShiftService.requestHandoff(
          actor,
          req.params.shiftId,
          req.body,
          contextOf(req),
        ),
    });
  } catch (error) {
    next(error);
  }
}

export async function completeHandoff(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = requireActor(req);
    await runIdempotent(req, res, {
      operation: "shifts.complete-handoff",
      resourceKey: `shift:${req.params.shiftId}`,
      execute: () =>
        posShiftService.completeHandoff(
          actor,
          req.params.shiftId,
          req.body,
          contextOf(req),
        ),
    });
  } catch (error) {
    next(error);
  }
}

export async function endShift(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = requireActor(req);
    await runIdempotent(req, res, {
      operation: "shifts.end",
      resourceKey: `shift:${req.params.shiftId}`,
      execute: () =>
        posShiftService.endShift(actor, req.params.shiftId, contextOf(req)),
      serialize: (shift) => ({ shift: toPosJson(shift) }),
    });
  } catch (error) {
    next(error);
  }
}

export async function forceCloseShift(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = requireActor(req);
    await runIdempotent(req, res, {
      operation: "shifts.force-close",
      resourceKey: `shift:${req.params.shiftId}`,
      execute: () =>
        posShiftService.forceCloseShift(
          actor,
          req.params.shiftId,
          req.body.reason,
          contextOf(req),
        ),
      serialize: (shift) => ({ shift: toPosJson(shift) }),
    });
  } catch (error) {
    next(error);
  }
}
