/**
 * Esquemas Zod del POS.
 *
 * Todos los comandos usan `.strict()`: un campo desconocido es un error, no un dato
 * ignorado. Así se cierra la puerta a mass assignment y a que el cliente intente enviar
 * precios, totales, estados, roles o fechas que solo el backend puede decidir.
 *
 * Los importes se validan como enteros en centavos. No se aceptan flotantes, `NaN`,
 * `Infinity` ni negativos salvo donde el dominio lo exija explícitamente.
 */

import { z } from "zod";
import { POS_TEXT_LIMITS } from "../constants/pos.constants";
import { OPERATIONAL_DATE_PATTERN } from "../domain/operational-date";
import {
  PosCashMovementStatus,
  PosCashMovementType,
  PosCutClassification,
  PosCutScope,
  PosCutStatus,
  PosDailyCloseStatus,
  PosExportType,
  PosIncidentSeverity,
  PosIncidentStatus,
  PosIncidentType,
  PosRegisterStatus,
  PosReturnPhysicalCondition,
  PosReturnStatus,
  PosRole,
  PosSaleStatus,
  PosSessionStatus,
  PosShiftStatus,
} from "../models/pos.enums";
import { MUTABLE_SETTINGS_FIELDS } from "../services/pos-settings.service";

// --------------------------------------------------------------- primitivas

/** Identificadores de documento y de línea. Evita path traversal y enumeración por patrón. */
const identifier = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/, "Identificador inválido.");

const uid = identifier;

/** Importe en centavos. Entero, finito y no negativo. */
const amountMinor = z
  .number()
  .int("El importe debe ser un entero en centavos.")
  .finite()
  .min(0)
  .max(1_000_000_000);

const positiveAmountMinor = amountMinor.refine(
  (value) => value > 0,
  "El importe debe ser mayor a cero.",
);

const quantity = z.number().int().min(1).max(9_999);

const reason = z
  .string()
  .trim()
  .min(
    POS_TEXT_LIMITS.REASON_MIN,
    `El motivo debe tener al menos ${POS_TEXT_LIMITS.REASON_MIN} caracteres.`,
  )
  .max(POS_TEXT_LIMITS.REASON_MAX);

const optionalNote = z.string().trim().min(1).max(POS_TEXT_LIMITS.REASON_MAX);

const description = z
  .string()
  .trim()
  .min(1)
  .max(POS_TEXT_LIMITS.DESCRIPTION_MAX);

const reference = z
  .string()
  .trim()
  .min(1)
  .max(POS_TEXT_LIMITS.REFERENCE_MAX)
  .regex(/^[A-Za-z0-9 ._:/-]+$/, "La referencia contiene caracteres no permitidos.");

const operationalDate = z
  .string()
  .trim()
  .regex(OPERATIONAL_DATE_PATTERN, "Usa el formato YYYY-MM-DD.");

const httpsUrl = z
  .string()
  .trim()
  .max(2_048)
  .url()
  .refine((value) => value.startsWith("https://"), "La URL debe ser https.");

const cursor = z.string().trim().min(1).max(512);

const limit = z.coerce.number().int().min(1).max(100);

const booleanFlag = z
  .union([z.literal("true"), z.literal("false"), z.boolean()])
  .transform((value) => value === true || value === "true");

/** Ordena las claves de un enum de TypeScript como tupla para `z.enum`. */
function enumValues<T extends Record<string, string>>(
  target: T,
): [T[keyof T], ...T[keyof T][]] {
  const values = Object.values(target) as T[keyof T][];
  return values as [T[keyof T], ...T[keyof T][]];
}

// ------------------------------------------------------------------- params

export const registerIdParamSchema = z
  .object({ registerId: identifier })
  .strict();

export const sessionIdParamSchema = z.object({ sessionId: identifier }).strict();

export const shiftIdParamSchema = z.object({ shiftId: identifier }).strict();

export const saleIdParamSchema = z.object({ saleId: identifier }).strict();

export const saleItemParamsSchema = z
  .object({ saleId: identifier, itemId: identifier })
  .strict();

export const salePaymentParamsSchema = z
  .object({ saleId: identifier, paymentId: identifier })
  .strict();

export const movementIdParamSchema = z
  .object({ movementId: identifier })
  .strict();

export const countIdParamSchema = z.object({ countId: identifier }).strict();

export const cutIdParamSchema = z.object({ cutId: identifier }).strict();

export const returnIdParamSchema = z.object({ returnId: identifier }).strict();

export const incidentIdParamSchema = z
  .object({ incidentId: identifier })
  .strict();

export const exportIdParamSchema = z.object({ exportId: identifier }).strict();

export const dailyCloseIdParamSchema = z
  .object({ dailyCloseId: identifier })
  .strict();

export const operationalDateParamSchema = z
  .object({ operationalDate })
  .strict();

export const ticketTokenParamSchema = z
  .object({ token: z.string().trim().regex(/^[a-f0-9]{32}$/, "Token inválido.") })
  .strict();

// -------------------------------------------------------------------- query

const paginationQuery = {
  limit: limit.optional(),
  cursor: cursor.optional(),
};

export const registersQuerySchema = z
  .object({
    status: z.enum(enumValues(PosRegisterStatus)).optional(),
    includeArchived: booleanFlag.optional(),
    ...paginationQuery,
  })
  .strict();

export const sessionsQuerySchema = z
  .object({
    registerId: identifier.optional(),
    status: z.enum(enumValues(PosSessionStatus)).optional(),
    operationalDate: operationalDate.optional(),
    ...paginationQuery,
  })
  .strict();

export const shiftsQuerySchema = z
  .object({
    registerId: identifier.optional(),
    sessionId: identifier.optional(),
    cashierUid: uid.optional(),
    status: z.enum(enumValues(PosShiftStatus)).optional(),
    operationalDate: operationalDate.optional(),
    ...paginationQuery,
  })
  .strict();

export const salesQuerySchema = z
  .object({
    status: z.enum(enumValues(PosSaleStatus)).optional(),
    registerId: identifier.optional(),
    sessionId: identifier.optional(),
    shiftId: identifier.optional(),
    cashierUid: uid.optional(),
    operationalDate: operationalDate.optional(),
    folio: z.string().trim().min(1).max(40).optional(),
    ...paginationQuery,
  })
  .strict();

export const cashMovementsQuerySchema = z
  .object({
    registerId: identifier.optional(),
    sessionId: identifier.optional(),
    shiftId: identifier.optional(),
    type: z.enum(enumValues(PosCashMovementType)).optional(),
    status: z.enum(enumValues(PosCashMovementStatus)).optional(),
    operationalDate: operationalDate.optional(),
    ...paginationQuery,
  })
  .strict();

export const cutsQuerySchema = z
  .object({
    registerId: identifier.optional(),
    sessionId: identifier.optional(),
    shiftId: identifier.optional(),
    cashierUid: uid.optional(),
    status: z.enum(enumValues(PosCutStatus)).optional(),
    classification: z.enum(enumValues(PosCutClassification)).optional(),
    scope: z.enum(enumValues(PosCutScope)).optional(),
    operationalDate: operationalDate.optional(),
    ...paginationQuery,
  })
  .strict();

export const returnsQuerySchema = z
  .object({
    saleId: identifier.optional(),
    registerId: identifier.optional(),
    shiftId: identifier.optional(),
    status: z.enum(enumValues(PosReturnStatus)).optional(),
    operationalDate: operationalDate.optional(),
    ...paginationQuery,
  })
  .strict();

export const incidentsQuerySchema = z
  .object({
    status: z.enum(enumValues(PosIncidentStatus)).optional(),
    type: z.enum(enumValues(PosIncidentType)).optional(),
    severity: z.enum(enumValues(PosIncidentSeverity)).optional(),
    registerId: identifier.optional(),
    operationalDate: operationalDate.optional(),
    ...paginationQuery,
  })
  .strict();

export const dailyClosesQuerySchema = z
  .object({
    status: z.enum(enumValues(PosDailyCloseStatus)).optional(),
    from: operationalDate.optional(),
    to: operationalDate.optional(),
    ...paginationQuery,
  })
  .strict();

const reportQueryBase = {
  from: operationalDate.optional(),
  to: operationalDate.optional(),
  registerId: identifier.optional(),
  cashierUid: uid.optional(),
};

export const reportQuerySchema = z.object({ ...reportQueryBase }).strict();

export const cashMovementReportQuerySchema = z
  .object({
    ...reportQueryBase,
    type: z.enum(enumValues(PosCashMovementType)).optional(),
    status: z.enum(enumValues(PosCashMovementStatus)).optional(),
  })
  .strict();

export const differenceReportQuerySchema = z
  .object({
    ...reportQueryBase,
    classification: z.enum(enumValues(PosCutClassification)).optional(),
  })
  .strict();

export const auditEventsQuerySchema = z
  .object({
    entity: z.string().trim().min(1).max(40).optional(),
    entityId: identifier.optional(),
    actorUid: uid.optional(),
    eventType: z.string().trim().min(1).max(60).optional(),
    operationalDate: operationalDate.optional(),
    ...paginationQuery,
  })
  .strict();

export const exportsQuerySchema = z
  .object({
    type: z.enum(enumValues(PosExportType)).optional(),
    ...paginationQuery,
  })
  .strict();

export const cashCountsQuerySchema = z.object({}).strict();

// --------------------------------------------------------------------- body

export const reasonBodySchema = z.object({ reason }).strict();

export const optionalNoteBodySchema = z
  .object({ note: optionalNote.optional() })
  .strict();

export const createRegisterSchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(2)
      .max(POS_TEXT_LIMITS.CODE_MAX)
      .regex(/^[A-Z0-9-]+$/i, "El código solo admite letras, números y guiones."),
    name: z.string().trim().min(3).max(POS_TEXT_LIMITS.NAME_MAX),
    deviceId: identifier.nullable().optional(),
    printerId: identifier.nullable().optional(),
    terminalId: identifier.nullable().optional(),
    allowCash: z.boolean().optional(),
    allowCardExternal: z.boolean().optional(),
  })
  .strict();

export const updateRegisterSchema = z
  .object({
    name: z.string().trim().min(3).max(POS_TEXT_LIMITS.NAME_MAX).optional(),
    deviceId: identifier.nullable().optional(),
    printerId: identifier.nullable().optional(),
    terminalId: identifier.nullable().optional(),
    allowCash: z.boolean().optional(),
    allowCardExternal: z.boolean().optional(),
  })
  .strict()
  .refine(
    (value) => Object.keys(value).length > 0,
    "Envía al menos un campo a actualizar.",
  );

export const openRegisterSchema = z
  .object({
    openingFloatMinor: amountMinor,
    cashierUid: uid.optional(),
    note: optionalNote.optional(),
  })
  .strict();

export const startShiftSchema = z
  .object({
    receivedFloatMinor: amountMinor,
    cashierUid: uid.optional(),
  })
  .strict();

export const requestHandoffSchema = z
  .object({
    handoffToUid: uid,
    handedOverMinor: amountMinor,
    note: optionalNote.optional(),
  })
  .strict();

export const completeHandoffSchema = z
  .object({
    confirmedMinor: amountMinor,
    note: optionalNote.optional(),
  })
  .strict();

export const createSaleSchema = z
  .object({
    customerName: z.string().trim().min(1).max(POS_TEXT_LIMITS.NAME_MAX).optional(),
    note: optionalNote.optional(),
  })
  .strict();

export const addSaleItemSchema = z
  .object({
    productoId: identifier,
    tallaId: identifier.nullable().optional(),
    quantity,
  })
  .strict();

export const updateSaleItemSchema = z.object({ quantity }).strict();

export const applyCodeSchema = z
  .object({
    codigo: z
      .string()
      .trim()
      .min(2)
      .max(40)
      .regex(/^[A-Za-z0-9_-]+$/, "El código solo admite letras, números, `-` y `_`."),
  })
  .strict();

export const manualDiscountSchema = z
  .object({
    amountMinor: positiveAmountMinor.optional(),
    percent: z.number().finite().min(0.01).max(100).optional(),
    reason,
    authorizedBy: uid.optional(),
  })
  .strict()
  .refine(
    (value) =>
      (value.amountMinor === undefined) !== (value.percent === undefined),
    "Envía exactamente uno de `amountMinor` o `percent`.",
  );

export const cashPaymentSchema = z
  .object({
    amountMinor: positiveAmountMinor.optional(),
    receivedMinor: positiveAmountMinor,
  })
  .strict();

/**
 * Tarjeta con terminal externa. El POS nunca recibe PAN, CVV, vencimiento ni pista: solo
 * los datos no sensibles de una operación ya aprobada en la terminal física.
 */
export const cardPaymentSchema = z
  .object({
    amountMinor: positiveAmountMinor,
    terminalId: identifier.optional(),
    reference: reference.optional(),
    authorizationCode: z
      .string()
      .trim()
      .min(1)
      .max(32)
      .regex(/^[A-Za-z0-9-]+$/)
      .nullable()
      .optional(),
    cardBrand: z.string().trim().min(1).max(24).nullable().optional(),
    last4: z
      .string()
      .trim()
      .regex(/^\d{4}$/, "last4 debe tener exactamente 4 dígitos.")
      .nullable()
      .optional(),
    approvedAtClientReported: z.string().trim().datetime().nullable().optional(),
    attemptPaymentId: identifier.optional(),
  })
  .strict()
  .refine(
    (value) => !value.reference || Boolean(value.terminalId),
    "Al registrar una referencia también debes indicar la terminal.",
  );

export const mixedPaymentSchema = z
  .object({
    cash: z
      .object({
        amountMinor: positiveAmountMinor,
        receivedMinor: positiveAmountMinor,
      })
      .strict(),
    card: cardPaymentSchema,
  })
  .strict();

export const createCashMovementSchema = z
  .object({
    type: z.enum(enumValues(PosCashMovementType)),
    amountMinor: positiveAmountMinor,
    reason,
    description: description.optional(),
    direction: z.enum(["IN", "OUT"]).optional(),
    targetRegisterId: identifier.optional(),
    receivedBy: uid.optional(),
    reference: reference.optional(),
    evidenceUrl: httpsUrl.optional(),
    shiftId: identifier.optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.type !== PosCashMovementType.TRANSFER_OUT ||
      Boolean(value.targetRegisterId),
    "Una transferencia requiere `targetRegisterId`.",
  )
  .refine(
    (value) =>
      value.type !== PosCashMovementType.AUTHORIZED_ADJUSTMENT ||
      Boolean(value.direction),
    "Un ajuste autorizado requiere `direction`.",
  );

export const confirmReceiptSchema = z
  .object({
    confirmedMinor: amountMinor.optional(),
    note: optionalNote.optional(),
  })
  .strict();

export const submitCashCountSchema = z
  .object({
    denominations: z
      .array(
        z
          .object({
            denominationMinor: positiveAmountMinor,
            pieces: z.number().int().min(0).max(100_000),
          })
          .strict(),
      )
      .max(30)
      .optional(),
    countedCashMinor: amountMinor.optional(),
    note: optionalNote.optional(),
    witnessUid: uid.optional(),
  })
  .strict()
  .refine(
    (value) =>
      (value.denominations?.length ?? 0) > 0 ||
      typeof value.countedCashMinor === "number",
    "Envía el efectivo contado o un desglose por denominaciones.",
  )
  .refine(
    (value) =>
      !value.denominations ||
      new Set(value.denominations.map((entry) => entry.denominationMinor)).size ===
        value.denominations.length,
    "No repitas denominaciones en el conteo.",
  );

export const cutApproveSchema = z
  .object({ observations: optionalNote.optional() })
  .strict();

export const createReturnSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            itemId: identifier,
            quantity,
            physicalCondition: z.enum(enumValues(PosReturnPhysicalCondition)),
          })
          .strict(),
      )
      .min(1)
      .max(120),
    reason,
  })
  .strict()
  .refine(
    (value) =>
      new Set(value.items.map((entry) => entry.itemId)).size ===
      value.items.length,
    "No repitas la misma línea en la devolución.",
  );

export const completeReturnSchema = z
  .object({
    cardRefundReference: reference.optional(),
    note: optionalNote.optional(),
  })
  .strict();

export const voidPaidSaleSchema = z
  .object({
    reason,
    physicalCondition: z.enum(enumValues(PosReturnPhysicalCondition)),
    cardRefundReference: reference.optional(),
  })
  .strict();

export const createIncidentSchema = z
  .object({
    type: z.enum(enumValues(PosIncidentType)),
    severity: z.enum(enumValues(PosIncidentSeverity)),
    operationalDate,
    description,
    registerId: identifier.nullable().optional(),
    sessionId: identifier.nullable().optional(),
    shiftId: identifier.nullable().optional(),
    saleId: identifier.nullable().optional(),
    cashMovementId: identifier.nullable().optional(),
    cutId: identifier.nullable().optional(),
    dailyCloseId: identifier.nullable().optional(),
    evidenceUrls: z.array(httpsUrl).max(10).optional(),
  })
  .strict();

export const assignIncidentSchema = z
  .object({ assignedTo: uid, note: optionalNote.optional() })
  .strict();

export const resolveIncidentSchema = z.object({ resolution: reason }).strict();

export const createExportSchema = z
  .object({
    type: z.enum(enumValues(PosExportType)),
    from: operationalDate.optional(),
    to: operationalDate.optional(),
    registerId: identifier.optional(),
    cashierUid: uid.optional(),
    movementType: z.enum(enumValues(PosCashMovementType)).optional(),
    movementStatus: z.enum(enumValues(PosCashMovementStatus)).optional(),
    classification: z.enum(enumValues(PosCutClassification)).optional(),
  })
  .strict();

export const reprintTicketSchema = z
  .object({ reason: optionalNote.optional() })
  .strict();

const settingsPatchShape = {
  operationalDayCutoffHour: z.number().int().min(0).max(23),
  cutToleranceMinor: amountMinor,
  supervisorDifferenceLimitMinor: amountMinor,
  adminDifferenceLimitMinor: amountMinor,
  cashierManualDiscountLimitMinor: amountMinor,
  seniorCashierManualDiscountLimitMinor: amountMinor,
  supervisorManualDiscountLimitMinor: amountMinor,
  adminManualDiscountLimitMinor: amountMinor,
  manualDiscountMaxPercent: z.number().int().min(0).max(100),
  cashMovementMaxMinor: positiveAmountMinor,
  securityDropMaxMinor: positiveAmountMinor,
  transferMaxMinor: positiveAmountMinor,
  openingFloatMaxMinor: positiveAmountMinor,
  maxSaleTotalMinor: positiveAmountMinor,
  maxLinesPerSale: z.number().int().min(1).max(500),
  maxQuantityPerLine: z.number().int().min(1).max(9_999),
  maxNoteLength: z.number().int().min(50).max(2_000),
  maxSaleModifications: z.number().int().min(10).max(5_000),
  suspendedSaleTtlMinutes: z.number().int().min(5).max(10_080),
  draftSaleTtlMinutes: z.number().int().min(5).max(10_080),
  maxSessionDurationHours: z.number().int().min(1).max(72),
  idempotencyTtlHours: z.number().int().min(1).max(720),
  exportTtlHours: z.number().int().min(1).max(720),
  maxExportRows: z.number().int().min(100).max(50_000),
  maxReportRangeDays: z.number().int().min(1).max(366),
  maxPageSize: z.number().int().min(10).max(500),
  defaultPageSize: z.number().int().min(1).max(100),
  requireSupervisorForCashMovements: z.boolean(),
  allowPaidSaleVoidSameShift: z.boolean(),
  denominationsMinor: z.array(positiveAmountMinor).min(1).max(30),
  ticketFooterLegend: z.string().trim().min(5).max(300),
  storeName: z.string().trim().min(3).max(POS_TEXT_LIMITS.NAME_MAX),
  storeAddress: z.string().trim().min(3).max(300),
  storePhone: z.string().trim().min(7).max(30),
  ticketLookupBaseUrl: httpsUrl,
} satisfies Record<(typeof MUTABLE_SETTINGS_FIELDS)[number], z.ZodTypeAny>;

export const updateSettingsSchema = z
  .object({
    expectedVersion: z.number().int().min(1),
    patch: z
      .object(
        Object.fromEntries(
          Object.entries(settingsPatchShape).map(([field, schema]) => [
            field,
            schema.optional(),
          ]),
        ) as {
          [K in keyof typeof settingsPatchShape]: z.ZodOptional<
            (typeof settingsPatchShape)[K]
          >;
        },
      )
      .strict()
      .refine(
        (value) => Object.keys(value).length > 0,
        "Envía al menos un campo a actualizar.",
      ),
  })
  .strict();

export type UpdateSettingsBody = z.infer<typeof updateSettingsSchema>;

export const operatorUidParamSchema = z
  .object({
    uid,
  })
  .strict();

export type OperatorUidParam = z.infer<typeof operatorUidParamSchema>;

export const operatorsQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(200).optional(),
  })
  .strict();

export const updateOperatorSchema = z
  .object({
    posRole: z.enum([
      PosRole.CASHIER,
      PosRole.SENIOR_CASHIER,
      PosRole.SUPERVISOR,
    ]),
    active: z.boolean(),
    defaultRegisterId: identifier.nullable().optional(),
    reason: reason,
  })
  .strict();

export type UpdateOperatorBody = z.infer<typeof updateOperatorSchema>;
