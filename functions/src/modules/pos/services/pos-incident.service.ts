/**
 * Incidencias operativas.
 *
 * Nunca se eliminan y el historial es acumulativo: cada acción agrega una entrada en lugar
 * de sobrescribir la anterior.
 */

import { POS_STORE_ID, POS_TEXT_LIMITS } from "../constants/pos.constants";
import PosProblemError from "../errors/pos-problem.error";
import { assertTransition } from "../domain/state-machines";
import {
  PosAuditEntity,
  PosAuditEventType,
  PosCapability,
  PosIncidentSeverity,
  PosIncidentStatus,
  PosIncidentType,
} from "../models/pos.enums";
import type {
  OperationalDate,
  PosActor,
  PosIncident,
  PosIncidentHistoryEntry,
  PosPageResult,
  PosRequestContext,
} from "../models/pos.types";
import { nowTimestamp } from "../repositories/pos-firestore";
import { posIncidentRepository } from "../repositories/pos-operational.repository";
import { posAuditService } from "./pos-audit.service";
import { posAuthorizationService } from "./pos-authorization.service";
import { posFolioService } from "./pos-folio.service";
import posSettingsService from "./pos-settings.service";

export interface CreateIncidentInput {
  type: PosIncidentType;
  severity: PosIncidentSeverity;
  operationalDate: OperationalDate;
  description: string;
  registerId?: string | null;
  sessionId?: string | null;
  shiftId?: string | null;
  saleId?: string | null;
  cashMovementId?: string | null;
  cutId?: string | null;
  dailyCloseId?: string | null;
  evidenceUrls?: string[];
}

/** Solo se aceptan URLs https de dominios propios: evita SSRF y filtración de rutas. */
const ALLOWED_EVIDENCE_HOST_SUFFIXES = [
  "firebasestorage.googleapis.com",
  "storage.googleapis.com",
  "clubleon.mx",
  "tiendalaguarida.com",
];

function sanitizeEvidenceUrls(urls: readonly string[] | undefined): string[] {
  if (!urls || urls.length === 0) {
    return [];
  }
  const sanitized: string[] = [];
  for (const raw of urls.slice(0, 10)) {
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      throw new PosProblemError(
        "POS_VALIDATION_ERROR",
        "Las evidencias deben ser URLs absolutas válidas.",
      );
    }
    if (parsed.protocol !== "https:") {
      throw new PosProblemError(
        "POS_VALIDATION_ERROR",
        "Las evidencias deben usar https.",
      );
    }
    const allowed = ALLOWED_EVIDENCE_HOST_SUFFIXES.some(
      (suffix) =>
        parsed.hostname === suffix || parsed.hostname.endsWith(`.${suffix}`),
    );
    if (!allowed) {
      throw new PosProblemError(
        "POS_VALIDATION_ERROR",
        "El dominio de la evidencia no está permitido.",
      );
    }
    sanitized.push(parsed.toString());
  }
  return sanitized;
}

function historyEntry(
  actorUid: string,
  action: string,
  note: string | null,
  fromStatus: PosIncidentStatus | null,
  toStatus: PosIncidentStatus | null,
): PosIncidentHistoryEntry {
  return {
    at: nowTimestamp(),
    actorUid,
    action,
    note: note ? note.slice(0, POS_TEXT_LIMITS.REASON_MAX) : null,
    fromStatus,
    toStatus,
  };
}

class PosIncidentService {
  /** Creación por un actor humano. Requiere `incident.create`. */
  async create(
    actor: PosActor,
    input: CreateIncidentInput,
    context: PosRequestContext | null,
  ): Promise<PosIncident> {
    posAuthorizationService.requireCapability(
      actor,
      PosCapability.INCIDENT_CREATE,
    );
    return this.createInternal(actor.uid, input, actor, context);
  }

  /**
   * Creación como efecto de otra operación (cierre forzado, diferencia crítica,
   * transferencia sin recibir). No revalida capacidades porque la operación que la origina ya
   * fue autorizada.
   */
  async createSystem(
    createdByUid: string,
    input: CreateIncidentInput,
    actor: PosActor | null,
    context: PosRequestContext | null,
  ): Promise<PosIncident> {
    return this.createInternal(createdByUid, input, actor, context);
  }

  private async createInternal(
    createdByUid: string,
    input: CreateIncidentInput,
    actor: PosActor | null,
    context: PosRequestContext | null,
  ): Promise<PosIncident> {
    const description = input.description.trim();
    if (description.length < POS_TEXT_LIMITS.REASON_MIN) {
      throw new PosProblemError(
        "POS_VALIDATION_ERROR",
        `La descripción debe tener al menos ${POS_TEXT_LIMITS.REASON_MIN} caracteres.`,
      );
    }

    const folio = await posFolioService.next("INCIDENT", input.operationalDate);
    const incident = await posIncidentRepository.create({
      storeId: POS_STORE_ID,
      folio,
      type: input.type,
      severity: input.severity,
      status: PosIncidentStatus.OPEN,
      operationalDate: input.operationalDate,
      registerId: input.registerId ?? null,
      sessionId: input.sessionId ?? null,
      shiftId: input.shiftId ?? null,
      saleId: input.saleId ?? null,
      cashMovementId: input.cashMovementId ?? null,
      cutId: input.cutId ?? null,
      dailyCloseId: input.dailyCloseId ?? null,
      description: description.slice(0, POS_TEXT_LIMITS.DESCRIPTION_MAX),
      evidenceUrls: sanitizeEvidenceUrls(input.evidenceUrls),
      createdBy: createdByUid,
      assignedTo: null,
      resolution: null,
      resolvedBy: null,
      resolvedAt: null,
      history: [
        historyEntry(
          createdByUid,
          "created",
          null,
          null,
          PosIncidentStatus.OPEN,
        ),
      ],
    });

    await posAuditService.record({
      eventType: PosAuditEventType.INCIDENT_CREATED,
      entity: PosAuditEntity.INCIDENT,
      entityId: incident.id,
      actor,
      context,
      operationalDate: incident.operationalDate,
      registerId: incident.registerId,
      sessionId: incident.sessionId,
      shiftId: incident.shiftId,
      after: {
        folio: incident.folio,
        type: incident.type,
        severity: incident.severity,
        status: incident.status,
      },
      reason: incident.description,
    });

    return incident;
  }

  async get(actor: PosActor, incidentId: string): Promise<PosIncident> {
    const incident = await posIncidentRepository.requireById(incidentId);
    // Quien no revisa incidencias solo ve las que creó o las de su propio turno.
    if (
      !actor.capabilities.includes(PosCapability.INCIDENT_RESOLVE) &&
      incident.createdBy !== actor.uid
    ) {
      throw new PosProblemError("POS_RESOURCE_NOT_FOUND");
    }
    return incident;
  }

  async list(
    actor: PosActor,
    filters: {
      status?: PosIncidentStatus;
      type?: PosIncidentType;
      severity?: PosIncidentSeverity;
      operationalDate?: OperationalDate;
      registerId?: string;
      limit?: number;
      cursor?: string;
    },
  ): Promise<PosPageResult<PosIncident>> {
    const settings = await posSettingsService.get();
    const limit = Math.min(
      filters.limit ?? settings.defaultPageSize,
      settings.maxPageSize,
    );

    const equals: Array<{ field: string; value: unknown }> = [];
    if (filters.status) equals.push({ field: "status", value: filters.status });
    if (filters.type) equals.push({ field: "type", value: filters.type });
    if (filters.severity) {
      equals.push({ field: "severity", value: filters.severity });
    }
    if (filters.operationalDate) {
      equals.push({ field: "operationalDate", value: filters.operationalDate });
    }
    if (filters.registerId) {
      equals.push({ field: "registerId", value: filters.registerId });
    }
    if (!actor.capabilities.includes(PosCapability.INCIDENT_RESOLVE)) {
      equals.push({ field: "createdBy", value: actor.uid });
    }

    return posIncidentRepository.list({
      limit,
      cursor: filters.cursor,
      orderByField: "createdAt",
      direction: "desc",
      equals,
    });
  }

  async assign(
    actor: PosActor,
    incidentId: string,
    assignedTo: string,
    note: string | undefined,
    context: PosRequestContext | null,
  ): Promise<PosIncident> {
    posAuthorizationService.requireCapability(
      actor,
      PosCapability.INCIDENT_RESOLVE,
    );
    return this.applyTransition({
      actor,
      incidentId,
      action: "assign",
      context,
      note: note ?? null,
      eventType: PosAuditEventType.INCIDENT_ASSIGNED,
      patch: { assignedTo },
    });
  }

  async resolve(
    actor: PosActor,
    incidentId: string,
    resolution: string,
    context: PosRequestContext | null,
  ): Promise<PosIncident> {
    posAuthorizationService.requireCapability(
      actor,
      PosCapability.INCIDENT_RESOLVE,
    );
    return this.applyTransition({
      actor,
      incidentId,
      action: "resolve",
      context,
      note: resolution,
      eventType: PosAuditEventType.INCIDENT_RESOLVED,
      patch: {
        resolution: resolution.slice(0, POS_TEXT_LIMITS.REASON_MAX),
        resolvedBy: actor.uid,
        resolvedAt: nowTimestamp(),
      },
    });
  }

  async dismiss(
    actor: PosActor,
    incidentId: string,
    reason: string,
    context: PosRequestContext | null,
  ): Promise<PosIncident> {
    posAuthorizationService.requireCapability(
      actor,
      PosCapability.INCIDENT_RESOLVE,
    );
    return this.applyTransition({
      actor,
      incidentId,
      action: "dismiss",
      context,
      note: reason,
      eventType: PosAuditEventType.INCIDENT_DISMISSED,
      patch: {
        resolution: reason.slice(0, POS_TEXT_LIMITS.REASON_MAX),
        resolvedBy: actor.uid,
        resolvedAt: nowTimestamp(),
      },
    });
  }

  async escalate(
    actor: PosActor,
    incidentId: string,
    reason: string,
    context: PosRequestContext | null,
  ): Promise<PosIncident> {
    posAuthorizationService.requireCapability(
      actor,
      PosCapability.INCIDENT_CREATE,
    );
    return this.applyTransition({
      actor,
      incidentId,
      action: "escalate",
      context,
      note: reason,
      eventType: PosAuditEventType.INCIDENT_ESCALATED,
      patch: {},
    });
  }

  private async applyTransition(input: {
    actor: PosActor;
    incidentId: string;
    action: string;
    note: string | null;
    context: PosRequestContext | null;
    eventType: PosAuditEventType;
    patch: Record<string, unknown>;
  }): Promise<PosIncident> {
    const current = await posIncidentRepository.requireById(input.incidentId);
    const target = assertTransition(
      "incident",
      input.action,
      current.status,
    ) as PosIncidentStatus;

    const updated = await posIncidentRepository.update(
      input.incidentId,
      {
        ...input.patch,
        status: target,
        history: [
          ...current.history,
          historyEntry(
            input.actor.uid,
            input.action,
            input.note,
            current.status,
            target,
          ),
        ],
      },
      current.version,
    );

    await posAuditService.record({
      eventType: input.eventType,
      entity: PosAuditEntity.INCIDENT,
      entityId: input.incidentId,
      actor: input.actor,
      context: input.context,
      operationalDate: current.operationalDate,
      registerId: current.registerId,
      sessionId: current.sessionId,
      shiftId: current.shiftId,
      before: { status: current.status },
      after: { status: target },
      reason: input.note,
    });

    return updated;
  }
}

export const posIncidentService = new PosIncidentService();
export default posIncidentService;
