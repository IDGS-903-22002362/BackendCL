/**
 * Clasificación de la diferencia de un corte y nivel de aprobación requerido.
 *
 * Una diferencia nunca se clasifica como fraude: el sistema solo describe magnitud y
 * exige el nivel de autorización correspondiente.
 */

import {
  PosCapability,
  PosCutClassification,
  PosCutStatus,
  PosRole,
} from "../models/pos.enums";

/** Estados en los que el resultado del arqueo ya puede revelarse al cajero. */
export const RESOLVED_CUT_STATUSES: readonly PosCutStatus[] = [
  PosCutStatus.APPROVED,
  PosCutStatus.REJECTED,
  PosCutStatus.ESCALATED,
  PosCutStatus.CLOSED,
];

/**
 * Visibilidad de totales del corte.
 *
 * - Quien tiene `cut.read_all` o `cut.review` siempre ve totales.
 * - El cajero dueño ve totales durante `COUNTING` (conciliación abierta) y cuando el
 *   corte ya quedó resuelto (`APPROVED`/`CLOSED`/…).
 * - El cierre es autónomo: ya no se requiere aprobación de un tercero para revelar.
 */
export function canRevealCutResult(
  actor: { uid: string; capabilities: readonly PosCapability[] },
  cut: { cashierUid: string | null; status: PosCutStatus } | null,
): boolean {
  if (
    actor.capabilities.includes(PosCapability.CUT_REVIEW) ||
    actor.capabilities.includes(PosCapability.CUT_READ_ALL)
  ) {
    return true;
  }
  if (!cut || cut.cashierUid !== actor.uid) {
    return false;
  }
  return (
    cut.status === PosCutStatus.COUNTING ||
    RESOLVED_CUT_STATUSES.includes(cut.status)
  );
}

export interface CutClassificationThresholds {
  /** Diferencia absoluta que se considera aceptable sin observación. */
  cutToleranceMinor: number;
  /** Diferencia máxima que un supervisor puede aprobar. */
  supervisorDifferenceLimitMinor: number;
  /** Diferencia máxima que un administrador puede aprobar. */
  adminDifferenceLimitMinor: number;
}

export interface CutClassificationResult {
  classification: PosCutClassification;
  /** Rol mínimo que puede aprobar el corte con esta diferencia. */
  requiredApproverRole: PosRole;
  /** El corte exige una observación escrita del cajero o del revisor. */
  requiresObservation: boolean;
  /** El corte genera automáticamente una incidencia de diferencia de efectivo. */
  requiresIncident: boolean;
}

export function classifyCutDifference(
  differenceMinor: number,
  thresholds: CutClassificationThresholds,
): CutClassificationResult {
  const magnitude = Math.abs(differenceMinor);

  if (differenceMinor === 0) {
    return {
      classification: PosCutClassification.BALANCED,
      requiredApproverRole: PosRole.SUPERVISOR,
      requiresObservation: false,
      requiresIncident: false,
    };
  }

  if (magnitude <= thresholds.cutToleranceMinor) {
    return {
      classification: PosCutClassification.WITHIN_TOLERANCE,
      requiredApproverRole: PosRole.SUPERVISOR,
      requiresObservation: false,
      requiresIncident: false,
    };
  }

  if (magnitude > thresholds.adminDifferenceLimitMinor) {
    return {
      classification: PosCutClassification.CRITICAL_DIFFERENCE,
      requiredApproverRole: PosRole.SUPER_ADMIN,
      requiresObservation: true,
      requiresIncident: true,
    };
  }

  const requiredApproverRole =
    magnitude > thresholds.supervisorDifferenceLimitMinor
      ? PosRole.ADMIN
      : PosRole.SUPERVISOR;

  return {
    classification:
      differenceMinor < 0
        ? PosCutClassification.SHORTAGE
        : PosCutClassification.OVERAGE,
    requiredApproverRole,
    requiresObservation: true,
    requiresIncident: requiredApproverRole === PosRole.ADMIN,
  };
}

/** Severidad de incidencia sugerida para una diferencia de efectivo. */
export function differenceSeverityRank(
  differenceMinor: number,
  thresholds: CutClassificationThresholds,
): "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" {
  const magnitude = Math.abs(differenceMinor);
  if (magnitude <= thresholds.cutToleranceMinor) return "LOW";
  if (magnitude <= thresholds.supervisorDifferenceLimitMinor) return "MEDIUM";
  if (magnitude <= thresholds.adminDifferenceLimitMinor) return "HIGH";
  return "CRITICAL";
}
