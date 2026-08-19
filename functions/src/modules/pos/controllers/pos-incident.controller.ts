/**
 * Incidencias operativas.
 *
 * No hay endpoint de borrado: una incidencia cerrada conserva su historial completo.
 */

import { NextFunction, Request, Response } from "express";
import type {
  PosIncidentSeverity,
  PosIncidentStatus,
  PosIncidentType,
} from "../models/pos.enums";
import { posIncidentService } from "../services/pos-incident.service";
import { contextOf, requireActor, sendJson } from "./pos-controller.support";
import { toPosJson, toPosPage } from "./pos.serializers";

export async function createIncident(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = requireActor(req);
    const incident = await posIncidentService.create(
      actor,
      req.body,
      contextOf(req),
    );
    sendJson(res, { incident: toPosJson(incident) }, 201);
  } catch (error) {
    next(error);
  }
}

export async function listIncidents(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = requireActor(req);
    const page = await posIncidentService.list(actor, {
      status: req.query.status as PosIncidentStatus | undefined,
      type: req.query.type as PosIncidentType | undefined,
      severity: req.query.severity as PosIncidentSeverity | undefined,
      registerId: req.query.registerId as string | undefined,
      operationalDate: req.query.operationalDate as string | undefined,
      limit: req.query.limit as number | undefined,
      cursor: req.query.cursor as string | undefined,
    });
    sendJson(res, toPosPage(page));
  } catch (error) {
    next(error);
  }
}

export async function getIncident(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = requireActor(req);
    const incident = await posIncidentService.get(actor, req.params.incidentId);
    sendJson(res, { incident: toPosJson(incident) });
  } catch (error) {
    next(error);
  }
}

export async function assignIncident(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = requireActor(req);
    const incident = await posIncidentService.assign(
      actor,
      req.params.incidentId,
      req.body.assignedTo,
      req.body.note,
      contextOf(req),
    );
    sendJson(res, { incident: toPosJson(incident) });
  } catch (error) {
    next(error);
  }
}

export async function resolveIncident(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = requireActor(req);
    const incident = await posIncidentService.resolve(
      actor,
      req.params.incidentId,
      req.body.resolution,
      contextOf(req),
    );
    sendJson(res, { incident: toPosJson(incident) });
  } catch (error) {
    next(error);
  }
}

export async function dismissIncident(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = requireActor(req);
    const incident = await posIncidentService.dismiss(
      actor,
      req.params.incidentId,
      req.body.reason,
      contextOf(req),
    );
    sendJson(res, { incident: toPosJson(incident) });
  } catch (error) {
    next(error);
  }
}

export async function escalateIncident(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = requireActor(req);
    const incident = await posIncidentService.escalate(
      actor,
      req.params.incidentId,
      req.body.reason,
      contextOf(req),
    );
    sendJson(res, { incident: toPosJson(incident) });
  } catch (error) {
    next(error);
  }
}
