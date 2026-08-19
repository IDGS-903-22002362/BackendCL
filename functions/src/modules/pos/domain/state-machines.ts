/**
 * Máquinas de estado del POS.
 *
 * Cada transición se declara con la capacidad requerida. Los servicios llaman
 * `assertTransition` antes de escribir; una transición no declarada produce
 * `INVALID_STATE_TRANSITION` (409). No existe ningún endpoint que asigne `status`
 * directamente.
 */

import PosProblemError from "../errors/pos-problem.error";
import {
  PosCapability,
  PosCashCountStatus,
  PosCashMovementStatus,
  PosCutStatus,
  PosDailyCloseStatus,
  PosIncidentStatus,
  PosPaymentStatus,
  PosRegisterStatus,
  PosReturnStatus,
  PosSaleStatus,
  PosSessionStatus,
  PosShiftStatus,
} from "../models/pos.enums";

export type PosStateMachineName =
  | "register"
  | "session"
  | "shift"
  | "sale"
  | "payment"
  | "cashMovement"
  | "cashCount"
  | "cut"
  | "dailyClose"
  | "return"
  | "incident";

export interface TransitionDefinition<TState extends string> {
  action: string;
  from: readonly TState[];
  to: TState;
  capability: PosCapability;
  /** Motivo obligatorio (cierres forzados, rechazos, reaperturas, ajustes). */
  requiresReason?: boolean;
  /** El actor no puede ser el mismo que originó el recurso. */
  forbidsSelfApproval?: boolean;
}

type MachineMap<TState extends string> = Readonly<
  Record<string, TransitionDefinition<TState>>
>;

export const REGISTER_TRANSITIONS: MachineMap<PosRegisterStatus> = Object.freeze({
  open: {
    action: "open",
    from: [PosRegisterStatus.AVAILABLE],
    to: PosRegisterStatus.OPEN,
    capability: PosCapability.REGISTER_OPEN,
  },
  close: {
    action: "close",
    from: [PosRegisterStatus.OPEN],
    to: PosRegisterStatus.AVAILABLE,
    capability: PosCapability.REGISTER_CLOSE,
  },
  "force-close": {
    action: "force-close",
    from: [PosRegisterStatus.OPEN, PosRegisterStatus.BLOCKED],
    to: PosRegisterStatus.AVAILABLE,
    capability: PosCapability.REGISTER_FORCE_CLOSE,
    requiresReason: true,
  },
  block: {
    action: "block",
    from: [
      PosRegisterStatus.AVAILABLE,
      PosRegisterStatus.OPEN,
      PosRegisterStatus.MAINTENANCE,
    ],
    to: PosRegisterStatus.BLOCKED,
    capability: PosCapability.REGISTER_BLOCK,
    requiresReason: true,
  },
  unblock: {
    action: "unblock",
    from: [PosRegisterStatus.BLOCKED],
    to: PosRegisterStatus.AVAILABLE,
    capability: PosCapability.REGISTER_BLOCK,
    requiresReason: true,
  },
  maintenance: {
    action: "maintenance",
    from: [PosRegisterStatus.AVAILABLE],
    to: PosRegisterStatus.MAINTENANCE,
    capability: PosCapability.CONFIG_MANAGE,
    requiresReason: true,
  },
  activate: {
    action: "activate",
    from: [PosRegisterStatus.MAINTENANCE],
    to: PosRegisterStatus.AVAILABLE,
    capability: PosCapability.CONFIG_MANAGE,
  },
  archive: {
    action: "archive",
    from: [PosRegisterStatus.AVAILABLE, PosRegisterStatus.MAINTENANCE],
    to: PosRegisterStatus.ARCHIVED,
    capability: PosCapability.CONFIG_MANAGE,
    requiresReason: true,
  },
});

export const SESSION_TRANSITIONS: MachineMap<PosSessionStatus> = Object.freeze({
  "request-handoff": {
    action: "request-handoff",
    from: [PosSessionStatus.OPEN],
    to: PosSessionStatus.HANDOFF_PENDING,
    capability: PosCapability.SHIFT_HANDOFF,
  },
  "complete-handoff": {
    action: "complete-handoff",
    from: [PosSessionStatus.HANDOFF_PENDING],
    to: PosSessionStatus.OPEN,
    capability: PosCapability.SHIFT_HANDOFF,
  },
  "start-count": {
    action: "start-count",
    from: [PosSessionStatus.OPEN],
    to: PosSessionStatus.COUNTING,
    capability: PosCapability.CUT_CREATE_OWN,
  },
  "submit-count": {
    action: "submit-count",
    from: [PosSessionStatus.COUNTING],
    to: PosSessionStatus.REVIEW_PENDING,
    capability: PosCapability.CUT_CREATE_OWN,
  },
  "cancel-count": {
    action: "cancel-count",
    from: [PosSessionStatus.COUNTING],
    to: PosSessionStatus.OPEN,
    capability: PosCapability.CUT_CREATE_OWN,
  },
  close: {
    action: "close",
    from: [PosSessionStatus.REVIEW_PENDING, PosSessionStatus.OPEN],
    to: PosSessionStatus.CLOSED,
    capability: PosCapability.REGISTER_CLOSE,
  },
  "force-close": {
    action: "force-close",
    from: [
      PosSessionStatus.OPEN,
      PosSessionStatus.HANDOFF_PENDING,
      PosSessionStatus.COUNTING,
      PosSessionStatus.REVIEW_PENDING,
    ],
    to: PosSessionStatus.FORCED_CLOSED,
    capability: PosCapability.REGISTER_FORCE_CLOSE,
    requiresReason: true,
  },
});

export const SHIFT_TRANSITIONS: MachineMap<PosShiftStatus> = Object.freeze({
  /**
   * La entrega solo puede pedirse cuando el turno ya envió su arqueo (DEC-14): así ningún
   * cajero abandona su turno sin conteo. Si se fue sin contar, la salida es `force-close`.
   */
  "request-handoff": {
    action: "request-handoff",
    from: [PosShiftStatus.SUBMITTED, PosShiftStatus.APPROVED],
    to: PosShiftStatus.HANDOFF_PENDING,
    capability: PosCapability.SHIFT_HANDOFF,
  },
  "complete-handoff": {
    action: "complete-handoff",
    from: [PosShiftStatus.HANDOFF_PENDING],
    to: PosShiftStatus.CLOSED,
    capability: PosCapability.SHIFT_HANDOFF,
  },
  "start-count": {
    action: "start-count",
    from: [PosShiftStatus.ACTIVE, PosShiftStatus.SECOND_COUNT_REQUIRED],
    to: PosShiftStatus.COUNTING,
    capability: PosCapability.CUT_CREATE_OWN,
  },
  "submit-count": {
    action: "submit-count",
    from: [PosShiftStatus.COUNTING],
    to: PosShiftStatus.APPROVED,
    capability: PosCapability.CUT_CREATE_OWN,
  },
  "cancel-count": {
    action: "cancel-count",
    from: [PosShiftStatus.COUNTING],
    to: PosShiftStatus.ACTIVE,
    capability: PosCapability.CUT_CREATE_OWN,
  },
  review: {
    action: "review",
    from: [PosShiftStatus.SUBMITTED],
    to: PosShiftStatus.UNDER_REVIEW,
    capability: PosCapability.CUT_REVIEW,
  },
  "request-second-count": {
    action: "request-second-count",
    from: [PosShiftStatus.SUBMITTED, PosShiftStatus.UNDER_REVIEW],
    to: PosShiftStatus.SECOND_COUNT_REQUIRED,
    capability: PosCapability.CUT_REQUEST_SECOND_COUNT,
    requiresReason: true,
    forbidsSelfApproval: true,
  },
  approve: {
    action: "approve",
    from: [
      PosShiftStatus.SUBMITTED,
      PosShiftStatus.UNDER_REVIEW,
      PosShiftStatus.ESCALATED,
    ],
    to: PosShiftStatus.APPROVED,
    capability: PosCapability.CUT_APPROVE,
    forbidsSelfApproval: true,
  },
  reject: {
    action: "reject",
    from: [
      PosShiftStatus.SUBMITTED,
      PosShiftStatus.UNDER_REVIEW,
      PosShiftStatus.ESCALATED,
    ],
    to: PosShiftStatus.REJECTED,
    capability: PosCapability.CUT_REJECT,
    requiresReason: true,
    forbidsSelfApproval: true,
  },
  escalate: {
    action: "escalate",
    from: [PosShiftStatus.SUBMITTED, PosShiftStatus.UNDER_REVIEW],
    to: PosShiftStatus.ESCALATED,
    capability: PosCapability.CUT_REVIEW,
    requiresReason: true,
  },
  end: {
    action: "end",
    from: [PosShiftStatus.APPROVED],
    to: PosShiftStatus.CLOSED,
    capability: PosCapability.SHIFT_END_OWN,
  },
  "force-close": {
    action: "force-close",
    from: [
      PosShiftStatus.ACTIVE,
      PosShiftStatus.HANDOFF_PENDING,
      PosShiftStatus.COUNTING,
      PosShiftStatus.SUBMITTED,
      PosShiftStatus.SECOND_COUNT_REQUIRED,
      PosShiftStatus.UNDER_REVIEW,
      PosShiftStatus.REJECTED,
      PosShiftStatus.ESCALATED,
    ],
    to: PosShiftStatus.FORCED_CLOSED,
    capability: PosCapability.REGISTER_FORCE_CLOSE,
    requiresReason: true,
  },
});

export const SALE_TRANSITIONS: MachineMap<PosSaleStatus> = Object.freeze({
  suspend: {
    action: "suspend",
    from: [PosSaleStatus.DRAFT],
    to: PosSaleStatus.SUSPENDED,
    capability: PosCapability.SALE_SUSPEND,
  },
  resume: {
    action: "resume",
    from: [PosSaleStatus.SUSPENDED],
    to: PosSaleStatus.DRAFT,
    capability: PosCapability.SALE_RESUME,
  },
  checkout: {
    action: "checkout",
    from: [PosSaleStatus.DRAFT],
    to: PosSaleStatus.PAYMENT_PENDING,
    capability: PosCapability.SALE_CREATE,
  },
  "return-to-draft": {
    action: "return-to-draft",
    from: [PosSaleStatus.PAYMENT_PENDING],
    to: PosSaleStatus.DRAFT,
    capability: PosCapability.SALE_CREATE,
  },
  pay: {
    action: "pay",
    from: [PosSaleStatus.PAYMENT_PENDING],
    to: PosSaleStatus.PAID,
    capability: PosCapability.SALE_CREATE,
  },
  cancel: {
    action: "cancel",
    from: [
      PosSaleStatus.DRAFT,
      PosSaleStatus.SUSPENDED,
      PosSaleStatus.PAYMENT_PENDING,
    ],
    to: PosSaleStatus.CANCELLED,
    capability: PosCapability.SALE_CANCEL_UNPAID,
    requiresReason: true,
  },
  void: {
    action: "void",
    from: [PosSaleStatus.PAID],
    to: PosSaleStatus.VOIDED,
    capability: PosCapability.SALE_CANCEL_PAID,
    requiresReason: true,
  },
  "partially-refund": {
    action: "partially-refund",
    from: [PosSaleStatus.PAID, PosSaleStatus.PARTIALLY_REFUNDED],
    to: PosSaleStatus.PARTIALLY_REFUNDED,
    capability: PosCapability.SALE_REFUND,
    requiresReason: true,
  },
  refund: {
    action: "refund",
    from: [PosSaleStatus.PAID, PosSaleStatus.PARTIALLY_REFUNDED],
    to: PosSaleStatus.REFUNDED,
    capability: PosCapability.SALE_REFUND,
    requiresReason: true,
  },
});

export const PAYMENT_TRANSITIONS: MachineMap<PosPaymentStatus> = Object.freeze({
  approve: {
    action: "approve",
    from: [PosPaymentStatus.PENDING],
    to: PosPaymentStatus.APPROVED,
    capability: PosCapability.SALE_CREATE,
  },
  decline: {
    action: "decline",
    from: [PosPaymentStatus.PENDING],
    to: PosPaymentStatus.DECLINED,
    capability: PosCapability.SALE_CREATE,
    requiresReason: true,
  },
  cancel: {
    action: "cancel",
    from: [PosPaymentStatus.PENDING, PosPaymentStatus.APPROVED],
    to: PosPaymentStatus.CANCELLED,
    capability: PosCapability.SALE_CREATE,
    requiresReason: true,
  },
  "partially-refund": {
    action: "partially-refund",
    from: [PosPaymentStatus.APPROVED, PosPaymentStatus.PARTIALLY_REFUNDED],
    to: PosPaymentStatus.PARTIALLY_REFUNDED,
    capability: PosCapability.SALE_REFUND,
  },
  refund: {
    action: "refund",
    from: [PosPaymentStatus.APPROVED, PosPaymentStatus.PARTIALLY_REFUNDED],
    to: PosPaymentStatus.REFUNDED,
    capability: PosCapability.SALE_REFUND,
  },
});

export const CASH_MOVEMENT_TRANSITIONS: MachineMap<PosCashMovementStatus> =
  Object.freeze({
    approve: {
      action: "approve",
      from: [PosCashMovementStatus.PENDING_AUTHORIZATION],
      to: PosCashMovementStatus.APPROVED,
      capability: PosCapability.CASH_MOVEMENT_APPROVE,
      forbidsSelfApproval: true,
    },
    reject: {
      action: "reject",
      from: [PosCashMovementStatus.PENDING_AUTHORIZATION],
      to: PosCashMovementStatus.REJECTED,
      capability: PosCapability.CASH_MOVEMENT_APPROVE,
      requiresReason: true,
      forbidsSelfApproval: true,
    },
    "confirm-delivery": {
      action: "confirm-delivery",
      from: [PosCashMovementStatus.APPROVED],
      to: PosCashMovementStatus.IN_TRANSIT,
      capability: PosCapability.CASH_TRANSFER_REQUEST,
    },
    "confirm-receipt": {
      action: "confirm-receipt",
      from: [PosCashMovementStatus.IN_TRANSIT],
      to: PosCashMovementStatus.RECEIVED,
      capability: PosCapability.CASH_TRANSFER_CONFIRM,
    },
    cancel: {
      action: "cancel",
      from: [
        PosCashMovementStatus.PENDING_AUTHORIZATION,
        PosCashMovementStatus.APPROVED,
      ],
      to: PosCashMovementStatus.CANCELLED,
      capability: PosCapability.CASH_MOVEMENT_CREATE,
      requiresReason: true,
    },
  });

export const CASH_COUNT_TRANSITIONS: MachineMap<PosCashCountStatus> = Object.freeze({
  submit: {
    action: "submit",
    from: [PosCashCountStatus.DRAFT],
    to: PosCashCountStatus.SUBMITTED,
    capability: PosCapability.CUT_CREATE_OWN,
  },
});

export const CUT_TRANSITIONS: MachineMap<PosCutStatus> = Object.freeze({
  "start-count": {
    action: "start-count",
    from: [PosCutStatus.DRAFT, PosCutStatus.SECOND_COUNT_REQUIRED, PosCutStatus.REOPENED],
    to: PosCutStatus.COUNTING,
    capability: PosCapability.CUT_CREATE_OWN,
  },
  submit: {
    action: "submit",
    from: [PosCutStatus.COUNTING],
    to: PosCutStatus.APPROVED,
    capability: PosCapability.CUT_CREATE_OWN,
  },
  "cancel-count": {
    action: "cancel-count",
    from: [PosCutStatus.COUNTING],
    to: PosCutStatus.DRAFT,
    capability: PosCapability.CUT_CREATE_OWN,
  },
  review: {
    action: "review",
    from: [PosCutStatus.SUBMITTED],
    to: PosCutStatus.UNDER_REVIEW,
    capability: PosCapability.CUT_REVIEW,
    forbidsSelfApproval: true,
  },
  "request-clarification": {
    action: "request-clarification",
    from: [PosCutStatus.SUBMITTED, PosCutStatus.UNDER_REVIEW],
    to: PosCutStatus.UNDER_REVIEW,
    capability: PosCapability.CUT_REVIEW,
    requiresReason: true,
    forbidsSelfApproval: true,
  },
  "request-second-count": {
    action: "request-second-count",
    from: [PosCutStatus.SUBMITTED, PosCutStatus.UNDER_REVIEW],
    to: PosCutStatus.SECOND_COUNT_REQUIRED,
    capability: PosCapability.CUT_REQUEST_SECOND_COUNT,
    requiresReason: true,
    forbidsSelfApproval: true,
  },
  approve: {
    action: "approve",
    from: [PosCutStatus.SUBMITTED, PosCutStatus.UNDER_REVIEW, PosCutStatus.ESCALATED],
    to: PosCutStatus.APPROVED,
    capability: PosCapability.CUT_APPROVE,
    forbidsSelfApproval: true,
  },
  reject: {
    action: "reject",
    from: [PosCutStatus.SUBMITTED, PosCutStatus.UNDER_REVIEW, PosCutStatus.ESCALATED],
    to: PosCutStatus.REJECTED,
    capability: PosCapability.CUT_REJECT,
    requiresReason: true,
    forbidsSelfApproval: true,
  },
  escalate: {
    action: "escalate",
    from: [PosCutStatus.SUBMITTED, PosCutStatus.UNDER_REVIEW],
    to: PosCutStatus.ESCALATED,
    capability: PosCapability.CUT_REVIEW,
    requiresReason: true,
    forbidsSelfApproval: true,
  },
  reopen: {
    action: "reopen",
    from: [PosCutStatus.APPROVED, PosCutStatus.REJECTED],
    to: PosCutStatus.REOPENED,
    capability: PosCapability.CUT_REOPEN,
    requiresReason: true,
  },
  close: {
    action: "close",
    from: [PosCutStatus.APPROVED],
    to: PosCutStatus.CLOSED,
    capability: PosCapability.DAILY_CLOSE_EXECUTE,
  },
});

export const DAILY_CLOSE_TRANSITIONS: MachineMap<PosDailyCloseStatus> = Object.freeze({
  block: {
    action: "block",
    from: [PosDailyCloseStatus.DRAFT, PosDailyCloseStatus.READY],
    to: PosDailyCloseStatus.BLOCKED,
    capability: PosCapability.DAILY_CLOSE_PREVIEW,
  },
  ready: {
    action: "ready",
    from: [PosDailyCloseStatus.DRAFT, PosDailyCloseStatus.BLOCKED],
    to: PosDailyCloseStatus.READY,
    capability: PosCapability.DAILY_CLOSE_PREVIEW,
  },
  close: {
    action: "close",
    from: [PosDailyCloseStatus.DRAFT, PosDailyCloseStatus.READY],
    to: PosDailyCloseStatus.CLOSED,
    capability: PosCapability.DAILY_CLOSE_EXECUTE,
  },
  "force-close": {
    action: "force-close",
    from: [
      PosDailyCloseStatus.DRAFT,
      PosDailyCloseStatus.BLOCKED,
      PosDailyCloseStatus.READY,
    ],
    to: PosDailyCloseStatus.FORCED_CLOSED,
    capability: PosCapability.DAILY_CLOSE_FORCE,
    requiresReason: true,
  },
});

export const RETURN_TRANSITIONS: MachineMap<PosReturnStatus> = Object.freeze({
  submit: {
    action: "submit",
    from: [PosReturnStatus.DRAFT],
    to: PosReturnStatus.PENDING_APPROVAL,
    capability: PosCapability.SALE_REFUND,
    requiresReason: true,
  },
  approve: {
    action: "approve",
    from: [PosReturnStatus.PENDING_APPROVAL],
    to: PosReturnStatus.APPROVED,
    capability: PosCapability.SALE_REFUND,
  },
  reject: {
    action: "reject",
    from: [PosReturnStatus.PENDING_APPROVAL],
    to: PosReturnStatus.REJECTED,
    capability: PosCapability.SALE_REFUND,
    requiresReason: true,
  },
  complete: {
    action: "complete",
    from: [PosReturnStatus.APPROVED],
    to: PosReturnStatus.COMPLETED,
    capability: PosCapability.SALE_REFUND,
  },
  cancel: {
    action: "cancel",
    from: [PosReturnStatus.DRAFT, PosReturnStatus.PENDING_APPROVAL],
    to: PosReturnStatus.CANCELLED,
    capability: PosCapability.SALE_REFUND,
    requiresReason: true,
  },
});

export const INCIDENT_TRANSITIONS: MachineMap<PosIncidentStatus> = Object.freeze({
  assign: {
    action: "assign",
    from: [PosIncidentStatus.OPEN, PosIncidentStatus.ESCALATED],
    to: PosIncidentStatus.UNDER_REVIEW,
    capability: PosCapability.INCIDENT_RESOLVE,
  },
  resolve: {
    action: "resolve",
    from: [
      PosIncidentStatus.OPEN,
      PosIncidentStatus.UNDER_REVIEW,
      PosIncidentStatus.ESCALATED,
    ],
    to: PosIncidentStatus.RESOLVED,
    capability: PosCapability.INCIDENT_RESOLVE,
    requiresReason: true,
  },
  dismiss: {
    action: "dismiss",
    from: [PosIncidentStatus.OPEN, PosIncidentStatus.UNDER_REVIEW],
    to: PosIncidentStatus.DISMISSED,
    capability: PosCapability.INCIDENT_RESOLVE,
    requiresReason: true,
  },
  escalate: {
    action: "escalate",
    from: [PosIncidentStatus.OPEN, PosIncidentStatus.UNDER_REVIEW],
    to: PosIncidentStatus.ESCALATED,
    capability: PosCapability.INCIDENT_CREATE,
    requiresReason: true,
  },
});

const MACHINES = {
  register: REGISTER_TRANSITIONS,
  session: SESSION_TRANSITIONS,
  shift: SHIFT_TRANSITIONS,
  sale: SALE_TRANSITIONS,
  payment: PAYMENT_TRANSITIONS,
  cashMovement: CASH_MOVEMENT_TRANSITIONS,
  cashCount: CASH_COUNT_TRANSITIONS,
  cut: CUT_TRANSITIONS,
  dailyClose: DAILY_CLOSE_TRANSITIONS,
  return: RETURN_TRANSITIONS,
  incident: INCIDENT_TRANSITIONS,
} as const;

export function getTransition(
  machine: PosStateMachineName,
  action: string,
): TransitionDefinition<string> {
  const definition = (MACHINES[machine] as MachineMap<string>)[action];
  if (!definition) {
    throw new PosProblemError(
      "INVALID_STATE_TRANSITION",
      `La acción "${action}" no está definida para ${machine}.`,
    );
  }
  return definition;
}

export function canTransition(
  machine: PosStateMachineName,
  action: string,
  currentStatus: string,
): boolean {
  const definition = (MACHINES[machine] as MachineMap<string>)[action];
  return Boolean(definition && definition.from.includes(currentStatus));
}

/**
 * Valida que la transición exista y que el estado actual la permita.
 * Devuelve el estado destino para que el llamador lo persista.
 */
export function assertTransition(
  machine: PosStateMachineName,
  action: string,
  currentStatus: string,
): string {
  const definition = getTransition(machine, action);
  if (!definition.from.includes(currentStatus)) {
    throw new PosProblemError(
      "INVALID_STATE_TRANSITION",
      `No se puede ejecutar "${action}" sobre ${machine} en estado ${currentStatus}.`,
    );
  }
  return definition.to;
}

/** Acciones disponibles desde un estado dado, útil para `GET /context`. */
export function availableActions(
  machine: PosStateMachineName,
  currentStatus: string,
): string[] {
  const definitions = MACHINES[machine] as MachineMap<string>;
  return Object.keys(definitions).filter((action) =>
    definitions[action].from.includes(currentStatus),
  );
}
