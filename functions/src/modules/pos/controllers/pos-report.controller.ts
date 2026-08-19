/**
 * Reportes operativos, exportaciones y lectura de auditoría.
 *
 * El alcance se recorta en el servicio: quien solo tiene `report.read_own` nunca ve cifras
 * de otro cajero, y las diferencias exigen capacidad de revisión.
 */

import { NextFunction, Request, Response } from "express";
import type {
  PosCashMovementStatus,
  PosCashMovementType,
  PosCutClassification,
  PosExportType,
} from "../models/pos.enums";
import { posAuditService } from "../services/pos-audit.service";
import { posExportService } from "../services/pos-export.service";
import { posReportService } from "../services/pos-report.service";
import type { ReportFilters } from "../services/pos-report.service";
import { posSettingsService } from "../services/pos-settings.service";
import {
  contextOf,
  requireActor,
  runIdempotent,
  sendJson,
} from "./pos-controller.support";
import { toPosJson, toPosPage } from "./pos.serializers";

function reportFilters(req: Request): ReportFilters {
  return {
    from: req.query.from as string | undefined,
    to: req.query.to as string | undefined,
    registerId: req.query.registerId as string | undefined,
    cashierUid: req.query.cashierUid as string | undefined,
  };
}

export async function shiftsReport(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = requireActor(req);
    const report = await posReportService.shifts(actor, reportFilters(req));
    sendJson(res, toPosJson(report) as Record<string, unknown>);
  } catch (error) {
    next(error);
  }
}

export async function registersReport(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = requireActor(req);
    const report = await posReportService.registers(actor, reportFilters(req));
    sendJson(res, toPosJson(report) as Record<string, unknown>);
  } catch (error) {
    next(error);
  }
}

export async function cashMovementsReport(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = requireActor(req);
    const report = await posReportService.cashMovements(actor, {
      ...reportFilters(req),
      type: req.query.type as PosCashMovementType | undefined,
      status: req.query.status as PosCashMovementStatus | undefined,
    });
    sendJson(res, toPosJson(report) as Record<string, unknown>);
  } catch (error) {
    next(error);
  }
}

export async function differencesReport(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = requireActor(req);
    const report = await posReportService.differences(actor, {
      ...reportFilters(req),
      classification: req.query.classification as
        | PosCutClassification
        | undefined,
    });
    sendJson(res, toPosJson(report) as Record<string, unknown>);
  } catch (error) {
    next(error);
  }
}

export async function dailySummaryReport(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = requireActor(req);
    const report = await posReportService.dailySummary(
      actor,
      reportFilters(req),
    );
    sendJson(res, toPosJson(report) as Record<string, unknown>);
  } catch (error) {
    next(error);
  }
}

export async function paymentReconciliationReport(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = requireActor(req);
    const report = await posReportService.paymentReconciliation(
      actor,
      reportFilters(req),
    );
    sendJson(res, toPosJson(report) as Record<string, unknown>);
  } catch (error) {
    next(error);
  }
}

// ------------------------------------------------------------ exportaciones

export async function createExport(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = requireActor(req);
    await runIdempotent(req, res, {
      operation: "exports.create",
      resourceKey: `type:${String(req.body.type)}`,
      statusCode: 201,
      execute: () =>
        posExportService.create(actor, req.body, contextOf(req)),
      serialize: (entity) => ({ export: toPosJson(entity) }),
    });
  } catch (error) {
    next(error);
  }
}

export async function listExports(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = requireActor(req);
    const page = await posExportService.list(actor, {
      type: req.query.type as PosExportType | undefined,
      limit: req.query.limit as number | undefined,
      cursor: req.query.cursor as string | undefined,
    });
    sendJson(res, toPosPage(page));
  } catch (error) {
    next(error);
  }
}

export async function getExport(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = requireActor(req);
    const entity = await posExportService.get(actor, req.params.exportId);
    sendJson(res, { export: toPosJson(entity) });
  } catch (error) {
    next(error);
  }
}

/** Descarga del CSV ya generado. El nombre de archivo no expone rutas internas. */
export async function downloadExport(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = requireActor(req);
    const file = await posExportService.download(actor, req.params.exportId);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${file.filename}"`,
    );
    res.status(200).send(file.content);
  } catch (error) {
    next(error);
  }
}

// ---------------------------------------------------------------- auditoría

export async function listAuditEvents(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    requireActor(req);
    const settings = await posSettingsService.get();
    const page = await posAuditService.list({
      entity: req.query.entity as string | undefined,
      entityId: req.query.entityId as string | undefined,
      actorUid: req.query.actorUid as string | undefined,
      eventType: req.query.eventType as string | undefined,
      operationalDate: req.query.operationalDate as string | undefined,
      limit: Math.min(
        (req.query.limit as number | undefined) ?? settings.defaultPageSize,
        settings.maxPageSize,
      ),
      cursor: req.query.cursor as string | undefined,
    });
    sendJson(res, {
      items: page.items.map((item) => toPosJson(item)),
      pagination: {
        nextCursor: page.nextCursor,
        hasMore: Boolean(page.nextCursor),
      },
    });
  } catch (error) {
    next(error);
  }
}
