/**
 * Router del POS (`/api/pos/v1`).
 *
 * Orden de defensa por petición:
 *
 * 1. contexto de request (requestId, dispositivo, IP hasheada)
 * 2. límite de payload
 * 3. App Check (portar un JWT válido no lo omite)
 * 4. autenticación
 * 5. actor POS y capacidad `pos.access`
 * 6. rate limit por actor y dispositivo
 * 7. capacidad específica de la ruta
 * 8. validación Zod estricta de params, query y body
 * 9. idempotencia en comandos con efectos
 *
 * Las capacidades se revalidan dentro de cada servicio: el guard de ruta es defensa en
 * profundidad y respuesta temprana, nunca la única comprobación.
 */

import { Router } from "express";
import { authMiddleware } from "../../../utils/middlewares";
import { POS_RATE_LIMITS } from "../constants/pos.constants";
import { PosCapability } from "../models/pos.enums";
import {
  handlePosError,
  posActorMiddleware,
  posAppCheckMiddleware,
  posPayloadLimit,
  posRateLimiter,
  posRequestContextMiddleware,
  posRequestLogger,
  requireAnyPosCapability,
  requirePosCapability,
  requirePosIdempotencyKey,
  validatePosBody,
  validatePosParams,
  validatePosQuery,
} from "../middleware/pos.middleware";
import * as cashController from "../controllers/pos-cash.controller";
import * as contextController from "../controllers/pos-context.controller";
import * as cutController from "../controllers/pos-cut.controller";
import * as dailyCloseController from "../controllers/pos-daily-close.controller";
import * as incidentController from "../controllers/pos-incident.controller";
import * as registerController from "../controllers/pos-register.controller";
import * as reportController from "../controllers/pos-report.controller";
import * as returnController from "../controllers/pos-return.controller";
import * as saleController from "../controllers/pos-sale.controller";
import {
  addSaleItemSchema,
  applyCodeSchema,
  assignIncidentSchema,
  auditEventsQuerySchema,
  cardPaymentSchema,
  cashMovementReportQuerySchema,
  cashMovementsQuerySchema,
  cashPaymentSchema,
  completeHandoffSchema,
  completeReturnSchema,
  confirmReceiptSchema,
  countIdParamSchema,
  createCashMovementSchema,
  createExportSchema,
  createIncidentSchema,
  createRegisterSchema,
  createReturnSchema,
  createSaleSchema,
  cutApproveSchema,
  cutIdParamSchema,
  cutsQuerySchema,
  dailyCloseIdParamSchema,
  dailyClosesQuerySchema,
  differenceReportQuerySchema,
  exportIdParamSchema,
  exportsQuerySchema,
  incidentIdParamSchema,
  incidentsQuerySchema,
  manualDiscountSchema,
  mixedPaymentSchema,
  movementIdParamSchema,
  openRegisterSchema,
  operationalDateParamSchema,
  operatorUidParamSchema,
  operatorsQuerySchema,
  optionalNoteBodySchema,
  reasonBodySchema,
  registerIdParamSchema,
  registersQuerySchema,
  reportQuerySchema,
  reprintTicketSchema,
  requestHandoffSchema,
  resolveIncidentSchema,
  returnIdParamSchema,
  returnsQuerySchema,
  saleIdParamSchema,
  saleItemParamsSchema,
  salePaymentParamsSchema,
  salesQuerySchema,
  sessionIdParamSchema,
  sessionsQuerySchema,
  shiftIdParamSchema,
  shiftsQuerySchema,
  startShiftSchema,
  submitCashCountSchema,
  ticketTokenParamSchema,
  updateOperatorSchema,
  updateRegisterSchema,
  updateSaleItemSchema,
  updateSettingsSchema,
  voidPaidSaleSchema,
} from "../validators/pos.validators";

const router = Router();

const generalRateLimit = posRateLimiter({
  keyPrefix: "general",
  ...POS_RATE_LIMITS.GENERAL,
});

const writeRateLimit = posRateLimiter({
  keyPrefix: "write",
  ...POS_RATE_LIMITS.WRITE,
});

const paymentRateLimit = posRateLimiter({
  keyPrefix: "payment",
  ...POS_RATE_LIMITS.PAYMENT,
});

const exportRateLimit = posRateLimiter({
  keyPrefix: "export",
  ...POS_RATE_LIMITS.EXPORT,
});

const publicTicketRateLimit = posRateLimiter({
  keyPrefix: "ticket-lookup",
  windowMs: 60_000,
  maxRequests: 30,
});

router.use(posRequestContextMiddleware, posPayloadLimit(), posRequestLogger);

/**
 * Consulta pública del ticket por token.
 *
 * El token es un valor aleatorio de 128 bits impreso en el comprobante, así que no es
 * enumerable. Se monta antes de la autenticación porque la consulta la hace el cliente
 * final desde su navegador, y devuelve una vista sin identidad del cajero.
 */
router.get(
  "/tickets/:token",
  publicTicketRateLimit,
  validatePosParams(ticketTokenParamSchema),
  saleController.getTicketByToken,
);

router.use(
  posAppCheckMiddleware,
  authMiddleware,
  posActorMiddleware,
  requirePosCapability(PosCapability.ACCESS),
  generalRateLimit,
);

// ---------------------------------------------------------------- contexto

router.get("/context", contextController.getContext);
router.get("/capabilities", contextController.getCapabilities);

router.get(
  "/settings",
  requirePosCapability(PosCapability.CONFIG_MANAGE),
  contextController.getSettings,
);

router.patch(
  "/settings",
  writeRateLimit,
  requirePosCapability(PosCapability.CONFIG_MANAGE),
  validatePosBody(updateSettingsSchema),
  contextController.updateSettings,
);

router.get(
  "/operators",
  requirePosCapability(PosCapability.CONFIG_MANAGE),
  validatePosQuery(operatorsQuerySchema),
  contextController.listOperators,
);

router.get(
  "/operators/:uid",
  requirePosCapability(PosCapability.CONFIG_MANAGE),
  validatePosParams(operatorUidParamSchema),
  contextController.getOperator,
);

router.put(
  "/operators/:uid",
  writeRateLimit,
  requirePosCapability(PosCapability.CONFIG_MANAGE),
  validatePosParams(operatorUidParamSchema),
  validatePosBody(updateOperatorSchema),
  contextController.upsertOperator,
);

// ------------------------------------------------------------------- cajas

router.get(
  "/registers",
  requireAnyPosCapability([
    PosCapability.REGISTER_READ_OWN,
    PosCapability.REGISTER_READ_ALL,
  ]),
  validatePosQuery(registersQuerySchema),
  registerController.listRegisters,
);

router.post(
  "/registers",
  writeRateLimit,
  requirePosCapability(PosCapability.CONFIG_MANAGE),
  validatePosBody(createRegisterSchema),
  registerController.createRegister,
);

router.get(
  "/registers/:registerId",
  requireAnyPosCapability([
    PosCapability.REGISTER_READ_OWN,
    PosCapability.REGISTER_READ_ALL,
  ]),
  validatePosParams(registerIdParamSchema),
  registerController.getRegister,
);

router.patch(
  "/registers/:registerId",
  writeRateLimit,
  requirePosCapability(PosCapability.CONFIG_MANAGE),
  validatePosParams(registerIdParamSchema),
  validatePosBody(updateRegisterSchema),
  registerController.updateRegister,
);

router.post(
  "/registers/:registerId/open",
  writeRateLimit,
  requirePosIdempotencyKey,
  requirePosCapability(PosCapability.REGISTER_OPEN),
  validatePosParams(registerIdParamSchema),
  validatePosBody(openRegisterSchema),
  registerController.openRegister,
);

router.post(
  "/registers/:registerId/block",
  writeRateLimit,
  requirePosCapability(PosCapability.REGISTER_BLOCK),
  validatePosParams(registerIdParamSchema),
  validatePosBody(reasonBodySchema),
  registerController.blockRegister,
);

router.post(
  "/registers/:registerId/unblock",
  writeRateLimit,
  requirePosCapability(PosCapability.REGISTER_BLOCK),
  validatePosParams(registerIdParamSchema),
  validatePosBody(reasonBodySchema),
  registerController.unblockRegister,
);

router.post(
  "/registers/:registerId/archive",
  writeRateLimit,
  requirePosCapability(PosCapability.CONFIG_MANAGE),
  validatePosParams(registerIdParamSchema),
  validatePosBody(reasonBodySchema),
  registerController.archiveRegister,
);

router.post(
  "/registers/:registerId/close",
  writeRateLimit,
  requirePosIdempotencyKey,
  requirePosCapability(PosCapability.REGISTER_CLOSE),
  validatePosParams(registerIdParamSchema),
  registerController.closeRegister,
);

router.post(
  "/registers/:registerId/force-close",
  writeRateLimit,
  requirePosIdempotencyKey,
  requirePosCapability(PosCapability.REGISTER_FORCE_CLOSE),
  validatePosParams(registerIdParamSchema),
  validatePosBody(reasonBodySchema),
  registerController.forceCloseRegister,
);

// --------------------------------------------------------- sesiones de caja

router.get(
  "/register-sessions",
  requireAnyPosCapability([
    PosCapability.REGISTER_READ_OWN,
    PosCapability.REGISTER_READ_ALL,
  ]),
  validatePosQuery(sessionsQuerySchema),
  registerController.listSessions,
);

router.get(
  "/register-sessions/:sessionId",
  requireAnyPosCapability([
    PosCapability.REGISTER_READ_OWN,
    PosCapability.REGISTER_READ_ALL,
  ]),
  validatePosParams(sessionIdParamSchema),
  registerController.getSession,
);

router.post(
  "/register-sessions/:sessionId/shifts",
  writeRateLimit,
  requirePosIdempotencyKey,
  requirePosCapability(PosCapability.SHIFT_START),
  validatePosParams(sessionIdParamSchema),
  validatePosBody(startShiftSchema),
  registerController.startShift,
);

router.post(
  "/register-sessions/:sessionId/cut",
  writeRateLimit,
  requirePosIdempotencyKey,
  requirePosCapability(PosCapability.CUT_REVIEW),
  validatePosParams(sessionIdParamSchema),
  cutController.buildSessionCut,
);

// ------------------------------------------------------------------ turnos

router.get(
  "/shifts",
  requireAnyPosCapability([
    PosCapability.SHIFT_READ_OWN,
    PosCapability.SHIFT_READ_ALL,
  ]),
  validatePosQuery(shiftsQuerySchema),
  registerController.listShifts,
);

router.get("/shifts/me", registerController.getMyShift);

router.get(
  "/shifts/:shiftId",
  requireAnyPosCapability([
    PosCapability.SHIFT_READ_OWN,
    PosCapability.SHIFT_READ_ALL,
  ]),
  validatePosParams(shiftIdParamSchema),
  registerController.getShift,
);

router.get(
  "/shifts/:shiftId/timeline",
  requireAnyPosCapability([
    PosCapability.SHIFT_READ_OWN,
    PosCapability.SHIFT_READ_ALL,
  ]),
  validatePosParams(shiftIdParamSchema),
  registerController.getShiftTimeline,
);

router.post(
  "/shifts/:shiftId/request-handoff",
  writeRateLimit,
  requirePosIdempotencyKey,
  requirePosCapability(PosCapability.SHIFT_HANDOFF),
  validatePosParams(shiftIdParamSchema),
  validatePosBody(requestHandoffSchema),
  registerController.requestHandoff,
);

router.post(
  "/shifts/:shiftId/complete-handoff",
  writeRateLimit,
  requirePosIdempotencyKey,
  requirePosCapability(PosCapability.SHIFT_HANDOFF),
  validatePosParams(shiftIdParamSchema),
  validatePosBody(completeHandoffSchema),
  registerController.completeHandoff,
);

router.post(
  "/shifts/:shiftId/end",
  writeRateLimit,
  requirePosIdempotencyKey,
  requirePosCapability(PosCapability.SHIFT_END_OWN),
  validatePosParams(shiftIdParamSchema),
  registerController.endShift,
);

router.post(
  "/shifts/:shiftId/force-close",
  writeRateLimit,
  requirePosIdempotencyKey,
  requirePosCapability(PosCapability.REGISTER_FORCE_CLOSE),
  validatePosParams(shiftIdParamSchema),
  validatePosBody(reasonBodySchema),
  registerController.forceCloseShift,
);

// ---------------------------------------------------------- arqueo y conteo

router.post(
  "/shifts/:shiftId/start-count",
  writeRateLimit,
  requirePosIdempotencyKey,
  requirePosCapability(PosCapability.CUT_CREATE_OWN),
  validatePosParams(shiftIdParamSchema),
  cutController.startCount,
);

router.post(
  "/shifts/:shiftId/cancel-count",
  writeRateLimit,
  requirePosIdempotencyKey,
  requirePosCapability(PosCapability.CUT_CREATE_OWN),
  validatePosParams(shiftIdParamSchema),
  cutController.cancelCount,
);

router.get(
  "/shifts/:shiftId/cut-preview",
  requireAnyPosCapability([
    PosCapability.CUT_READ_OWN,
    PosCapability.CUT_READ_ALL,
  ]),
  validatePosParams(shiftIdParamSchema),
  cutController.previewCut,
);

/**
 * Envío del conteo. Crear y enviar es una sola operación atómica que cierra el corte
 * de forma autónoma (APPROVED) sin exigir aprobación de un tercero.
 */
router.post(
  "/shifts/:shiftId/cash-counts",
  writeRateLimit,
  requirePosIdempotencyKey,
  requirePosCapability(PosCapability.CUT_CREATE_OWN),
  validatePosParams(shiftIdParamSchema),
  validatePosBody(submitCashCountSchema),
  cutController.submitCashCount,
);

router.get(
  "/shifts/:shiftId/cash-counts",
  requireAnyPosCapability([
    PosCapability.CUT_READ_OWN,
    PosCapability.CUT_READ_ALL,
  ]),
  validatePosParams(shiftIdParamSchema),
  cutController.listCashCounts,
);

router.get(
  "/cash-counts/:countId",
  requireAnyPosCapability([
    PosCapability.CUT_READ_OWN,
    PosCapability.CUT_READ_ALL,
  ]),
  validatePosParams(countIdParamSchema),
  cutController.getCashCount,
);

// ------------------------------------------------------------------ ventas

router.post(
  "/sales",
  writeRateLimit,
  requirePosCapability(PosCapability.SALE_CREATE),
  validatePosBody(createSaleSchema),
  saleController.createSale,
);

router.get(
  "/sales",
  requireAnyPosCapability([
    PosCapability.SHIFT_READ_OWN,
    PosCapability.SHIFT_READ_ALL,
  ]),
  validatePosQuery(salesQuerySchema),
  saleController.listSales,
);

router.get(
  "/sales/:saleId",
  validatePosParams(saleIdParamSchema),
  saleController.getSale,
);

router.post(
  "/sales/:saleId/items",
  writeRateLimit,
  requirePosCapability(PosCapability.SALE_CREATE),
  validatePosParams(saleIdParamSchema),
  validatePosBody(addSaleItemSchema),
  saleController.addSaleItem,
);

router.patch(
  "/sales/:saleId/items/:itemId",
  writeRateLimit,
  requirePosCapability(PosCapability.SALE_CREATE),
  validatePosParams(saleItemParamsSchema),
  validatePosBody(updateSaleItemSchema),
  saleController.updateSaleItem,
);

router.delete(
  "/sales/:saleId/items/:itemId",
  writeRateLimit,
  requirePosCapability(PosCapability.SALE_CREATE),
  validatePosParams(saleItemParamsSchema),
  saleController.removeSaleItem,
);

router.post(
  "/sales/:saleId/reprice",
  writeRateLimit,
  requirePosCapability(PosCapability.SALE_CREATE),
  validatePosParams(saleIdParamSchema),
  saleController.repriceSale,
);

router.post(
  "/sales/:saleId/apply-code",
  writeRateLimit,
  requirePosCapability(PosCapability.SALE_CREATE),
  validatePosParams(saleIdParamSchema),
  validatePosBody(applyCodeSchema),
  saleController.applySaleCode,
);

router.delete(
  "/sales/:saleId/applied-code",
  writeRateLimit,
  requirePosCapability(PosCapability.SALE_CREATE),
  validatePosParams(saleIdParamSchema),
  saleController.removeSaleCode,
);

router.post(
  "/sales/:saleId/manual-discount",
  writeRateLimit,
  requirePosCapability(PosCapability.SALE_DISCOUNT_MANUAL),
  validatePosParams(saleIdParamSchema),
  validatePosBody(manualDiscountSchema),
  saleController.applyManualDiscount,
);

router.post(
  "/sales/:saleId/suspend",
  writeRateLimit,
  requirePosCapability(PosCapability.SALE_SUSPEND),
  validatePosParams(saleIdParamSchema),
  saleController.suspendSale,
);

router.post(
  "/sales/:saleId/resume",
  writeRateLimit,
  requirePosCapability(PosCapability.SALE_RESUME),
  validatePosParams(saleIdParamSchema),
  saleController.resumeSale,
);

router.post(
  "/sales/:saleId/return-to-draft",
  writeRateLimit,
  requirePosCapability(PosCapability.SALE_CREATE),
  validatePosParams(saleIdParamSchema),
  saleController.returnSaleToDraft,
);

router.post(
  "/sales/:saleId/cancel",
  writeRateLimit,
  requirePosCapability(PosCapability.SALE_CANCEL_UNPAID),
  validatePosParams(saleIdParamSchema),
  validatePosBody(reasonBodySchema),
  saleController.cancelSale,
);

router.post(
  "/sales/:saleId/checkout-preview",
  writeRateLimit,
  requirePosCapability(PosCapability.SALE_CREATE),
  validatePosParams(saleIdParamSchema),
  saleController.checkoutPreview,
);

/** Cancelación de venta pagada: siempre a través de devolución y reembolso. */
router.post(
  "/sales/:saleId/void",
  paymentRateLimit,
  requirePosIdempotencyKey,
  requirePosCapability(PosCapability.SALE_CANCEL_PAID),
  validatePosParams(saleIdParamSchema),
  validatePosBody(voidPaidSaleSchema),
  saleController.voidPaidSale,
);

// ------------------------------------------------------------------- pagos

router.get(
  "/sales/:saleId/payments",
  validatePosParams(saleIdParamSchema),
  saleController.listSalePayments,
);

router.post(
  "/sales/:saleId/payments/cash",
  paymentRateLimit,
  requirePosIdempotencyKey,
  requirePosCapability(PosCapability.SALE_CREATE),
  validatePosParams(saleIdParamSchema),
  validatePosBody(cashPaymentSchema),
  saleController.payCash,
);

router.post(
  "/sales/:saleId/payments/card-external",
  paymentRateLimit,
  requirePosIdempotencyKey,
  requirePosCapability(PosCapability.SALE_CREATE),
  validatePosParams(saleIdParamSchema),
  validatePosBody(cardPaymentSchema),
  saleController.payCardExternal,
);

router.post(
  "/sales/:saleId/payments/mixed",
  paymentRateLimit,
  requirePosIdempotencyKey,
  requirePosCapability(PosCapability.SALE_CREATE),
  validatePosParams(saleIdParamSchema),
  validatePosBody(mixedPaymentSchema),
  saleController.payMixed,
);

router.post(
  "/sales/:saleId/payments/:paymentId/decline",
  paymentRateLimit,
  requirePosCapability(PosCapability.SALE_CREATE),
  validatePosParams(salePaymentParamsSchema),
  validatePosBody(reasonBodySchema),
  saleController.declinePayment,
);

router.post(
  "/sales/:saleId/payments/:paymentId/cancel",
  paymentRateLimit,
  requirePosIdempotencyKey,
  requirePosCapability(PosCapability.SALE_CREATE),
  validatePosParams(salePaymentParamsSchema),
  validatePosBody(reasonBodySchema),
  saleController.cancelPayment,
);

// ----------------------------------------------------------------- tickets

router.get(
  "/sales/:saleId/ticket",
  requirePosCapability(PosCapability.TICKET_READ),
  validatePosParams(saleIdParamSchema),
  saleController.getTicket,
);

router.post(
  "/sales/:saleId/ticket/reprint",
  writeRateLimit,
  requirePosCapability(PosCapability.TICKET_REPRINT),
  validatePosParams(saleIdParamSchema),
  validatePosBody(reprintTicketSchema),
  saleController.reprintTicket,
);

// ------------------------------------------------------------- devoluciones

router.post(
  "/sales/:saleId/returns",
  writeRateLimit,
  requirePosIdempotencyKey,
  requirePosCapability(PosCapability.SALE_REFUND),
  validatePosParams(saleIdParamSchema),
  validatePosBody(createReturnSchema),
  returnController.createReturn,
);

router.get(
  "/returns",
  requirePosCapability(PosCapability.SALE_REFUND),
  validatePosQuery(returnsQuerySchema),
  returnController.listReturns,
);

router.get(
  "/returns/:returnId",
  requirePosCapability(PosCapability.SALE_REFUND),
  validatePosParams(returnIdParamSchema),
  returnController.getReturn,
);

router.post(
  "/returns/:returnId/approve",
  writeRateLimit,
  requirePosIdempotencyKey,
  requirePosCapability(PosCapability.SALE_REFUND),
  validatePosParams(returnIdParamSchema),
  returnController.approveReturn,
);

router.post(
  "/returns/:returnId/reject",
  writeRateLimit,
  requirePosCapability(PosCapability.SALE_REFUND),
  validatePosParams(returnIdParamSchema),
  validatePosBody(reasonBodySchema),
  returnController.rejectReturn,
);

router.post(
  "/returns/:returnId/cancel",
  writeRateLimit,
  requirePosCapability(PosCapability.SALE_REFUND),
  validatePosParams(returnIdParamSchema),
  validatePosBody(reasonBodySchema),
  returnController.cancelReturn,
);

router.post(
  "/returns/:returnId/complete",
  paymentRateLimit,
  requirePosIdempotencyKey,
  requirePosCapability(PosCapability.SALE_REFUND),
  validatePosParams(returnIdParamSchema),
  validatePosBody(completeReturnSchema),
  returnController.completeReturn,
);

// ------------------------------------------------------ movimientos de caja

router.get(
  "/cash-movements",
  validatePosQuery(cashMovementsQuerySchema),
  cashController.listCashMovements,
);

router.post(
  "/cash-movements",
  writeRateLimit,
  requirePosIdempotencyKey,
  requireAnyPosCapability([
    PosCapability.CASH_MOVEMENT_CREATE,
    PosCapability.CASH_DROP_REQUEST,
    PosCapability.CASH_TRANSFER_REQUEST,
  ]),
  validatePosBody(createCashMovementSchema),
  cashController.createCashMovement,
);

router.get(
  "/cash-movements/:movementId",
  validatePosParams(movementIdParamSchema),
  cashController.getCashMovement,
);

router.post(
  "/cash-movements/:movementId/approve",
  writeRateLimit,
  requirePosIdempotencyKey,
  requirePosCapability(PosCapability.CASH_MOVEMENT_APPROVE),
  validatePosParams(movementIdParamSchema),
  validatePosBody(optionalNoteBodySchema),
  cashController.approveCashMovement,
);

router.post(
  "/cash-movements/:movementId/reject",
  writeRateLimit,
  requirePosCapability(PosCapability.CASH_MOVEMENT_APPROVE),
  validatePosParams(movementIdParamSchema),
  validatePosBody(reasonBodySchema),
  cashController.rejectCashMovement,
);

router.post(
  "/cash-movements/:movementId/cancel",
  writeRateLimit,
  requirePosCapability(PosCapability.CASH_MOVEMENT_CREATE),
  validatePosParams(movementIdParamSchema),
  validatePosBody(reasonBodySchema),
  cashController.cancelCashMovement,
);

router.post(
  "/cash-movements/:movementId/confirm-delivery",
  writeRateLimit,
  requirePosIdempotencyKey,
  requireAnyPosCapability([
    PosCapability.CASH_DROP_REQUEST,
    PosCapability.CASH_TRANSFER_REQUEST,
  ]),
  validatePosParams(movementIdParamSchema),
  cashController.confirmCashMovementDelivery,
);

router.post(
  "/cash-movements/:movementId/confirm-receipt",
  writeRateLimit,
  requirePosIdempotencyKey,
  requireAnyPosCapability([
    PosCapability.CASH_DROP_APPROVE,
    PosCapability.CASH_TRANSFER_CONFIRM,
  ]),
  validatePosParams(movementIdParamSchema),
  validatePosBody(confirmReceiptSchema),
  cashController.confirmCashMovementReceipt,
);

router.post(
  "/cash-movements/:movementId/reverse",
  writeRateLimit,
  requirePosIdempotencyKey,
  requirePosCapability(PosCapability.CASH_MOVEMENT_APPROVE),
  validatePosParams(movementIdParamSchema),
  validatePosBody(reasonBodySchema),
  cashController.reverseCashMovement,
);

// ------------------------------------------------------------------ cortes

router.get(
  "/cuts",
  requireAnyPosCapability([
    PosCapability.CUT_READ_OWN,
    PosCapability.CUT_READ_ALL,
  ]),
  validatePosQuery(cutsQuerySchema),
  cutController.listCuts,
);

router.get(
  "/cuts/:cutId",
  requireAnyPosCapability([
    PosCapability.CUT_READ_OWN,
    PosCapability.CUT_READ_ALL,
  ]),
  validatePosParams(cutIdParamSchema),
  cutController.getCut,
);

router.get(
  "/cuts/:cutId/versions",
  requirePosCapability(PosCapability.CUT_READ_OWN),
  validatePosParams(cutIdParamSchema),
  cutController.listCutVersions,
);

router.post(
  "/cuts/:cutId/review",
  writeRateLimit,
  requirePosCapability(PosCapability.CUT_REVIEW),
  validatePosParams(cutIdParamSchema),
  cutController.reviewCut,
);

router.post(
  "/cuts/:cutId/request-clarification",
  writeRateLimit,
  requirePosCapability(PosCapability.CUT_REVIEW),
  validatePosParams(cutIdParamSchema),
  validatePosBody(reasonBodySchema),
  cutController.requestCutClarification,
);

router.post(
  "/cuts/:cutId/request-second-count",
  writeRateLimit,
  requirePosCapability(PosCapability.CUT_REQUEST_SECOND_COUNT),
  validatePosParams(cutIdParamSchema),
  validatePosBody(reasonBodySchema),
  cutController.requestSecondCount,
);

router.post(
  "/cuts/:cutId/approve",
  writeRateLimit,
  requirePosIdempotencyKey,
  requirePosCapability(PosCapability.CUT_APPROVE),
  validatePosParams(cutIdParamSchema),
  validatePosBody(cutApproveSchema),
  cutController.approveCut,
);

router.post(
  "/cuts/:cutId/reject",
  writeRateLimit,
  requirePosCapability(PosCapability.CUT_REJECT),
  validatePosParams(cutIdParamSchema),
  validatePosBody(reasonBodySchema),
  cutController.rejectCut,
);

router.post(
  "/cuts/:cutId/escalate",
  writeRateLimit,
  requirePosCapability(PosCapability.CUT_REVIEW),
  validatePosParams(cutIdParamSchema),
  validatePosBody(reasonBodySchema),
  cutController.escalateCut,
);

router.post(
  "/cuts/:cutId/reopen",
  writeRateLimit,
  requirePosCapability(PosCapability.CUT_REOPEN),
  validatePosParams(cutIdParamSchema),
  validatePosBody(reasonBodySchema),
  cutController.reopenCut,
);

// ------------------------------------------------------------ cierre diario

router.get(
  "/daily-close/:operationalDate/readiness",
  requirePosCapability(PosCapability.DAILY_CLOSE_PREVIEW),
  validatePosParams(operationalDateParamSchema),
  dailyCloseController.getReadiness,
);

router.post(
  "/daily-close/:operationalDate/preview",
  requirePosCapability(PosCapability.DAILY_CLOSE_PREVIEW),
  validatePosParams(operationalDateParamSchema),
  dailyCloseController.previewDailyClose,
);

router.post(
  "/daily-close/:operationalDate/close",
  writeRateLimit,
  requirePosIdempotencyKey,
  requirePosCapability(PosCapability.DAILY_CLOSE_EXECUTE),
  validatePosParams(operationalDateParamSchema),
  dailyCloseController.closeDay,
);

router.post(
  "/daily-close/:operationalDate/force-close",
  writeRateLimit,
  requirePosIdempotencyKey,
  requirePosCapability(PosCapability.DAILY_CLOSE_FORCE),
  validatePosParams(operationalDateParamSchema),
  validatePosBody(reasonBodySchema),
  dailyCloseController.forceCloseDay,
);

router.get(
  "/daily-closes",
  requireAnyPosCapability([
    PosCapability.DAILY_CLOSE_PREVIEW,
    PosCapability.REPORT_READ_ALL,
  ]),
  validatePosQuery(dailyClosesQuerySchema),
  dailyCloseController.listDailyCloses,
);

router.get(
  "/daily-closes/:dailyCloseId",
  requireAnyPosCapability([
    PosCapability.DAILY_CLOSE_PREVIEW,
    PosCapability.REPORT_READ_ALL,
  ]),
  validatePosParams(dailyCloseIdParamSchema),
  dailyCloseController.getDailyClose,
);

// ------------------------------------------------------------- incidencias

router.post(
  "/incidents",
  writeRateLimit,
  requirePosCapability(PosCapability.INCIDENT_CREATE),
  validatePosBody(createIncidentSchema),
  incidentController.createIncident,
);

router.get(
  "/incidents",
  validatePosQuery(incidentsQuerySchema),
  incidentController.listIncidents,
);

router.get(
  "/incidents/:incidentId",
  validatePosParams(incidentIdParamSchema),
  incidentController.getIncident,
);

router.post(
  "/incidents/:incidentId/assign",
  writeRateLimit,
  requirePosCapability(PosCapability.INCIDENT_RESOLVE),
  validatePosParams(incidentIdParamSchema),
  validatePosBody(assignIncidentSchema),
  incidentController.assignIncident,
);

router.post(
  "/incidents/:incidentId/resolve",
  writeRateLimit,
  requirePosCapability(PosCapability.INCIDENT_RESOLVE),
  validatePosParams(incidentIdParamSchema),
  validatePosBody(resolveIncidentSchema),
  incidentController.resolveIncident,
);

router.post(
  "/incidents/:incidentId/dismiss",
  writeRateLimit,
  requirePosCapability(PosCapability.INCIDENT_RESOLVE),
  validatePosParams(incidentIdParamSchema),
  validatePosBody(reasonBodySchema),
  incidentController.dismissIncident,
);

router.post(
  "/incidents/:incidentId/escalate",
  writeRateLimit,
  requirePosCapability(PosCapability.INCIDENT_CREATE),
  validatePosParams(incidentIdParamSchema),
  validatePosBody(reasonBodySchema),
  incidentController.escalateIncident,
);

// ----------------------------------------------------------------- reportes

router.get(
  "/reports/shifts",
  requireAnyPosCapability([
    PosCapability.REPORT_READ_OWN,
    PosCapability.REPORT_READ_ALL,
  ]),
  validatePosQuery(reportQuerySchema),
  reportController.shiftsReport,
);

router.get(
  "/reports/registers",
  requirePosCapability(PosCapability.REPORT_READ_ALL),
  validatePosQuery(reportQuerySchema),
  reportController.registersReport,
);

router.get(
  "/reports/cash-movements",
  requireAnyPosCapability([
    PosCapability.REPORT_READ_OWN,
    PosCapability.REPORT_READ_ALL,
  ]),
  validatePosQuery(cashMovementReportQuerySchema),
  reportController.cashMovementsReport,
);

router.get(
  "/reports/differences",
  requirePosCapability(PosCapability.CUT_REVIEW),
  validatePosQuery(differenceReportQuerySchema),
  reportController.differencesReport,
);

router.get(
  "/reports/daily-summary",
  requirePosCapability(PosCapability.REPORT_READ_ALL),
  validatePosQuery(reportQuerySchema),
  reportController.dailySummaryReport,
);

router.get(
  "/reports/payment-reconciliation",
  requirePosCapability(PosCapability.REPORT_READ_ALL),
  validatePosQuery(reportQuerySchema),
  reportController.paymentReconciliationReport,
);

// ------------------------------------------------------------ exportaciones

router.post(
  "/exports",
  exportRateLimit,
  requirePosIdempotencyKey,
  requireAnyPosCapability([
    PosCapability.REPORT_READ_OWN,
    PosCapability.REPORT_READ_ALL,
  ]),
  validatePosBody(createExportSchema),
  reportController.createExport,
);

router.get(
  "/exports",
  requireAnyPosCapability([
    PosCapability.REPORT_READ_OWN,
    PosCapability.REPORT_READ_ALL,
  ]),
  validatePosQuery(exportsQuerySchema),
  reportController.listExports,
);

router.get(
  "/exports/:exportId",
  requireAnyPosCapability([
    PosCapability.REPORT_READ_OWN,
    PosCapability.REPORT_READ_ALL,
  ]),
  validatePosParams(exportIdParamSchema),
  reportController.getExport,
);

router.get(
  "/exports/:exportId/download",
  exportRateLimit,
  requireAnyPosCapability([
    PosCapability.REPORT_READ_OWN,
    PosCapability.REPORT_READ_ALL,
  ]),
  validatePosParams(exportIdParamSchema),
  reportController.downloadExport,
);

// ---------------------------------------------------------------- auditoría

router.get(
  "/audit-events",
  requirePosCapability(PosCapability.AUDIT_READ),
  validatePosQuery(auditEventsQuerySchema),
  reportController.listAuditEvents,
);

router.use(handlePosError);

export default router;
