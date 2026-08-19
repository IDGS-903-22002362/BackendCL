/**
 * Configuración operativa del POS.
 *
 * Vive en Firestore (`posSettings/MAIN_STORE`) porque son parámetros que un administrador
 * debe poder ajustar con auditoría (DEC-13). Las variables de entorno solo controlan
 * infraestructura (App Check, rate limit), nunca reglas de negocio.
 */

import {
  POS_CURRENCY,
  POS_DEFAULT_SETTINGS,
  POS_SETTINGS_CACHE_TTL_MS,
  POS_STORE_ID,
  POS_TIMEZONE,
} from "../constants/pos.constants";
import PosProblemError from "../errors/pos-problem.error";
import type { PosSettings } from "../models/pos.types";
import { posSettingsRepository } from "../repositories/pos-support.repository";

const DEFAULT_TICKET_LEGEND =
  "Este comprobante no es un comprobante fiscal digital.";

const DEFAULT_STORE_NAME = "Club León · Tienda";

export function buildDefaultSettings(updatedBy: string): PosSettings {
  return {
    storeId: POS_STORE_ID,
    timezone: POS_TIMEZONE,
    currency: POS_CURRENCY,
    ...POS_DEFAULT_SETTINGS,
    denominationsMinor: [...POS_DEFAULT_SETTINGS.denominationsMinor],
    ticketFooterLegend: DEFAULT_TICKET_LEGEND,
    storeName: DEFAULT_STORE_NAME,
    version: 1,
    updatedBy,
  };
}

/** Campos que un administrador puede modificar. Allowlist explícita anti mass assignment. */
export const MUTABLE_SETTINGS_FIELDS = [
  "operationalDayCutoffHour",
  "cutToleranceMinor",
  "supervisorDifferenceLimitMinor",
  "adminDifferenceLimitMinor",
  "cashierManualDiscountLimitMinor",
  "seniorCashierManualDiscountLimitMinor",
  "supervisorManualDiscountLimitMinor",
  "adminManualDiscountLimitMinor",
  "manualDiscountMaxPercent",
  "cashMovementMaxMinor",
  "securityDropMaxMinor",
  "transferMaxMinor",
  "openingFloatMaxMinor",
  "maxSaleTotalMinor",
  "maxLinesPerSale",
  "maxQuantityPerLine",
  "maxNoteLength",
  "maxSaleModifications",
  "suspendedSaleTtlMinutes",
  "draftSaleTtlMinutes",
  "maxSessionDurationHours",
  "idempotencyTtlHours",
  "exportTtlHours",
  "maxExportRows",
  "maxReportRangeDays",
  "maxPageSize",
  "defaultPageSize",
  "requireSupervisorForCashMovements",
  "allowPaidSaleVoidSameShift",
  "denominationsMinor",
  "ticketFooterLegend",
  "storeName",
  "storeAddress",
  "storePhone",
  "ticketLookupBaseUrl",
] as const;

export type MutableSettingsField = (typeof MUTABLE_SETTINGS_FIELDS)[number];

class PosSettingsService {
  private cache: { value: PosSettings; expiresAt: number } | null = null;

  /**
   * Configuración vigente. Si no existe se crea con los valores por defecto: el POS debe
   * poder arrancar en un entorno nuevo sin intervención manual, y la migración documenta
   * los valores aplicados.
   */
  async get(): Promise<PosSettings> {
    if (this.cache && this.cache.expiresAt > Date.now()) {
      return this.cache.value;
    }

    let settings = await posSettingsRepository.get();
    if (!settings) {
      settings = await posSettingsRepository.create(
        buildDefaultSettings("system:bootstrap"),
      );
    }

    // Los defaults nuevos se aplican a configuraciones antiguas sin sobrescribir lo ajustado.
    const merged: PosSettings = {
      ...buildDefaultSettings(settings.updatedBy ?? "system:bootstrap"),
      ...settings,
    };

    this.cache = {
      value: merged,
      expiresAt: Date.now() + POS_SETTINGS_CACHE_TTL_MS,
    };
    return merged;
  }

  async update(
    patch: Partial<Record<MutableSettingsField, unknown>>,
    expectedVersion: number,
    updatedBy: string,
  ): Promise<PosSettings> {
    const allowed: Record<string, unknown> = {};
    for (const field of MUTABLE_SETTINGS_FIELDS) {
      if (patch[field] !== undefined) {
        allowed[field] = patch[field];
      }
    }

    if (Object.keys(allowed).length === 0) {
      throw new PosProblemError(
        "POS_VALIDATION_ERROR",
        "No se enviaron campos de configuración modificables.",
      );
    }

    const current = await this.get();
    this.assertConsistency({ ...current, ...allowed } as PosSettings);

    try {
      const updated = await posSettingsRepository.update(
        allowed as Partial<PosSettings>,
        expectedVersion,
        updatedBy,
      );
      this.cache = null;
      return { ...buildDefaultSettings(updatedBy), ...updated };
    } catch (error) {
      if ((error as { code?: string }).code === "pos/version-conflict") {
        throw new PosProblemError("CONCURRENT_MODIFICATION");
      }
      throw error;
    }
  }

  /** Invalida la caché del proceso. Se usa en pruebas y tras la migración. */
  invalidateCache(): void {
    this.cache = null;
  }

  private assertConsistency(settings: PosSettings): void {
    if (settings.cutToleranceMinor > settings.supervisorDifferenceLimitMinor) {
      throw new PosProblemError(
        "SETTINGS_INVALID",
        "La tolerancia no puede ser mayor que el límite del supervisor.",
      );
    }
    if (
      settings.supervisorDifferenceLimitMinor > settings.adminDifferenceLimitMinor
    ) {
      throw new PosProblemError(
        "SETTINGS_INVALID",
        "El límite del supervisor no puede ser mayor que el del administrador.",
      );
    }
    if (
      settings.cashierManualDiscountLimitMinor >
        settings.seniorCashierManualDiscountLimitMinor ||
      settings.seniorCashierManualDiscountLimitMinor >
        settings.supervisorManualDiscountLimitMinor ||
      settings.supervisorManualDiscountLimitMinor >
        settings.adminManualDiscountLimitMinor
    ) {
      throw new PosProblemError(
        "SETTINGS_INVALID",
        "Los límites de descuento manual deben ser crecientes por nivel de rol.",
      );
    }
    if (settings.defaultPageSize > settings.maxPageSize) {
      throw new PosProblemError(
        "SETTINGS_INVALID",
        "defaultPageSize no puede exceder maxPageSize.",
      );
    }
    if (
      !Array.isArray(settings.denominationsMinor) ||
      settings.denominationsMinor.length === 0 ||
      settings.denominationsMinor.some(
        (value) => !Number.isInteger(value) || value <= 0,
      ) ||
      new Set(settings.denominationsMinor).size !== settings.denominationsMinor.length
    ) {
      throw new PosProblemError(
        "SETTINGS_INVALID",
        "Las denominaciones deben ser enteros positivos únicos en centavos.",
      );
    }
    if (
      !Number.isInteger(settings.operationalDayCutoffHour) ||
      settings.operationalDayCutoffHour < 0 ||
      settings.operationalDayCutoffHour > 23
    ) {
      throw new PosProblemError(
        "SETTINGS_INVALID",
        "operationalDayCutoffHour debe estar entre 0 y 23.",
      );
    }
  }
}

export const posSettingsService = new PosSettingsService();
export default posSettingsService;
