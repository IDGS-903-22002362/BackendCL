/**
 * Contexto operativo y configuración del POS.
 *
 * `GET /context` es la primera llamada de la terminal: devuelve quién es el actor, qué
 * puede hacer, cuál es su turno activo y los límites vigentes. La configuración sensible
 * (umbrales de diferencia, límites de descuento) solo se expone completa a quien administra
 * la configuración; el cajero recibe únicamente lo que necesita para operar y nada que
 * permita inferir el efectivo esperado antes del arqueo.
 */

import { NextFunction, Request, Response } from "express";
import { operationalDateOf } from "../domain/operational-date";
import { PosAuditEntity, PosAuditEventType } from "../models/pos.enums";
import type { PosSettings } from "../models/pos.types";
import { posAuditService } from "../services/pos-audit.service";
import { posOperatorService } from "../services/pos-operator.service";
import { posRegisterService } from "../services/pos-register.service";
import { posSettingsService } from "../services/pos-settings.service";
import { posShiftService } from "../services/pos-shift.service";
import { contextOf, requireActor, sendJson } from "./pos-controller.support";
import { toActorJson, toPosJson } from "./pos.serializers";
import type {
  OperatorUidParam,
  UpdateOperatorBody,
  UpdateSettingsBody,
} from "../validators/pos.validators";

/** Subconjunto necesario para operar una caja, sin umbrales de revisión. */
function operationalSettingsView(settings: PosSettings) {
  return {
    storeId: settings.storeId,
    storeName: settings.storeName,
    timezone: settings.timezone,
    currency: settings.currency,
    denominationsMinor: [...settings.denominationsMinor],
    maxLinesPerSale: settings.maxLinesPerSale,
    maxQuantityPerLine: settings.maxQuantityPerLine,
    maxNoteLength: settings.maxNoteLength,
    maxSaleTotalMinor: settings.maxSaleTotalMinor,
    cashMovementMaxMinor: settings.cashMovementMaxMinor,
    securityDropMaxMinor: settings.securityDropMaxMinor,
    transferMaxMinor: settings.transferMaxMinor,
    openingFloatMaxMinor: settings.openingFloatMaxMinor,
    suspendedSaleTtlMinutes: settings.suspendedSaleTtlMinutes,
    draftSaleTtlMinutes: settings.draftSaleTtlMinutes,
    defaultPageSize: settings.defaultPageSize,
    maxPageSize: settings.maxPageSize,
    manualDiscountMaxPercent: settings.manualDiscountMaxPercent,
    ticketFooterLegend: settings.ticketFooterLegend,
  };
}

export async function getContext(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = requireActor(req);
    const settings = await posSettingsService.get();
    const shift = await posShiftService.findMyActiveShift(actor);
    const registerState = shift
      ? await posRegisterService.getState(actor, shift.registerId)
      : null;

    sendJson(res, {
      actor: toActorJson(actor),
      operationalDate: operationalDateOf(
        new Date(),
        settings.operationalDayCutoffHour,
      ),
      appCheckVerified: contextOf(req)?.appCheckVerified ?? false,
      activeShift: shift ? toPosJson(shift) : null,
      register: registerState ? toPosJson(registerState) : null,
      settings: operationalSettingsView(settings),
    });
  } catch (error) {
    next(error);
  }
}

export function getCapabilities(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  try {
    const actor = requireActor(req);
    sendJson(res, {
      uid: actor.uid,
      posRole: actor.posRole,
      capabilities: [...actor.capabilities],
    });
  } catch (error) {
    next(error);
  }
}

export async function getSettings(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const settings = await posSettingsService.get();
    sendJson(res, { settings: toPosJson(settings) });
  } catch (error) {
    next(error);
  }
}

export async function updateSettings(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = requireActor(req);
    const body = req.body as UpdateSettingsBody;
    const previous = await posSettingsService.get();

    const settings = await posSettingsService.update(
      body.patch,
      body.expectedVersion,
      actor.uid,
    );

    await posAuditService.record({
      eventType: PosAuditEventType.SETTINGS_UPDATED,
      entity: PosAuditEntity.SETTINGS,
      entityId: settings.storeId,
      actor,
      context: contextOf(req),
      before: { version: previous.version },
      after: { version: settings.version, fields: Object.keys(body.patch) },
    });

    sendJson(res, { settings: toPosJson(settings) });
  } catch (error) {
    next(error);
  }
}

export async function listOperators(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = requireActor(req);
    const limit = Number(req.query.limit ?? 100);
    const operators = await posOperatorService.list(actor, limit);
    sendJson(res, { items: operators.map((entry) => toPosJson(entry)) });
  } catch (error) {
    next(error);
  }
}

export async function getOperator(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = requireActor(req);
    const params = req.params as unknown as OperatorUidParam;
    const operator = await posOperatorService.get(actor, params.uid);
    sendJson(res, { operator: toPosJson(operator) });
  } catch (error) {
    next(error);
  }
}

export async function upsertOperator(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = requireActor(req);
    const params = req.params as unknown as OperatorUidParam;
    const body = req.body as UpdateOperatorBody;
    const result = await posOperatorService.upsert(actor, {
      uid: params.uid,
      posRole: body.posRole,
      active: body.active,
      defaultRegisterId: body.defaultRegisterId,
    });

    await posAuditService.record({
      eventType: PosAuditEventType.OPERATOR_UPDATED,
      entity: PosAuditEntity.OPERATOR,
      entityId: params.uid,
      actor,
      context: contextOf(req),
      before: result.previous
        ? {
            posRole: result.previous.posRole,
            active: result.previous.active,
          }
        : null,
      after: {
        posRole: result.next.posRole,
        active: result.next.active,
        defaultRegisterId: result.next.defaultRegisterId ?? null,
      },
      reason: body.reason,
    });

    sendJson(res, { operator: toPosJson(result.view) });
  } catch (error) {
    next(error);
  }
}
