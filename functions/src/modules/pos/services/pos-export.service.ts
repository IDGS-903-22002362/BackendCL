/**
 * Exportaciones CSV de los reportes operativos.
 *
 * Decisiones:
 *
 * - Formato único CSV. El repositorio no tiene librería de XLSX ni infraestructura de PDF
 *   mantenida, así que no se añade una dependencia solo para exportar.
 * - El contenido se genera en la misma petición y se guarda en el documento de exportación.
 *   El volumen está acotado por `maxExportRows` y por un tope de bytes, de modo que no hace
 *   falta un sistema de colas: si el resultado excede el tope, la exportación falla con un
 *   motivo claro en lugar de degradar la petición.
 * - No se exponen rutas internas ni URLs firmadas: el contenido se sirve por el propio API,
 *   con permisos y expiración, lo que elimina el riesgo de path traversal.
 * - Los reportes se generan con el mismo servicio que la consulta interactiva, así que
 *   respetan permisos, alcance por cajero y arqueo ciego sin duplicar reglas.
 */

import { Timestamp } from "firebase-admin/firestore";
import { POS_STORE_ID } from "../constants/pos.constants";
import PosProblemError from "../errors/pos-problem.error";
import {
  PosAuditEntity,
  PosAuditEventType,
  PosCapability,
  PosCashMovementStatus,
  PosCashMovementType,
  PosCutClassification,
  PosExportStatus,
  PosExportType,
} from "../models/pos.enums";
import type {
  PosActor,
  PosAuditEvent,
  PosExport,
  PosPageResult,
  PosRequestContext,
} from "../models/pos.types";
import {
  POS_CONSOLIDATION_HARD_LIMIT,
  posExportRepository,
  posSaleRepository,
} from "../repositories/pos-operational.repository";
import { posAuditService } from "./pos-audit.service";
import { posAuthorizationService } from "./pos-authorization.service";
import { posFolioService } from "./pos-folio.service";
import { posReportService, type ReportFilters } from "./pos-report.service";
import posSettingsService from "./pos-settings.service";

/** Tope de bytes del contenido inline. Muy por debajo del límite de 1 MiB por documento. */
const MAX_EXPORT_BYTES = 700_000;

export interface CreateExportInput extends ReportFilters {
  type: PosExportType;
  movementType?: PosCashMovementType;
  movementStatus?: PosCashMovementStatus;
  classification?: PosCutClassification;
}

type CsvValue = string | number | boolean | null | undefined;

/**
 * Escapa un valor para CSV y neutraliza la inyección de fórmulas: una celda que empieza con
 * `=`, `+`, `-`, `@`, tabulador o retorno de carro se prefija con apóstrofo para que la hoja
 * de cálculo la trate como texto.
 */
export function csvCell(value: CsvValue): string {
  if (value === null || value === undefined) {
    return "";
  }
  const raw = typeof value === "string" ? value : String(value);
  const neutralized = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  if (/[",\n\r;]/.test(neutralized)) {
    return `"${neutralized.replace(/"/g, '""')}"`;
  }
  return neutralized;
}

export function toCsv(
  headers: readonly string[],
  rows: readonly CsvValue[][],
): string {
  const lines = [headers.map(csvCell).join(",")];
  for (const row of rows) {
    lines.push(row.map(csvCell).join(","));
  }
  // CRLF: es lo que esperan Excel y Google Sheets al abrir un CSV descargado.
  return `${lines.join("\r\n")}\r\n`;
}

class PosExportService {
  /** Crea y procesa la exportación. Devuelve el documento sin el contenido. */
  async create(
    actor: PosActor,
    input: CreateExportInput,
    context: PosRequestContext | null,
  ): Promise<PosExport> {
    posAuthorizationService.requireAnyCapability(actor, [
      PosCapability.REPORT_READ_OWN,
      PosCapability.REPORT_READ_ALL,
    ]);
    if (input.type === PosExportType.AUDIT_EVENTS) {
      posAuthorizationService.requireCapability(actor, PosCapability.AUDIT_READ);
    }

    const settings = await posSettingsService.get();
    const range = await posReportService.resolveRange(input);

    const created = await posExportRepository.create({
      storeId: POS_STORE_ID,
      type: input.type,
      status: PosExportStatus.PROCESSING,
      format: "CSV",
      filters: {
        from: range.from,
        to: range.to,
        registerId: input.registerId ?? null,
        cashierUid: input.cashierUid ?? null,
        movementType: input.movementType ?? null,
        movementStatus: input.movementStatus ?? null,
        classification: input.classification ?? null,
      },
      rowCount: 0,
      byteSize: 0,
      content: null,
      failureReason: null,
      requestedBy: actor.uid,
      expiresAt: Timestamp.fromMillis(
        Date.now() + settings.exportTtlHours * 60 * 60 * 1000,
      ),
      completedAt: null,
    });

    try {
      const { headers, rows } = await this.buildRows(actor, input);
      if (rows.length > settings.maxExportRows) {
        throw new PosProblemError(
          "EXPORT_RANGE_TOO_LARGE",
          `La exportación produjo ${rows.length} renglones y el límite es ${settings.maxExportRows}. Reduce el rango o agrega filtros.`,
        );
      }

      const content = toCsv(headers, rows);
      const byteSize = Buffer.byteLength(content, "utf8");
      if (byteSize > MAX_EXPORT_BYTES) {
        throw new PosProblemError(
          "EXPORT_RANGE_TOO_LARGE",
          "La exportación excede el tamaño máximo permitido. Reduce el rango o agrega filtros.",
        );
      }

      const completed = await posExportRepository.update(
        created.id,
        {
          status: PosExportStatus.COMPLETED,
          rowCount: rows.length,
          byteSize,
          content,
          completedAt: Timestamp.now(),
        },
        created.version,
      );

      await posAuditService.record({
        eventType: PosAuditEventType.REPORT_EXPORTED,
        entity: PosAuditEntity.EXPORT,
        entityId: created.id,
        actor,
        context,
        after: {
          type: input.type,
          from: range.from,
          to: range.to,
          rowCount: rows.length,
          byteSize,
        },
      });

      return this.withoutContent(completed);
    } catch (error) {
      const failureReason =
        error instanceof PosProblemError
          ? error.message
          : "La exportación no pudo generarse.";
      await posExportRepository.update(
        created.id,
        {
          status: PosExportStatus.FAILED,
          failureReason,
          completedAt: Timestamp.now(),
        },
        created.version,
      );
      throw error;
    }
  }

  /** Metadatos de la exportación, sin contenido. */
  async get(actor: PosActor, exportId: string): Promise<PosExport> {
    return this.withoutContent(await this.load(actor, exportId));
  }

  /** Contenido CSV. Falla si no está completada o si ya expiró. */
  async download(
    actor: PosActor,
    exportId: string,
  ): Promise<{ filename: string; content: string }> {
    const entity = await this.load(actor, exportId);
    if (entity.status !== PosExportStatus.COMPLETED || !entity.content) {
      throw new PosProblemError("EXPORT_NOT_READY");
    }
    const folio = await posFolioService.next(
      "EXPORT",
      String(entity.filters.from ?? entity.createdAt.toDate().toISOString().slice(0, 10)),
    );
    return {
      filename: `${entity.type.toLowerCase()}-${folio}.csv`,
      content: entity.content,
    };
  }

  async list(
    actor: PosActor,
    filters: { type?: PosExportType; limit?: number; cursor?: string },
  ): Promise<PosPageResult<PosExport>> {
    posAuthorizationService.requireAnyCapability(actor, [
      PosCapability.REPORT_READ_OWN,
      PosCapability.REPORT_READ_ALL,
    ]);
    const settings = await posSettingsService.get();
    const equals: Array<{ field: string; value: unknown }> = [];
    if (filters.type) equals.push({ field: "type", value: filters.type });
    if (!actor.capabilities.includes(PosCapability.REPORT_READ_ALL)) {
      equals.push({ field: "requestedBy", value: actor.uid });
    }

    const page = await posExportRepository.list({
      limit: Math.min(filters.limit ?? settings.defaultPageSize, settings.maxPageSize),
      cursor: filters.cursor,
      orderByField: "createdAt",
      direction: "desc",
      equals,
    });

    return { ...page, items: page.items.map((item) => this.withoutContent(item)) };
  }

  private async load(actor: PosActor, exportId: string): Promise<PosExport> {
    const entity = await posExportRepository.requireById(exportId);
    posAuthorizationService.assertCanReadOwned(
      actor,
      entity.requestedBy,
      PosCapability.REPORT_READ_ALL,
    );
    if (
      entity.status === PosExportStatus.COMPLETED &&
      entity.expiresAt.toMillis() <= Date.now()
    ) {
      // Se marca expirada y se libera el contenido: no tiene sentido conservarlo.
      await posExportRepository.update(
        entity.id,
        { status: PosExportStatus.EXPIRED, content: null },
        entity.version,
      );
      throw new PosProblemError("EXPORT_EXPIRED");
    }
    if (entity.status === PosExportStatus.EXPIRED) {
      throw new PosProblemError("EXPORT_EXPIRED");
    }
    return entity;
  }

  private withoutContent(entity: PosExport): PosExport {
    return { ...entity, content: null };
  }

  private async buildRows(
    actor: PosActor,
    input: CreateExportInput,
  ): Promise<{ headers: string[]; rows: CsvValue[][] }> {
    switch (input.type) {
      case PosExportType.SHIFTS: {
        const report = await posReportService.shifts(actor, input);
        return {
          headers: [
            "fechaOperativa",
            "caja",
            "turnoId",
            "cajero",
            "estado",
            "inicio",
            "fin",
            "fondoInicialMinor",
            "ventas",
            "brutoMinor",
            "descuentoMinor",
            "netoMinor",
            "efectivoMinor",
            "tarjetaMinor",
            "reembolsosMinor",
            "esperadoMinor",
            "contadoMinor",
            "diferenciaMinor",
            "corte",
            "clasificacion",
          ],
          rows: report.rows.map((row) => [
            row.operationalDate,
            row.registerCode,
            row.shiftId,
            row.cashierUid,
            row.status,
            row.startedAt,
            row.endedAt,
            row.receivedFloatMinor,
            row.salesCount,
            row.grossSalesMinor,
            row.discountMinor,
            row.netSalesMinor,
            row.cashSalesMinor,
            row.cardSalesMinor,
            row.cashRefundsMinor + row.cardRefundsMinor,
            row.expectedCashMinor,
            row.countedCashMinor,
            row.differenceMinor,
            row.cutFolio,
            row.classification,
          ]),
        };
      }

      case PosExportType.CASH_MOVEMENTS: {
        const report = await posReportService.cashMovements(actor, {
          ...input,
          type: input.movementType,
          status: input.movementStatus,
        });
        return {
          headers: [
            "fechaOperativa",
            "movimientoId",
            "cajaId",
            "turnoId",
            "tipo",
            "estado",
            "direccion",
            "importeMinor",
            "motivo",
            "solicitante",
            "autorizador",
            "receptor",
            "cajaDestino",
            "creado",
            "resuelto",
          ],
          rows: report.rows.map((row) => [
            row.operationalDate,
            row.movementId,
            row.registerId,
            row.shiftId,
            row.type,
            row.status,
            row.direction,
            row.amountMinor,
            row.reason,
            row.requestedBy,
            row.authorizedBy,
            row.receivedBy,
            row.targetRegisterId,
            row.createdAt,
            row.resolvedAt,
          ]),
        };
      }

      case PosExportType.DIFFERENCES: {
        const report = await posReportService.differences(actor, input);
        return {
          headers: [
            "fechaOperativa",
            "corte",
            "caja",
            "turnoId",
            "cajero",
            "estado",
            "clasificacion",
            "toleranciaMinor",
            "esperadoMinor",
            "contadoMinor",
            "diferenciaMinor",
            "revisor",
            "aprobador",
            "aprobadoEn",
            "incidencias",
          ],
          rows: report.rows.map((row) => [
            row.operationalDate,
            row.folio,
            row.registerCode,
            row.shiftId,
            row.cashierUid,
            row.status,
            row.classification,
            row.toleranceMinor,
            row.expectedCashMinor,
            row.countedCashMinor,
            row.differenceMinor,
            row.reviewerUid,
            row.approverUid,
            row.approvedAt,
            row.incidentIds.join(" "),
          ]),
        };
      }

      case PosExportType.DAILY_SUMMARY: {
        const report = await posReportService.dailySummary(actor, input);
        return {
          headers: [
            "fechaOperativa",
            "estado",
            "cajas",
            "turnos",
            "ventas",
            "netoMinor",
            "reembolsosMinor",
            "esperadoMinor",
            "contadoMinor",
            "diferenciaMinor",
            "faltanteMinor",
            "sobranteMinor",
            "forzado",
            "cerradoEn",
          ],
          rows: report.rows.map((row) => [
            row.operationalDate,
            row.status,
            row.registerCount,
            row.shiftCount,
            row.salesCount,
            row.netSalesMinor,
            row.refundsMinor,
            row.expectedCashMinor,
            row.countedCashMinor,
            row.differenceMinor,
            row.shortageMinor,
            row.overageMinor,
            row.forced,
            row.closedAt,
          ]),
        };
      }

      case PosExportType.SALES: {
        const range = await posReportService.resolveRange(input);
        const cashierUid = posAuthorizationService.scopeCashierFilter(
          actor,
          PosCapability.REPORT_READ_ALL,
          input.cashierUid,
        );
        const equals: Array<{ field: string; value: unknown }> = [];
        if (input.registerId) {
          equals.push({ field: "registerId", value: input.registerId });
        }
        if (cashierUid) equals.push({ field: "cashierUid", value: cashierUid });

        const sales = await posSaleRepository.collectByOperationalDateRange(
          range.from,
          range.to,
          equals,
          POS_CONSOLIDATION_HARD_LIMIT,
        );
        return {
          headers: [
            "fechaOperativa",
            "folio",
            "caja",
            "turnoId",
            "cajero",
            "estado",
            "lineas",
            "brutoMinor",
            "descuentoMinor",
            "totalMinor",
            "pagadoMinor",
            "efectivoMinor",
            "tarjetaMinor",
            "reembolsadoMinor",
            "pagadoEn",
          ],
          rows: sales.map((sale) => [
            sale.operationalDate,
            sale.folio,
            sale.registerCode,
            sale.shiftId,
            sale.cashierUid,
            sale.status,
            sale.items.length,
            sale.totals.subtotalOriginalMinor,
            sale.totals.discountMinor,
            sale.totals.totalMinor,
            sale.payment.paidMinor,
            sale.payment.cashMinor,
            sale.payment.cardMinor,
            sale.payment.refundedMinor,
            sale.paidAt ? sale.paidAt.toDate().toISOString() : null,
          ]),
        };
      }

      case PosExportType.AUDIT_EVENTS: {
        const range = await posReportService.resolveRange(input);
        const settings = await posSettingsService.get();
        const events: CsvValue[][] = [];
        let cursor: string | undefined;
        // La auditoría se pagina por día para no depender de un índice por rango.
        for (const date of this.enumerateDates(range.from, range.to)) {
          cursor = undefined;
          do {
            const page: {
              items: PosAuditEvent[];
              nextCursor: string | null;
            } = await posAuditService.list({
              operationalDate: date,
              limit: 200,
              cursor,
            });
            for (const event of page.items) {
              events.push([
                event.operationalDate,
                event.occurredAt.toDate().toISOString(),
                event.eventType,
                event.entity,
                event.entityId,
                event.actorUid,
                event.actorRole,
                event.result,
                event.registerId,
                event.shiftId,
                event.reason,
                event.requestId,
              ]);
            }
            cursor = page.nextCursor ?? undefined;
          } while (cursor && events.length <= settings.maxExportRows);
          if (events.length > settings.maxExportRows) {
            break;
          }
        }
        return {
          headers: [
            "fechaOperativa",
            "ocurrioEn",
            "evento",
            "entidad",
            "entidadId",
            "actor",
            "rol",
            "resultado",
            "cajaId",
            "turnoId",
            "motivo",
            "requestId",
          ],
          rows: events,
        };
      }

      default:
        throw new PosProblemError(
          "POS_VALIDATION_ERROR",
          "Tipo de exportación no soportado.",
        );
    }
  }

  private enumerateDates(from: string, to: string): string[] {
    const dates: string[] = [];
    const [year, month, day] = from.split("-").map(Number);
    for (let offset = 0; offset < 400; offset += 1) {
      const utc = new Date(Date.UTC(year, month - 1, day + offset));
      const value = [
        utc.getUTCFullYear(),
        String(utc.getUTCMonth() + 1).padStart(2, "0"),
        String(utc.getUTCDate()).padStart(2, "0"),
      ].join("-");
      dates.push(value);
      if (value >= to) {
        break;
      }
    }
    return dates;
  }
}

export const posExportService = new PosExportService();
export default posExportService;
