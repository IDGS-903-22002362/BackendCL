/**
 * Administración de cajas y sesiones de caja.
 *
 * La apertura crea, en una sola transacción, la sesión, el primer turno y el movimiento de
 * fondo inicial. El documento de la caja actúa como cerrojo: dos aperturas simultáneas se
 * resuelven porque la segunda encuentra `status = OPEN` y recibe `REGISTER_ALREADY_OPEN`.
 */

import { POS_STORE_ID, POS_TEXT_LIMITS } from "../constants/pos.constants";
import { computeExpectedCash } from "../domain/expected-cash";
import { assertNonNegativeMinor } from "../domain/money";
import { operationalDateOf } from "../domain/operational-date";
import { assertTransition } from "../domain/state-machines";
import PosProblemError from "../errors/pos-problem.error";
import {
  PosAuditEntity,
  PosAuditEventType,
  PosCapability,
  PosCashMovementStatus,
  PosCashMovementType,
  PosIncidentSeverity,
  PosIncidentType,
  PosRegisterStatus,
  PosSaleStatus,
  PosSessionStatus,
  PosShiftStatus,
} from "../models/pos.enums";
import type {
  OperationalDate,
  PosActor,
  PosPageResult,
  PosRegister,
  PosRegisterConfig,
  PosRegisterSession,
  PosRequestContext,
  PosShift,
} from "../models/pos.types";
import {
  isAlreadyExistsError,
  nowTimestamp,
  runPosTransaction,
} from "../repositories/pos-firestore";
import {
  posCashMovementRepository,
  posRegisterRepository,
  posSaleRepository,
  posSessionRepository,
  posShiftRepository,
} from "../repositories/pos-operational.repository";
import { posAuditService } from "./pos-audit.service";
import { posAuthorizationService } from "./pos-authorization.service";
import { appendLedgerEntryInTransaction } from "./pos-cash-ledger.service";
import { posIncidentService } from "./pos-incident.service";
import posSettingsService from "./pos-settings.service";
import {
  createShiftInTransaction,
  OCCUPYING_SHIFT_STATUSES,
  releaseShiftLockInTransaction,
} from "./pos-shift.service";

const REGISTER_CODE_PATTERN = /^[A-Z0-9][A-Z0-9-]{1,23}$/;

export interface CreateRegisterInput {
  code: string;
  name: string;
  deviceId?: string | null;
  printerId?: string | null;
  terminalId?: string | null;
  allowCash?: boolean;
  allowCardExternal?: boolean;
}

/** Allowlist explícita: nada más del body llega a Firestore. */
export interface UpdateRegisterInput {
  name?: string;
  deviceId?: string | null;
  printerId?: string | null;
  terminalId?: string | null;
  allowCash?: boolean;
  allowCardExternal?: boolean;
}

function assertReason(reason: string | undefined): string {
  const trimmed = (reason ?? "").trim();
  if (trimmed.length < POS_TEXT_LIMITS.REASON_MIN) {
    throw new PosProblemError(
      "REASON_REQUIRED",
      `El motivo debe tener al menos ${POS_TEXT_LIMITS.REASON_MIN} caracteres.`,
    );
  }
  return trimmed.slice(0, POS_TEXT_LIMITS.REASON_MAX);
}

export interface RegisterStateView {
  register: PosRegister;
  session: PosRegisterSession | null;
  shift: PosShift | null;
  /** Solo se incluye para quien puede revisar cortes: el arqueo del cajero es ciego. */
  expectedCashMinor: number | null;
}

class PosRegisterService {
  async create(
    actor: PosActor,
    input: CreateRegisterInput,
    context: PosRequestContext | null,
  ): Promise<PosRegister> {
    posAuthorizationService.requireCapability(actor, PosCapability.CONFIG_MANAGE);

    const code = input.code.trim().toUpperCase();
    if (!REGISTER_CODE_PATTERN.test(code)) {
      throw new PosProblemError(
        "POS_VALIDATION_ERROR",
        "El código de caja debe ser alfanumérico en mayúsculas, de 2 a 24 caracteres.",
      );
    }
    const name = input.name.trim();
    if (name.length < 3 || name.length > POS_TEXT_LIMITS.NAME_MAX) {
      throw new PosProblemError(
        "POS_VALIDATION_ERROR",
        `El nombre debe tener entre 3 y ${POS_TEXT_LIMITS.NAME_MAX} caracteres.`,
      );
    }

    // El ID del documento es el código: garantiza unicidad sin consulta previa.
    const config: PosRegisterConfig = {
      deviceId: input.deviceId ?? null,
      printerId: input.printerId ?? null,
      terminalId: input.terminalId ?? null,
      allowCash: input.allowCash ?? true,
      allowCardExternal: input.allowCardExternal ?? true,
    };

    let register: PosRegister;
    try {
      register = await posRegisterRepository.create(
        {
          storeId: POS_STORE_ID,
          code,
          name,
          status: PosRegisterStatus.AVAILABLE,
          config,
          activeSessionId: null,
          currentShiftId: null,
          currentCashierUid: null,
          blockedReason: null,
          archived: false,
          lastActivityAt: null,
          createdBy: actor.uid,
          updatedBy: actor.uid,
        },
        code,
      );
    } catch (error) {
      if (isAlreadyExistsError(error)) {
        throw new PosProblemError("REGISTER_CODE_TAKEN");
      }
      throw error;
    }

    await posAuditService.record({
      eventType: PosAuditEventType.REGISTER_CREATED,
      entity: PosAuditEntity.REGISTER,
      entityId: register.id,
      actor,
      context,
      registerId: register.id,
      after: { code, name, status: register.status, config },
    });

    return register;
  }

  async list(
    actor: PosActor,
    filters: {
      status?: PosRegisterStatus;
      includeArchived?: boolean;
      limit?: number;
      cursor?: string;
    },
  ): Promise<PosPageResult<PosRegister>> {
    posAuthorizationService.requireAnyCapability(actor, [
      PosCapability.REGISTER_READ_OWN,
      PosCapability.REGISTER_READ_ALL,
    ]);

    const settings = await posSettingsService.get();
    const limit = Math.min(
      filters.limit ?? settings.defaultPageSize,
      settings.maxPageSize,
    );

    return posRegisterRepository.listForStore({
      limit,
      status: filters.status,
      includeArchived: filters.includeArchived,
    });
  }

  async get(actor: PosActor, registerId: string): Promise<PosRegister> {
    posAuthorizationService.requireAnyCapability(actor, [
      PosCapability.REGISTER_READ_OWN,
      PosCapability.REGISTER_READ_ALL,
    ]);
    return posRegisterRepository.requireById(registerId);
  }

  /**
   * Estado operativo de la caja. El efectivo esperado se omite para el cajero: revelarlo
   * antes del conteo rompería el arqueo ciego.
   */
  async getState(
    actor: PosActor,
    registerId: string,
  ): Promise<RegisterStateView> {
    const register = await this.get(actor, registerId);
    const session = register.activeSessionId
      ? await posSessionRepository.getById(register.activeSessionId)
      : null;
    const shift = register.currentShiftId
      ? await posShiftRepository.getById(register.currentShiftId)
      : null;

    let expectedCashMinor: number | null = null;
    if (shift && actor.capabilities.includes(PosCapability.CUT_REVIEW)) {
      const movements = await posCashMovementRepository.listByShift(shift.id);
      expectedCashMinor = computeExpectedCash({
        openingFloatMinor: shift.receivedFloatMinor,
        movements,
      }).expectedCashMinor;
    }

    return { register, session, shift, expectedCashMinor };
  }

  async update(
    actor: PosActor,
    registerId: string,
    input: UpdateRegisterInput,
    context: PosRequestContext | null,
  ): Promise<PosRegister> {
    posAuthorizationService.requireCapability(actor, PosCapability.CONFIG_MANAGE);

    const current = await posRegisterRepository.requireById(registerId);
    if (current.archived) {
      throw new PosProblemError("REGISTER_ARCHIVED");
    }

    const patch: Record<string, unknown> = { updatedBy: actor.uid };
    if (input.name !== undefined) {
      const name = input.name.trim();
      if (name.length < 3 || name.length > POS_TEXT_LIMITS.NAME_MAX) {
        throw new PosProblemError(
          "POS_VALIDATION_ERROR",
          "Nombre de caja inválido.",
        );
      }
      patch.name = name;
    }

    const configPatch: PosRegisterConfig = { ...current.config };
    let configChanged = false;
    for (const key of [
      "deviceId",
      "printerId",
      "terminalId",
    ] as const) {
      if (input[key] !== undefined) {
        configPatch[key] = input[key] ?? null;
        configChanged = true;
      }
    }
    for (const key of ["allowCash", "allowCardExternal"] as const) {
      if (input[key] !== undefined) {
        configPatch[key] = input[key] as boolean;
        configChanged = true;
      }
    }
    if (configChanged) {
      patch.config = configPatch;
    }

    if (Object.keys(patch).length === 1) {
      throw new PosProblemError(
        "POS_VALIDATION_ERROR",
        "No se enviaron campos modificables.",
      );
    }

    const updated = await posRegisterRepository.update(
      registerId,
      patch,
      current.version,
    );

    await posAuditService.record({
      eventType: PosAuditEventType.REGISTER_UPDATED,
      entity: PosAuditEntity.REGISTER,
      entityId: registerId,
      actor,
      context,
      registerId,
      before: { name: current.name, config: current.config },
      after: { name: updated.name, config: updated.config },
    });

    return updated;
  }

  /**
   * Apertura de caja: sesión + primer turno + fondo inicial, todo atómico.
   * No abre una caja bloqueada, archivada, en mantenimiento ni ya abierta.
   */
  async open(
    actor: PosActor,
    registerId: string,
    input: { openingFloatMinor: number; cashierUid?: string; note?: string },
    context: PosRequestContext | null,
  ): Promise<{
    register: PosRegister;
    session: PosRegisterSession;
    shift: PosShift;
  }> {
    posAuthorizationService.requireCapability(actor, PosCapability.REGISTER_OPEN);

    const settings = await posSettingsService.get();
    const openingFloatMinor = assertNonNegativeMinor(
      input.openingFloatMinor,
      "openingFloatMinor",
    );
    if (openingFloatMinor > settings.openingFloatMaxMinor) {
      throw new PosProblemError(
        "SALE_LIMIT_EXCEEDED",
        "El fondo inicial excede el límite configurado.",
      );
    }

    const cashierUid = input.cashierUid ?? actor.uid;
    if (
      cashierUid !== actor.uid &&
      !actor.capabilities.includes(PosCapability.SHIFT_READ_ALL)
    ) {
      throw new PosProblemError(
        "POS_PERMISSION_DENIED",
        "No puedes abrir la caja a nombre de otro cajero.",
      );
    }

    const operationalDate: OperationalDate = operationalDateOf(
      nowTimestamp().toDate(),
      settings.operationalDayCutoffHour,
    );

    return runPosTransaction(async (transaction) => {
      const register = await posRegisterRepository.requireByIdInTransaction(
        transaction,
        registerId,
      );

      if (register.archived || register.status === PosRegisterStatus.ARCHIVED) {
        throw new PosProblemError("REGISTER_ARCHIVED");
      }
      if (register.status === PosRegisterStatus.BLOCKED) {
        throw new PosProblemError("REGISTER_BLOCKED");
      }
      if (register.status === PosRegisterStatus.OPEN || register.activeSessionId) {
        throw new PosProblemError("REGISTER_ALREADY_OPEN");
      }
      const registerTarget = assertTransition(
        "register",
        "open",
        register.status,
      ) as PosRegisterStatus;

      const session = posSessionRepository.createInTransaction(transaction, {
        storeId: POS_STORE_ID,
        registerId: register.id,
        registerCode: register.code,
        operationalDate,
        status: PosSessionStatus.OPEN,
        openingFloatMinor,
        shiftIds: [],
        currentShiftId: null,
        openedBy: actor.uid,
        closedBy: null,
        closeReason: null,
        forced: false,
        cutId: null,
        openedAt: nowTimestamp(),
        closedAt: null,
      });

      const shift = createShiftInTransaction(transaction, {
        session,
        register,
        cashierUid,
        cashierName: cashierUid === actor.uid ? actor.name : undefined,
        receivedFloatMinor: openingFloatMinor,
      });

      // Con fondo cero no hay movimiento que registrar: el ledger no admite importes en 0.
      const movement =
        openingFloatMinor > 0
          ? appendLedgerEntryInTransaction(transaction, {
              registerId: register.id,
              sessionId: session.id,
              shiftId: shift.id,
              operationalDate,
              type: PosCashMovementType.OPENING_FLOAT,
              status: PosCashMovementStatus.APPROVED,
              amountMinor: openingFloatMinor,
              reason: "Fondo inicial de apertura de caja",
              description: input.note ?? null,
              requestedBy: actor.uid,
              authorizedBy: actor.uid,
            })
          : null;

      posSessionRepository.updateInTransaction(
        transaction,
        session.id,
        { shiftIds: [shift.id], currentShiftId: shift.id },
        session.version,
      );

      posRegisterRepository.updateInTransaction(
        transaction,
        register.id,
        {
          status: registerTarget,
          activeSessionId: session.id,
          currentShiftId: shift.id,
          currentCashierUid: cashierUid,
          lastActivityAt: nowTimestamp(),
          updatedBy: actor.uid,
        },
        register.version,
      );

      posAuditService.recordInTransaction(transaction, {
        eventType: PosAuditEventType.REGISTER_OPENED,
        entity: PosAuditEntity.REGISTER,
        entityId: register.id,
        actor,
        context,
        operationalDate,
        registerId: register.id,
        sessionId: session.id,
        shiftId: shift.id,
        before: { status: register.status },
        after: {
          status: registerTarget,
          openingFloatMinor,
          cashierUid,
          openingMovementId: movement?.id ?? null,
        },
      });

      // El primer turno de la sesión nace aquí; sin este evento la línea de tiempo del
      // cajero quedaría sin inicio y el turno sería imposible de auditar por sí mismo.
      posAuditService.recordInTransaction(transaction, {
        eventType: PosAuditEventType.SHIFT_STARTED,
        entity: PosAuditEntity.SHIFT,
        entityId: shift.id,
        actor,
        context,
        operationalDate,
        registerId: register.id,
        sessionId: session.id,
        shiftId: shift.id,
        after: {
          cashierUid,
          receivedFloatMinor: openingFloatMinor,
          status: shift.status,
        },
      });

      return {
        register: {
          ...register,
          status: registerTarget,
          activeSessionId: session.id,
          currentShiftId: shift.id,
          currentCashierUid: cashierUid,
          version: register.version + 1,
        },
        session: { ...session, shiftIds: [shift.id], currentShiftId: shift.id },
        shift,
      };
    });
  }

  async block(
    actor: PosActor,
    registerId: string,
    reason: string,
    context: PosRequestContext | null,
  ): Promise<PosRegister> {
    posAuthorizationService.requireCapability(actor, PosCapability.REGISTER_BLOCK);
    const validReason = assertReason(reason);

    return runPosTransaction(async (transaction) => {
      const register = await posRegisterRepository.requireByIdInTransaction(
        transaction,
        registerId,
      );
      const target = assertTransition(
        "register",
        "block",
        register.status,
      ) as PosRegisterStatus;

      // Bloquear una caja abierta impide nuevas ventas pero no descarta el turno vivo:
      // el cierre debe hacerse de forma explícita para no perder el arqueo.
      if (register.currentShiftId) {
        throw new PosProblemError(
          "REGISTER_HAS_PENDING_WORK",
          "Cierra o fuerza el cierre del turno activo antes de bloquear la caja.",
        );
      }

      posRegisterRepository.updateInTransaction(
        transaction,
        registerId,
        {
          status: target,
          blockedReason: validReason,
          updatedBy: actor.uid,
        },
        register.version,
      );

      posAuditService.recordInTransaction(transaction, {
        eventType: PosAuditEventType.REGISTER_BLOCKED,
        entity: PosAuditEntity.REGISTER,
        entityId: registerId,
        actor,
        context,
        registerId,
        before: { status: register.status },
        after: { status: target },
        reason: validReason,
      });

      return {
        ...register,
        status: target,
        blockedReason: validReason,
        version: register.version + 1,
      };
    });
  }

  async unblock(
    actor: PosActor,
    registerId: string,
    reason: string,
    context: PosRequestContext | null,
  ): Promise<PosRegister> {
    posAuthorizationService.requireCapability(actor, PosCapability.REGISTER_BLOCK);
    const validReason = assertReason(reason);

    return runPosTransaction(async (transaction) => {
      const register = await posRegisterRepository.requireByIdInTransaction(
        transaction,
        registerId,
      );
      const target = assertTransition(
        "register",
        "unblock",
        register.status,
      ) as PosRegisterStatus;

      posRegisterRepository.updateInTransaction(
        transaction,
        registerId,
        { status: target, blockedReason: null, updatedBy: actor.uid },
        register.version,
      );

      posAuditService.recordInTransaction(transaction, {
        eventType: PosAuditEventType.REGISTER_UNBLOCKED,
        entity: PosAuditEntity.REGISTER,
        entityId: registerId,
        actor,
        context,
        registerId,
        before: { status: register.status },
        after: { status: target },
        reason: validReason,
      });

      return {
        ...register,
        status: target,
        blockedReason: null,
        version: register.version + 1,
      };
    });
  }

  async archive(
    actor: PosActor,
    registerId: string,
    reason: string,
    context: PosRequestContext | null,
  ): Promise<PosRegister> {
    posAuthorizationService.requireCapability(actor, PosCapability.CONFIG_MANAGE);
    const validReason = assertReason(reason);

    return runPosTransaction(async (transaction) => {
      const register = await posRegisterRepository.requireByIdInTransaction(
        transaction,
        registerId,
      );
      if (register.status === PosRegisterStatus.OPEN || register.activeSessionId) {
        throw new PosProblemError(
          "REGISTER_HAS_PENDING_WORK",
          "No se puede archivar una caja abierta.",
        );
      }
      const target = assertTransition(
        "register",
        "archive",
        register.status,
      ) as PosRegisterStatus;

      posRegisterRepository.updateInTransaction(
        transaction,
        registerId,
        { status: target, archived: true, updatedBy: actor.uid },
        register.version,
      );

      posAuditService.recordInTransaction(transaction, {
        eventType: PosAuditEventType.REGISTER_ARCHIVED,
        entity: PosAuditEntity.REGISTER,
        entityId: registerId,
        actor,
        context,
        registerId,
        before: { status: register.status, archived: register.archived },
        after: { status: target, archived: true },
        reason: validReason,
      });

      return {
        ...register,
        status: target,
        archived: true,
        version: register.version + 1,
      };
    });
  }

  /**
   * Cierre ordinario de la caja. Exige que no queden ventas en proceso, turnos vivos ni
   * movimientos sin resolver: de lo contrario el corte de caja sería incompleto.
   */
  async close(
    actor: PosActor,
    registerId: string,
    context: PosRequestContext | null,
  ): Promise<{ register: PosRegister; session: PosRegisterSession }> {
    posAuthorizationService.requireCapability(actor, PosCapability.REGISTER_CLOSE);

    return runPosTransaction(async (transaction) => {
      const register = await posRegisterRepository.requireByIdInTransaction(
        transaction,
        registerId,
      );
      if (!register.activeSessionId) {
        throw new PosProblemError("REGISTER_NOT_OPEN");
      }

      const session = await posSessionRepository.requireByIdInTransaction(
        transaction,
        register.activeSessionId,
      );
      const blockers = await this.readSessionBlockers(transaction, session);
      if (blockers.length > 0) {
        throw new PosProblemError(
          "REGISTER_HAS_PENDING_WORK",
          "La caja tiene trabajo sin resolver.",
          blockers,
        );
      }

      const sessionTarget = assertTransition(
        "session",
        "close",
        session.status,
      ) as PosSessionStatus;
      const registerTarget = assertTransition(
        "register",
        "close",
        register.status,
      ) as PosRegisterStatus;

      posSessionRepository.updateInTransaction(
        transaction,
        session.id,
        {
          status: sessionTarget,
          closedBy: actor.uid,
          closedAt: nowTimestamp(),
          currentShiftId: null,
        },
        session.version,
      );
      posRegisterRepository.updateInTransaction(
        transaction,
        register.id,
        {
          status: registerTarget,
          activeSessionId: null,
          currentShiftId: null,
          currentCashierUid: null,
          updatedBy: actor.uid,
          lastActivityAt: nowTimestamp(),
        },
        register.version,
      );

      posAuditService.recordInTransaction(transaction, {
        eventType: PosAuditEventType.REGISTER_CLOSED,
        entity: PosAuditEntity.REGISTER,
        entityId: register.id,
        actor,
        context,
        operationalDate: session.operationalDate,
        registerId: register.id,
        sessionId: session.id,
        before: { status: register.status, sessionStatus: session.status },
        after: { status: registerTarget, sessionStatus: sessionTarget },
      });

      return {
        register: {
          ...register,
          status: registerTarget,
          activeSessionId: null,
          currentShiftId: null,
          currentCashierUid: null,
          version: register.version + 1,
        },
        session: {
          ...session,
          status: sessionTarget,
          closedBy: actor.uid,
          version: session.version + 1,
        },
      };
    });
  }

  /**
   * Cierre forzado: ignora los bloqueos, exige motivo, cierra los turnos vivos y genera una
   * incidencia con la lista de bloqueos ignorados.
   */
  async forceClose(
    actor: PosActor,
    registerId: string,
    reason: string,
    context: PosRequestContext | null,
  ): Promise<{ register: PosRegister; session: PosRegisterSession }> {
    posAuthorizationService.requireCapability(
      actor,
      PosCapability.REGISTER_FORCE_CLOSE,
    );
    const validReason = assertReason(reason);

    const result = await runPosTransaction(async (transaction) => {
      const register = await posRegisterRepository.requireByIdInTransaction(
        transaction,
        registerId,
      );
      if (!register.activeSessionId) {
        throw new PosProblemError("REGISTER_NOT_OPEN");
      }
      const session = await posSessionRepository.requireByIdInTransaction(
        transaction,
        register.activeSessionId,
      );
      const blockers = await this.readSessionBlockers(transaction, session);
      const shifts = await this.readLiveShifts(transaction, session.id);

      const sessionTarget = assertTransition(
        "session",
        "force-close",
        session.status,
      ) as PosSessionStatus;
      const registerTarget = assertTransition(
        "register",
        "force-close",
        register.status,
      ) as PosRegisterStatus;

      for (const shift of shifts) {
        posShiftRepository.updateInTransaction(
          transaction,
          shift.id,
          {
            status: PosShiftStatus.FORCED_CLOSED,
            forced: true,
            closeReason: validReason,
            endedAt: nowTimestamp(),
            supervisorUid: actor.uid,
          },
          shift.version,
        );
        releaseShiftLockInTransaction(transaction, shift.cashierUid);
      }

      posSessionRepository.updateInTransaction(
        transaction,
        session.id,
        {
          status: sessionTarget,
          forced: true,
          closedBy: actor.uid,
          closeReason: validReason,
          closedAt: nowTimestamp(),
          currentShiftId: null,
        },
        session.version,
      );
      posRegisterRepository.updateInTransaction(
        transaction,
        register.id,
        {
          status: registerTarget,
          activeSessionId: null,
          currentShiftId: null,
          currentCashierUid: null,
          updatedBy: actor.uid,
          lastActivityAt: nowTimestamp(),
        },
        register.version,
      );

      posAuditService.recordInTransaction(transaction, {
        eventType: PosAuditEventType.REGISTER_FORCE_CLOSED,
        entity: PosAuditEntity.REGISTER,
        entityId: register.id,
        actor,
        context,
        operationalDate: session.operationalDate,
        registerId: register.id,
        sessionId: session.id,
        before: { status: register.status, sessionStatus: session.status },
        after: { status: registerTarget, sessionStatus: sessionTarget },
        reason: validReason,
        metadata: { ignoredBlockers: blockers },
      });

      return {
        register: {
          ...register,
          status: registerTarget,
          activeSessionId: null,
          currentShiftId: null,
          currentCashierUid: null,
          version: register.version + 1,
        },
        session: {
          ...session,
          status: sessionTarget,
          forced: true,
          version: session.version + 1,
        },
        blockers,
      };
    });

    await posIncidentService.createSystem(
      actor.uid,
      {
        type: PosIncidentType.FORCED_CLOSE,
        severity: PosIncidentSeverity.HIGH,
        operationalDate: result.session.operationalDate,
        description:
          `Cierre forzado de la caja ${result.register.code}. Motivo: ${validReason}. ` +
          `Bloqueos ignorados: ${
            result.blockers.length > 0
              ? result.blockers.map((blocker) => blocker.code).join(", ")
              : "ninguno"
          }`,
        registerId: result.register.id,
        sessionId: result.session.id,
      },
      actor,
      context,
    );

    return { register: result.register, session: result.session };
  }

  async listSessions(
    actor: PosActor,
    filters: {
      registerId?: string;
      status?: PosSessionStatus;
      operationalDate?: OperationalDate;
      limit?: number;
      cursor?: string;
    },
  ): Promise<PosPageResult<PosRegisterSession>> {
    posAuthorizationService.requireAnyCapability(actor, [
      PosCapability.REGISTER_READ_OWN,
      PosCapability.REGISTER_READ_ALL,
    ]);

    const settings = await posSettingsService.get();
    const limit = Math.min(
      filters.limit ?? settings.defaultPageSize,
      settings.maxPageSize,
    );

    const equals: Array<{ field: string; value: unknown }> = [];
    if (filters.registerId) {
      equals.push({ field: "registerId", value: filters.registerId });
    }
    if (filters.status) equals.push({ field: "status", value: filters.status });
    if (filters.operationalDate) {
      equals.push({ field: "operationalDate", value: filters.operationalDate });
    }

    return posSessionRepository.list({
      limit,
      cursor: filters.cursor,
      orderByField: "openedAt",
      direction: "desc",
      equals,
    });
  }

  async getSession(
    actor: PosActor,
    sessionId: string,
  ): Promise<{ session: PosRegisterSession; shifts: PosShift[] }> {
    posAuthorizationService.requireAnyCapability(actor, [
      PosCapability.REGISTER_READ_OWN,
      PosCapability.REGISTER_READ_ALL,
    ]);
    const session = await posSessionRepository.requireById(sessionId);
    const allShifts = await posShiftRepository.listBySession(sessionId);

    // Un cajero sin lectura global solo ve sus propios turnos dentro de la sesión.
    const shifts = actor.capabilities.includes(PosCapability.SHIFT_READ_ALL)
      ? allShifts
      : allShifts.filter((shift) => shift.cashierUid === actor.uid);

    return { session, shifts };
  }

  /** Turnos que siguen ocupando la caja, leídos dentro de la transacción. */
  private async readLiveShifts(
    transaction: FirebaseFirestore.Transaction,
    sessionId: string,
  ): Promise<PosShift[]> {
    const snapshot = await transaction.get(
      posShiftRepository
        .collectionRef()
        .where("storeId", "==", POS_STORE_ID)
        .where("sessionId", "==", sessionId)
        .where("status", "in", OCCUPYING_SHIFT_STATUSES)
        .limit(20),
    );
    return snapshot.docs.map(
      (doc) => ({ id: doc.id, ...(doc.data() as Record<string, unknown>) }) as PosShift,
    );
  }

  /**
   * Bloqueos que impiden cerrar una sesión. Se leen dentro de la transacción para que el
   * cierre no compita con una venta o un movimiento creado en paralelo.
   */
  private async readSessionBlockers(
    transaction: FirebaseFirestore.Transaction,
    session: PosRegisterSession,
  ): Promise<Array<{ code: string; message: string; entityId: string }>> {
    const blockers: Array<{ code: string; message: string; entityId: string }> = [];

    const pendingSales = await transaction.get(
      posSaleRepository
        .collectionRef()
        .where("storeId", "==", POS_STORE_ID)
        .where("sessionId", "==", session.id)
        .where("status", "in", [
          PosSaleStatus.DRAFT,
          PosSaleStatus.SUSPENDED,
          PosSaleStatus.PAYMENT_PENDING,
        ])
        .limit(20),
    );
    for (const doc of pendingSales.docs) {
      blockers.push({
        code: "PENDING_SALE",
        message: "Existe una venta en proceso o suspendida.",
        entityId: doc.id,
      });
    }

    const pendingMovements = await transaction.get(
      posCashMovementRepository
        .collectionRef()
        .where("storeId", "==", POS_STORE_ID)
        .where("sessionId", "==", session.id)
        .where("status", "in", [
          PosCashMovementStatus.PENDING_AUTHORIZATION,
          PosCashMovementStatus.IN_TRANSIT,
        ])
        .limit(20),
    );
    for (const doc of pendingMovements.docs) {
      blockers.push({
        code: "PENDING_CASH_MOVEMENT",
        message: "Existe un movimiento de efectivo sin resolver.",
        entityId: doc.id,
      });
    }

    const liveShifts = await this.readLiveShifts(transaction, session.id);
    for (const shift of liveShifts) {
      blockers.push({
        code: "UNRESOLVED_SHIFT",
        message: "Existe un turno sin cerrar o sin corte aprobado.",
        entityId: shift.id,
      });
    }

    return blockers;
  }
}

export const posRegisterService = new PosRegisterService();
export default posRegisterService;
