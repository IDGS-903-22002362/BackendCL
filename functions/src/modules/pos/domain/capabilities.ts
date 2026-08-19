/**
 * Matriz rol POS → capacidades y reglas de separación de responsabilidades.
 *
 * La autorización nunca compara nombres de rol en los servicios: se evalúa contra
 * capacidades atómicas declaradas aquí.
 */

import { RolUsuario } from "../../../models/usuario.model";
import { PosCapability, PosRole } from "../models/pos.enums";
import type { PosActor } from "../models/pos.types";

const CASHIER_CAPABILITIES: readonly PosCapability[] = [
  PosCapability.ACCESS,
  PosCapability.SALE_CREATE,
  PosCapability.SALE_SUSPEND,
  PosCapability.SALE_RESUME,
  PosCapability.SALE_CANCEL_UNPAID,
  PosCapability.TICKET_READ,
  PosCapability.TICKET_REPRINT,
  PosCapability.REGISTER_READ_OWN,
  PosCapability.REGISTER_OPEN,
  PosCapability.SHIFT_START,
  PosCapability.SHIFT_END_OWN,
  PosCapability.SHIFT_HANDOFF,
  PosCapability.SHIFT_READ_OWN,
  PosCapability.CASH_MOVEMENT_CREATE,
  PosCapability.CASH_DROP_REQUEST,
  PosCapability.CUT_CREATE_OWN,
  PosCapability.CUT_READ_OWN,
  PosCapability.INCIDENT_CREATE,
  PosCapability.REPORT_READ_OWN,
];

const SENIOR_CASHIER_CAPABILITIES: readonly PosCapability[] = [
  ...CASHIER_CAPABILITIES,
  PosCapability.SALE_DISCOUNT_MANUAL,
  PosCapability.REGISTER_CLOSE,
  PosCapability.CASH_TRANSFER_REQUEST,
  PosCapability.CASH_TRANSFER_CONFIRM,
];

const SUPERVISOR_CAPABILITIES: readonly PosCapability[] = [
  ...SENIOR_CASHIER_CAPABILITIES,
  PosCapability.SALE_CANCEL_PAID,
  PosCapability.SALE_REFUND,
  PosCapability.REGISTER_READ_ALL,
  PosCapability.REGISTER_BLOCK,
  PosCapability.SHIFT_READ_ALL,
  PosCapability.CASH_MOVEMENT_APPROVE,
  PosCapability.CASH_DROP_APPROVE,
  PosCapability.CUT_READ_ALL,
  PosCapability.CUT_REVIEW,
  PosCapability.CUT_APPROVE,
  PosCapability.CUT_REJECT,
  PosCapability.CUT_REQUEST_SECOND_COUNT,
  PosCapability.INCIDENT_RESOLVE,
  PosCapability.DAILY_CLOSE_PREVIEW,
  PosCapability.REPORT_READ_ALL,
];

const ADMIN_CAPABILITIES: readonly PosCapability[] = [
  ...SUPERVISOR_CAPABILITIES,
  PosCapability.REGISTER_FORCE_CLOSE,
  PosCapability.CUT_REOPEN,
  PosCapability.DAILY_CLOSE_EXECUTE,
  PosCapability.AUDIT_READ,
  PosCapability.CONFIG_MANAGE,
];

const SUPER_ADMIN_CAPABILITIES: readonly PosCapability[] = [
  ...ADMIN_CAPABILITIES,
  PosCapability.DAILY_CLOSE_FORCE,
];

export const POS_CAPABILITY_MATRIX: Readonly<
  Record<PosRole, readonly PosCapability[]>
> = Object.freeze({
  [PosRole.CASHIER]: dedupe(CASHIER_CAPABILITIES),
  [PosRole.SENIOR_CASHIER]: dedupe(SENIOR_CASHIER_CAPABILITIES),
  [PosRole.SUPERVISOR]: dedupe(SUPERVISOR_CAPABILITIES),
  [PosRole.ADMIN]: dedupe(ADMIN_CAPABILITIES),
  [PosRole.SUPER_ADMIN]: dedupe(SUPER_ADMIN_CAPABILITIES),
});

function dedupe(values: readonly PosCapability[]): readonly PosCapability[] {
  return Object.freeze(Array.from(new Set(values)));
}

export function capabilitiesForRole(role: PosRole): readonly PosCapability[] {
  return POS_CAPABILITY_MATRIX[role] ?? [];
}

export function hasCapability(
  actor: Pick<PosActor, "capabilities">,
  capability: PosCapability,
): boolean {
  return actor.capabilities.includes(capability);
}

export function hasAnyCapability(
  actor: Pick<PosActor, "capabilities">,
  capabilities: readonly PosCapability[],
): boolean {
  return capabilities.some((capability) => hasCapability(actor, capability));
}

/**
 * Rol POS derivado del rol base del ecommerce.
 *
 * `EMPLEADO` es un rol amplio: por mínimo privilegio se resuelve como `CASHIER` salvo que
 * exista un documento `posOperators/{uid}` que lo eleve. El resto de roles del ecommerce
 * (cliente, empleado de club, trabajador, concesiones) no tiene acceso al POS.
 */
export function resolvePosRole(
  baseRole: RolUsuario | string | undefined,
  assignedPosRole?: PosRole | null,
): PosRole | null {
  switch (baseRole) {
    case RolUsuario.SUPER_ADMIN:
      return PosRole.SUPER_ADMIN;
    case RolUsuario.ADMIN:
      return PosRole.ADMIN;
    case RolUsuario.EMPLEADO:
      return assignedPosRole ?? PosRole.CASHIER;
    default:
      return null;
  }
}

const ROLE_RANK: Readonly<Record<PosRole, number>> = Object.freeze({
  [PosRole.CASHIER]: 1,
  [PosRole.SENIOR_CASHIER]: 2,
  [PosRole.SUPERVISOR]: 3,
  [PosRole.ADMIN]: 4,
  [PosRole.SUPER_ADMIN]: 5,
});

export function roleRank(role: PosRole): number {
  return ROLE_RANK[role] ?? 0;
}

export function roleAtLeast(role: PosRole, minimum: PosRole): boolean {
  return roleRank(role) >= roleRank(minimum);
}

/** Un actor puede ver datos de otros cajeros solo con capacidad de lectura global. */
export function canReadOtherCashiers(actor: Pick<PosActor, "capabilities">): boolean {
  return hasCapability(actor, PosCapability.SHIFT_READ_ALL);
}

/**
 * Separación de responsabilidades: nadie autoriza su propia solicitud, sin importar el rol.
 * Devuelve `true` cuando la aprobación está prohibida.
 */
export function isSelfApproval(actorUid: string, requesterUid: string): boolean {
  return actorUid === requesterUid;
}

/** Límite de descuento manual por rol, en centavos. */
export function manualDiscountLimitMinor(
  role: PosRole,
  limits: {
    cashierManualDiscountLimitMinor: number;
    seniorCashierManualDiscountLimitMinor: number;
    supervisorManualDiscountLimitMinor: number;
    adminManualDiscountLimitMinor: number;
  },
): number {
  switch (role) {
    case PosRole.CASHIER:
      return limits.cashierManualDiscountLimitMinor;
    case PosRole.SENIOR_CASHIER:
      return limits.seniorCashierManualDiscountLimitMinor;
    case PosRole.SUPERVISOR:
      return limits.supervisorManualDiscountLimitMinor;
    case PosRole.ADMIN:
    case PosRole.SUPER_ADMIN:
      return limits.adminManualDiscountLimitMinor;
    default:
      return 0;
  }
}
