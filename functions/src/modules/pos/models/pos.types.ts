/**
 * Entidades y DTOs del módulo POS.
 *
 * Convención monetaria: todo importe es un entero en centavos MXN y su nombre termina en
 * `Minor`. No existen importes en pesos dentro de estas estructuras.
 */

import { Timestamp } from "firebase-admin/firestore";
import { RolUsuario } from "../../../models/usuario.model";
import {
  PosAuditEntity,
  PosAuditEventType,
  PosAuditResult,
  PosCapability,
  PosCashCountStatus,
  PosCashMovementStatus,
  PosCashMovementType,
  PosCutClassification,
  PosCutScope,
  PosCutStatus,
  PosDailyCloseStatus,
  PosExportStatus,
  PosExportType,
  PosIdempotencyStatus,
  PosIncidentSeverity,
  PosIncidentStatus,
  PosIncidentType,
  PosPaymentMethod,
  PosPaymentStatus,
  PosRegisterStatus,
  PosReturnPhysicalCondition,
  PosReturnStatus,
  PosRole,
  PosSaleStatus,
  PosSessionStatus,
  PosShiftStatus,
} from "./pos.enums";

/** Fecha operativa en formato `YYYY-MM-DD` calculada en America/Mexico_City. */
export type OperationalDate = string;

export interface PosActor {
  uid: string;
  email?: string;
  name?: string;
  baseRole: RolUsuario;
  posRole: PosRole;
  capabilities: readonly PosCapability[];
}

/** Contexto de la petición usado para auditoría y logging. No se persiste en claro. */
export interface PosRequestContext {
  requestId: string;
  deviceId?: string;
  ipHash?: string;
  userAgent?: string;
  appCheckVerified: boolean;
}

export interface PosOperator {
  uid: string;
  posRole: PosRole;
  active: boolean;
  defaultRegisterId?: string | null;
  updatedBy: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface PosSettings {
  storeId: string;
  timezone: string;
  currency: string;
  operationalDayCutoffHour: number;
  cutToleranceMinor: number;
  supervisorDifferenceLimitMinor: number;
  adminDifferenceLimitMinor: number;
  cashierManualDiscountLimitMinor: number;
  seniorCashierManualDiscountLimitMinor: number;
  supervisorManualDiscountLimitMinor: number;
  adminManualDiscountLimitMinor: number;
  manualDiscountMaxPercent: number;
  cashMovementMaxMinor: number;
  securityDropMaxMinor: number;
  transferMaxMinor: number;
  openingFloatMaxMinor: number;
  maxSaleTotalMinor: number;
  maxLinesPerSale: number;
  maxQuantityPerLine: number;
  maxNoteLength: number;
  maxSaleModifications: number;
  suspendedSaleTtlMinutes: number;
  draftSaleTtlMinutes: number;
  maxSessionDurationHours: number;
  idempotencyTtlHours: number;
  exportTtlHours: number;
  maxExportRows: number;
  maxReportRangeDays: number;
  maxPageSize: number;
  defaultPageSize: number;
  requireSupervisorForCashMovements: boolean;
  allowPaidSaleVoidSameShift: boolean;
  denominationsMinor: number[];
  ticketFooterLegend: string;
  storeName: string;
  storeAddress?: string;
  storePhone?: string;
  ticketLookupBaseUrl?: string;
  version: number;
  updatedBy?: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface PosRegisterConfig {
  deviceId?: string | null;
  printerId?: string | null;
  terminalId?: string | null;
  allowCash: boolean;
  allowCardExternal: boolean;
}

export interface PosRegister {
  id: string;
  storeId: string;
  code: string;
  name: string;
  status: PosRegisterStatus;
  config: PosRegisterConfig;
  activeSessionId: string | null;
  currentShiftId: string | null;
  currentCashierUid: string | null;
  blockedReason?: string | null;
  archived: boolean;
  lastActivityAt: Timestamp | null;
  version: number;
  createdBy: string;
  updatedBy: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface PosRegisterSession {
  id: string;
  storeId: string;
  registerId: string;
  registerCode: string;
  operationalDate: OperationalDate;
  status: PosSessionStatus;
  openingFloatMinor: number;
  shiftIds: string[];
  currentShiftId: string | null;
  openedBy: string;
  closedBy?: string | null;
  closeReason?: string | null;
  forced: boolean;
  cutId?: string | null;
  openedAt: Timestamp;
  closedAt?: Timestamp | null;
  version: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** Proyección acumulada del turno. Reconstruible desde el ledger y las ventas. */
export interface PosShiftTotals {
  salesCount: number;
  grossSalesMinor: number;
  discountMinor: number;
  netSalesMinor: number;
  cashSalesMinor: number;
  cardSalesMinor: number;
  cashRefundsMinor: number;
  cardRefundsMinor: number;
  voidedSalesMinor: number;
  cashInMinor: number;
  cashOutMinor: number;
  securityDropsMinor: number;
  transfersInMinor: number;
  transfersOutMinor: number;
  adjustmentsMinor: number;
}

export interface PosShift {
  id: string;
  storeId: string;
  sessionId: string;
  registerId: string;
  registerCode: string;
  operationalDate: OperationalDate;
  cashierUid: string;
  cashierName?: string;
  status: PosShiftStatus;
  receivedFloatMinor: number;
  handedOverMinor: number | null;
  handoffToUid?: string | null;
  handoffRequestedAt?: Timestamp | null;
  totals: PosShiftTotals;
  cutId?: string | null;
  supervisorUid?: string | null;
  forced: boolean;
  closeReason?: string | null;
  startedAt: Timestamp;
  endedAt?: Timestamp | null;
  version: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** Snapshot histórico de una línea de venta. No depende del catálogo actual. */
export interface PosSaleItem {
  itemId: string;
  productoId: string;
  clave: string;
  descripcion: string;
  barcode?: string | null;
  tallaId: string | null;
  tallaCodigo?: string | null;
  quantity: number;
  unitPriceOriginalMinor: number;
  unitPriceMinor: number;
  offerDiscountMinor: number;
  codeDiscountMinor: number;
  manualDiscountMinor: number;
  taxMinor: number;
  lineTotalMinor: number;
  offerId?: string | null;
  offerTitle?: string | null;
  returnedQuantity: number;
  refundedMinor: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface PosSaleTotals {
  subtotalOriginalMinor: number;
  offerDiscountMinor: number;
  codeDiscountMinor: number;
  manualDiscountMinor: number;
  discountMinor: number;
  subtotalMinor: number;
  taxMinor: number;
  totalMinor: number;
}

export interface PosSaleManualDiscount {
  amountMinor: number;
  percent: number | null;
  reason: string;
  requestedBy: string;
  authorizedBy: string;
  appliedAt: Timestamp;
}

export interface PosSaleAppliedCode {
  codigoPromocionId: string;
  codigo: string;
  titulo?: string | null;
  discountMinor: number;
  appliedBy: string;
  appliedAt: Timestamp;
}

export interface PosSalePaymentSummary {
  paidMinor: number;
  pendingMinor: number;
  cashMinor: number;
  cardMinor: number;
  changeMinor: number;
  refundedMinor: number;
  methods: PosPaymentMethod[];
}

export interface PosSale {
  id: string;
  storeId: string;
  folio: string;
  registerId: string;
  registerCode: string;
  sessionId: string;
  shiftId: string;
  cashierUid: string;
  operationalDate: OperationalDate;
  status: PosSaleStatus;
  items: PosSaleItem[];
  totals: PosSaleTotals;
  appliedCode: PosSaleAppliedCode | null;
  manualDiscount: PosSaleManualDiscount | null;
  payment: PosSalePaymentSummary;
  customerName?: string | null;
  note?: string | null;
  modificationCount: number;
  reprintCount: number;
  ticketToken: string;
  cancelReason?: string | null;
  voidReason?: string | null;
  suspendedAt?: Timestamp | null;
  paidAt?: Timestamp | null;
  cancelledAt?: Timestamp | null;
  voidedAt?: Timestamp | null;
  inventoryCommitted: boolean;
  version: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** Datos de una operación aprobada en terminal física. Nunca contiene datos de tarjeta. */
export interface PosCardExternalDetails {
  terminalId: string;
  reference: string;
  authorizationCode?: string | null;
  cardBrand?: string | null;
  last4?: string | null;
  operatorUid: string;
  approvedAtClientReported?: string | null;
}

export interface PosPayment {
  id: string;
  storeId: string;
  saleId: string;
  registerId: string;
  sessionId: string;
  shiftId: string;
  operationalDate: OperationalDate;
  method: PosPaymentMethod;
  status: PosPaymentStatus;
  amountMinor: number;
  receivedMinor: number | null;
  changeMinor: number | null;
  refundedMinor: number;
  card: PosCardExternalDetails | null;
  declineReason?: string | null;
  cancelReason?: string | null;
  registeredBy: string;
  idempotencyKeyHash?: string | null;
  approvedAt?: Timestamp | null;
  version: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface PosCashMovement {
  id: string;
  storeId: string;
  registerId: string;
  sessionId: string;
  shiftId: string;
  operationalDate: OperationalDate;
  type: PosCashMovementType;
  status: PosCashMovementStatus;
  /** Siempre positivo. La dirección la determina `direction`. */
  amountMinor: number;
  direction: "IN" | "OUT";
  reason: string;
  description?: string | null;
  requestedBy: string;
  authorizedBy?: string | null;
  receivedBy?: string | null;
  saleId?: string | null;
  returnId?: string | null;
  paymentId?: string | null;
  targetRegisterId?: string | null;
  targetShiftId?: string | null;
  linkedMovementId?: string | null;
  reversalOfMovementId?: string | null;
  evidenceUrl?: string | null;
  reference?: string | null;
  idempotencyKeyHash?: string | null;
  dispatchedAt?: Timestamp | null;
  receivedAt?: Timestamp | null;
  resolvedAt?: Timestamp | null;
  /** Bloqueo optimista. El importe y el tipo nunca cambian; solo el estado y sus fechas. */
  version: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface PosCashCountDenomination {
  denominationMinor: number;
  pieces: number;
  subtotalMinor: number;
}

export interface PosCashCount {
  id: string;
  storeId: string;
  registerId: string;
  sessionId: string;
  shiftId: string;
  operationalDate: OperationalDate;
  /**
   * Número de arqueo del turno (1 = primer conteo, 2 = segundo conteo…). No es un bloqueo
   * optimista: un conteo enviado es inmutable, así que nunca se incrementa.
   */
  version: number;
  status: PosCashCountStatus;
  /** Ciego: durante el primer conteo el cajero nunca recibe esperado ni diferencia. */
  blind: boolean;
  denominations: PosCashCountDenomination[];
  countedCashMinor: number;
  countedBy: string;
  witnessUid?: string | null;
  note?: string | null;
  submittedAt?: Timestamp | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface PosPaymentMethodBreakdown {
  method: PosPaymentMethod;
  count: number;
  amountMinor: number;
  refundedMinor: number;
  netMinor: number;
}

export interface PosCutTotals {
  openingFloatMinor: number;
  salesCount: number;
  grossSalesMinor: number;
  discountMinor: number;
  netSalesMinor: number;
  cancelledCount: number;
  voidedMinor: number;
  returnsCount: number;
  refundsMinor: number;
  cashRefundsMinor: number;
  cardRefundsMinor: number;
  cashInMinor: number;
  cashOutMinor: number;
  securityDropsMinor: number;
  transfersInMinor: number;
  transfersOutMinor: number;
  adjustmentsMinor: number;
  paymentBreakdown: PosPaymentMethodBreakdown[];
  expectedCashMinor: number;
  countedCashMinor: number;
  differenceMinor: number;
}

export interface PosCut {
  id: string;
  storeId: string;
  folio: string;
  scope: PosCutScope;
  operationalDate: OperationalDate;
  registerId: string;
  registerCode: string;
  sessionId: string;
  shiftId: string | null;
  cashierUid: string | null;
  status: PosCutStatus;
  classification: PosCutClassification;
  toleranceMinor: number;
  requiredApproverRole: PosRole;
  totals: PosCutTotals;
  cashCountId: string | null;
  cashCountVersion: number;
  version: number;
  observations: string | null;
  clarificationRequest?: string | null;
  clarificationResponse?: string | null;
  rejectionReason?: string | null;
  escalationReason?: string | null;
  reopenReason?: string | null;
  incidentIds: string[];
  reviewerUid?: string | null;
  approverUid?: string | null;
  startedAt: Timestamp;
  endedAt: Timestamp | null;
  submittedAt?: Timestamp | null;
  reviewedAt?: Timestamp | null;
  approvedAt?: Timestamp | null;
  dailyCloseId?: string | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** Snapshot inmutable de una versión del corte. Nunca se sobrescribe. */
export interface PosCutVersion {
  id: string;
  storeId: string;
  cutId: string;
  version: number;
  status: PosCutStatus;
  classification: PosCutClassification;
  totals: PosCutTotals;
  cashCountId: string | null;
  cashCountVersion: number;
  reason: string | null;
  actorUid: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface PosReturnItem {
  itemId: string;
  productoId: string;
  tallaId: string | null;
  clave: string;
  descripcion: string;
  quantity: number;
  unitPriceMinor: number;
  refundMinor: number;
  physicalCondition: PosReturnPhysicalCondition;
  restockable: boolean;
}

export interface PosRefundAllocationEntry {
  paymentId: string;
  method: PosPaymentMethod;
  amountMinor: number;
  externalReference?: string | null;
  externalProcessedBy?: string | null;
  externalProcessedAt?: Timestamp | null;
}

export interface PosReturn {
  id: string;
  storeId: string;
  folio: string;
  saleId: string;
  saleFolio: string;
  registerId: string;
  sessionId: string;
  shiftId: string;
  operationalDate: OperationalDate;
  status: PosReturnStatus;
  items: PosReturnItem[];
  refundTotalMinor: number;
  refundAllocation: PosRefundAllocationEntry[];
  cashRefundMinor: number;
  cardRefundMinor: number;
  reason: string;
  requestedBy: string;
  authorizedBy?: string | null;
  rejectionReason?: string | null;
  inventoryRestocked: boolean;
  completedAt?: Timestamp | null;
  version: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface PosDailyCloseBlocker {
  code: string;
  message: string;
  entity: PosAuditEntity;
  entityId: string;
}

export interface PosDailyCloseRegisterSummary {
  registerId: string;
  registerCode: string;
  sessionIds: string[];
  shiftCount: number;
  openingFloatMinor: number;
  netSalesMinor: number;
  expectedCashMinor: number;
  countedCashMinor: number;
  differenceMinor: number;
}

export interface PosDailyCloseCashierSummary {
  cashierUid: string;
  shiftIds: string[];
  netSalesMinor: number;
  differenceMinor: number;
}

export interface PosDailyCloseTotals {
  registerCount: number;
  sessionCount: number;
  shiftCount: number;
  salesCount: number;
  grossSalesMinor: number;
  discountMinor: number;
  netSalesMinor: number;
  refundsMinor: number;
  voidedMinor: number;
  paymentBreakdown: PosPaymentMethodBreakdown[];
  cashInMinor: number;
  cashOutMinor: number;
  securityDropsMinor: number;
  transfersInMinor: number;
  transfersOutMinor: number;
  expectedCashMinor: number;
  countedCashMinor: number;
  differenceMinor: number;
  shortageMinor: number;
  overageMinor: number;
}

export interface PosDailyClose {
  id: OperationalDate;
  storeId: string;
  operationalDate: OperationalDate;
  status: PosDailyCloseStatus;
  totals: PosDailyCloseTotals;
  registers: PosDailyCloseRegisterSummary[];
  cashiers: PosDailyCloseCashierSummary[];
  cutIds: string[];
  blockers: PosDailyCloseBlocker[];
  ignoredBlockers: PosDailyCloseBlocker[];
  incidentIds: string[];
  forced: boolean;
  reason?: string | null;
  closedBy?: string | null;
  closedAt?: Timestamp | null;
  version: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface PosIncidentHistoryEntry {
  at: Timestamp;
  actorUid: string;
  action: string;
  note?: string | null;
  fromStatus?: PosIncidentStatus | null;
  toStatus?: PosIncidentStatus | null;
}

export interface PosIncident {
  id: string;
  storeId: string;
  folio: string;
  type: PosIncidentType;
  severity: PosIncidentSeverity;
  status: PosIncidentStatus;
  operationalDate: OperationalDate;
  registerId?: string | null;
  sessionId?: string | null;
  shiftId?: string | null;
  saleId?: string | null;
  cashMovementId?: string | null;
  cutId?: string | null;
  dailyCloseId?: string | null;
  description: string;
  evidenceUrls: string[];
  createdBy: string;
  assignedTo?: string | null;
  resolution?: string | null;
  resolvedBy?: string | null;
  resolvedAt?: Timestamp | null;
  history: PosIncidentHistoryEntry[];
  version: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface PosAuditEvent {
  id: string;
  storeId: string;
  eventType: PosAuditEventType;
  entity: PosAuditEntity;
  entityId: string;
  operationalDate: OperationalDate | null;
  actorUid: string;
  actorRole: PosRole | null;
  actorBaseRole: RolUsuario | null;
  actorCapabilities: string[];
  requestId: string | null;
  deviceId: string | null;
  ipHash: string | null;
  userAgent: string | null;
  registerId: string | null;
  sessionId: string | null;
  shiftId: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  reason: string | null;
  result: PosAuditResult;
  metadata: Record<string, unknown> | null;
  occurredAt: Timestamp;
}

export interface PosIdempotencyRecord {
  operation: string;
  actorUid: string;
  resourceKey: string;
  requestHash: string;
  status: PosIdempotencyStatus;
  statusCode: number | null;
  responseBody: unknown;
  errorCode?: string | null;
  expiresAt: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface PosExport {
  id: string;
  storeId: string;
  type: PosExportType;
  status: PosExportStatus;
  format: "CSV";
  filters: Record<string, unknown>;
  rowCount: number;
  byteSize: number;
  content?: string | null;
  failureReason?: string | null;
  requestedBy: string;
  expiresAt: Timestamp;
  completedAt?: Timestamp | null;
  version: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface PosPageResult<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

/** Ticket comercial no fiscal. No contiene UUID fiscal ni datos de CFDI. */
export interface PosTicket {
  saleId: string;
  folio: string;
  ticketToken: string;
  operationalDate: OperationalDate;
  issuedAt: string;
  store: {
    name: string;
    address?: string;
    phone?: string;
  };
  register: { id: string; code: string };
  cashier: { uid: string; name?: string };
  items: Array<{
    clave: string;
    descripcion: string;
    tallaCodigo?: string | null;
    quantity: number;
    unitPriceOriginalMinor: number;
    unitPriceMinor: number;
    discountMinor: number;
    lineTotalMinor: number;
  }>;
  totals: PosSaleTotals;
  payments: Array<{
    method: PosPaymentMethod;
    amountMinor: number;
    receivedMinor: number | null;
    changeMinor: number | null;
    reference?: string | null;
    authorizationCode?: string | null;
  }>;
  receivedMinor: number;
  changeMinor: number;
  currency: string;
  legend: string;
  lookupUrl?: string | null;
  reprintCount: number;
}
