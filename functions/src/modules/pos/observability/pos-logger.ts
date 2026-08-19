/**
 * Logging y métricas del POS.
 *
 * Solo campos allowlisted: nunca payloads completos, tokens, cookies ni datos de tarjeta.
 * Las métricas se emiten como eventos estructurados con el campo `metric`, de modo que
 * puedan convertirse en log-based metrics sin crear infraestructura productiva.
 */

import logger from "../../../utils/logger";

export const posLogger = logger.child({ component: "pos" });

/** Campos permitidos en el contexto de log del POS. */
export interface PosLogContext {
  requestId?: string;
  correlationId?: string;
  userId?: string;
  posRole?: string;
  registerId?: string;
  sessionId?: string;
  shiftId?: string;
  saleId?: string;
  paymentId?: string;
  cutId?: string;
  returnId?: string;
  movementId?: string;
  exportId?: string;
  operationalDate?: string;
  event?: string;
  result?: "success" | "failure" | "denied";
  durationMs?: number;
  errorCode?: string;
  method?: string;
  route?: string;
  statusCode?: number;
  /** Solo importes agregados en centavos; nunca datos de cliente. */
  amountMinor?: number;
  count?: number;
}

export const POS_METRICS = {
  REQUEST: "pos_requests_total",
  SALE_PAID: "pos_sales_paid_total",
  SALE_FAILED: "pos_sales_failed_total",
  INSUFFICIENT_STOCK: "pos_insufficient_stock_total",
  PAYMENT_DUPLICATE_PREVENTED: "pos_payment_duplicate_prevented_total",
  IDEMPOTENCY_REPLAY: "pos_idempotency_replay_total",
  IDEMPOTENCY_CONFLICT: "pos_idempotency_conflict_total",
  TRANSACTION_CONTENTION: "pos_transaction_contention_total",
  TERMINAL_ERROR: "pos_terminal_error_total",
  CUT_DIFFERENCE: "pos_cut_difference_total",
  FORCED_CLOSE: "pos_forced_close_total",
  PERMISSION_DENIED: "pos_permission_denied_total",
  SERVER_ERROR: "pos_server_errors_total",
} as const;

export type PosMetric = (typeof POS_METRICS)[keyof typeof POS_METRICS];

export function posMetric(metric: PosMetric, context: PosLogContext = {}): void {
  posLogger.info(metric, { metric, ...context });
}

export function posWarnMetric(
  metric: PosMetric,
  context: PosLogContext = {},
): void {
  posLogger.warn(metric, { metric, ...context });
}

export function posErrorMetric(
  metric: PosMetric,
  context: PosLogContext = {},
): void {
  posLogger.error(metric, { metric, ...context });
}
