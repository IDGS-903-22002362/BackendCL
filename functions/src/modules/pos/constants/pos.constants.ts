/**
 * Constantes del módulo POS.
 *
 * Todas las colecciones viven en `firestoreTienda` (database `tiendacl`) porque el POS
 * necesita transacciones atómicas con `productos` y `movimientosInventario` (DEC-01).
 */

/** Establecimiento único. No se implementa CRUD de sucursales (single store model). */
export const POS_STORE_ID = "MAIN_STORE";

export const POS_TIMEZONE = "America/Mexico_City";

export const POS_CURRENCY = "MXN";

export const POS_COLLECTIONS = {
  SETTINGS: "posSettings",
  OPERATORS: "posOperators",
  REGISTERS: "posRegisters",
  REGISTER_SESSIONS: "posRegisterSessions",
  SHIFTS: "posShifts",
  SHIFT_LOCKS: "posShiftLocks",
  SALES: "posSales",
  PAYMENTS: "posPayments",
  CASH_MOVEMENTS: "posCashMovements",
  CASH_COUNTS: "posCashCounts",
  CUTS: "posCuts",
  CUT_VERSIONS: "posCutVersions",
  RETURNS: "posReturns",
  DAILY_CLOSURES: "posDailyClosures",
  INCIDENTS: "posIncidents",
  AUDIT_EVENTS: "posAuditEvents",
  IDEMPOTENCY: "posIdempotency",
  SEQUENCES: "posSequences",
  EXPORTS: "posExports",
  LOCKS: "posLocks",
} as const;

/** Colecciones compartidas con el ecommerce. El POS es consumidor, no dueño. */
export const SHARED_COLLECTIONS = {
  PRODUCTS: "productos",
  SIZES: "tallas",
  INVENTORY_MOVEMENTS: "movimientosInventario",
} as const;

export const POS_PROBLEM_BASE_URI = "https://clubleon.mx/developers/problems/pos";

export const POS_API_BASE_PATH = "/api/pos/v1";

/**
 * Denominaciones por defecto en centavos, de mayor a menor.
 *
 * Se listan por valor, no por forma física: el $20 billete y el $20 moneda comparten la
 * denominación `2000` y se cuentan juntos. Configurable vía `posSettings`.
 */
export const POS_DEFAULT_DENOMINATIONS_MINOR: readonly number[] = [
  100_000, // $1,000
  50_000, // $500
  20_000, // $200
  10_000, // $100
  5_000, // $50
  2_000, // $20
  1_000, // $10
  500, // $5
  200, // $2
  100, // $1
  50, // $0.50
];

/** Límites y umbrales por defecto. Persistidos en `posSettings` y editables por admin. */
export const POS_DEFAULT_SETTINGS = {
  operationalDayCutoffHour: 0,
  cutToleranceMinor: 1_000,
  supervisorDifferenceLimitMinor: 20_000,
  adminDifferenceLimitMinor: 100_000,
  cashierManualDiscountLimitMinor: 0,
  seniorCashierManualDiscountLimitMinor: 5_000,
  supervisorManualDiscountLimitMinor: 50_000,
  adminManualDiscountLimitMinor: 500_000,
  manualDiscountMaxPercent: 50,
  cashMovementMaxMinor: 5_000_000,
  securityDropMaxMinor: 5_000_000,
  transferMaxMinor: 5_000_000,
  openingFloatMaxMinor: 2_000_000,
  maxSaleTotalMinor: 20_000_000,
  maxLinesPerSale: 120,
  maxQuantityPerLine: 99,
  maxNoteLength: 500,
  maxSaleModifications: 400,
  suspendedSaleTtlMinutes: 720,
  draftSaleTtlMinutes: 240,
  maxSessionDurationHours: 24,
  idempotencyTtlHours: 24,
  exportTtlHours: 24,
  maxExportRows: 2_000,
  maxReportRangeDays: 90,
  maxPageSize: 100,
  defaultPageSize: 25,
  requireSupervisorForCashMovements: true,
  allowPaidSaleVoidSameShift: true,
  denominationsMinor: POS_DEFAULT_DENOMINATIONS_MINOR,
} as const;

export type PosSettingsDefaults = typeof POS_DEFAULT_SETTINGS;

/** Ventanas de rate limit del router POS. */
export const POS_RATE_LIMITS = {
  GENERAL: { windowMs: 60_000, maxRequests: 600 },
  WRITE: { windowMs: 60_000, maxRequests: 240 },
  PAYMENT: { windowMs: 60_000, maxRequests: 120 },
  EXPORT: { windowMs: 300_000, maxRequests: 10 },
} as const;

/** Longitud máxima de textos libres aceptados en comandos. */
export const POS_TEXT_LIMITS = {
  REASON_MIN: 5,
  REASON_MAX: 500,
  DESCRIPTION_MAX: 1_000,
  REFERENCE_MAX: 60,
  NAME_MAX: 120,
  CODE_MAX: 24,
} as const;

/** Cache de configuración en memoria del proceso. Corta a propósito. */
export const POS_SETTINGS_CACHE_TTL_MS = 30_000;
