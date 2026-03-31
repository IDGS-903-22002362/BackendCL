import { Timestamp } from "firebase-admin/firestore";
import { firestoreTienda } from "../../config/firebase";
import { admin } from "../../config/firebase.admin";
import { STORE_FIRESTORE_DATABASE } from "../../config/firestore.constants";
import { EstadoOrden, MetodoPago, Orden } from "../../models/orden.model";
import { PaymentStatus, RefundState } from "../../models/pago.model";
import { EstadoVentaPos, VentaPos } from "../../models/venta-pos.model";
import { RolUsuario } from "../../models/usuario.model";
import {
  RegistrarMovimientoInventarioDTO,
  TipoMovimientoInventario,
} from "../../models/inventario.model";
import logger from "../../utils/logger";
import { PaymentApiError } from "./payment-api-error";
import {
  PaymentAttempt,
  ProviderRefundResult,
  ProviderStatusResult,
} from "./payment-domain.types";
import paymentAttemptRepository from "./payment-attempt.repository";
import posSaleRepository from "./pos-sale.repository";
import inventoryService from "../inventory.service";
import ordenService from "../orden.service";

const ORDENES_COLLECTION = "ordenes";

type FinalizePaymentContext = {
  source: "webhook" | "reconcile" | "cancel" | "timeout";
  requestedBy?: string;
  providerResult?: ProviderStatusResult;
  webhookPayloadSanitized?: Record<string, unknown>;
  eventId?: string;
};

type ApplyRefundContext = {
  requestedBy: string;
  reason?: string;
  refundAmountMinor?: number;
};

const paymentFinalizerLogger = logger.child({
  component: "payment-finalizer-service",
  database: STORE_FIRESTORE_DATABASE,
});

const TERMINAL_FINALIZATION_STATUSES = new Set<PaymentStatus>([
  PaymentStatus.PAID,
  PaymentStatus.FAILED,
  PaymentStatus.CANCELED,
  PaymentStatus.EXPIRED,
]);

const buildTimestampPatch = (
  status: PaymentStatus,
  providerResult?: ProviderStatusResult,
): Record<string, unknown> => {
  const patch: Record<string, unknown> = {};
  const now = Timestamp.now();

  if (status === PaymentStatus.PAID) {
    patch.fechaPago = providerResult?.paidAt
      ? Timestamp.fromDate(providerResult.paidAt)
      : now;
    patch.paidAt = providerResult?.paidAt
      ? Timestamp.fromDate(providerResult.paidAt)
      : now;
    patch.failedAt = admin.firestore.FieldValue.delete();
    patch.canceledAt = admin.firestore.FieldValue.delete();
    patch.expiredAt = admin.firestore.FieldValue.delete();
    return patch;
  }

  if (status === PaymentStatus.FAILED) {
    patch.failedAt = now;
  }

  if (status === PaymentStatus.CANCELED) {
    patch.canceledAt = now;
  }

  if (status === PaymentStatus.EXPIRED) {
    patch.expiredAt = now;
  }

  return patch;
};

export class PaymentFinalizerService {
  constructor(
    private readonly paymentAttemptRepo = paymentAttemptRepository,
    private readonly posSaleRepo = posSaleRepository,
  ) {}

  async finalizeTerminalStatus(
    paymentAttempt: PaymentAttempt,
    targetStatus: PaymentStatus,
    context: FinalizePaymentContext,
  ): Promise<PaymentAttempt> {
    if (!paymentAttempt.id) {
      throw new PaymentApiError(
        409,
        "PAYMENT_ATTEMPT_NOT_FOUND",
        "El intento de pago no tiene identificador para finalizarse",
      );
    }

    if (!TERMINAL_FINALIZATION_STATUSES.has(targetStatus)) {
      throw new PaymentApiError(
        409,
        "PAYMENT_INVALID_TRANSITION",
        `El estado ${targetStatus} no se puede finalizar con exactly-once`,
      );
    }

    const operationSeed = [
      context.source,
      targetStatus,
      context.eventId || "manual",
      context.requestedBy || "system",
    ].join(":");
    const operationId = this.paymentAttemptRepo.buildOperationId(
      paymentAttempt.id,
      operationSeed,
    );

    const lock = await this.paymentAttemptRepo.tryStartFinalization(
      paymentAttempt.id,
      operationId,
      targetStatus,
    );

    if (!lock.acquired) {
      paymentFinalizerLogger.info("payment_finalization_skipped", {
        paymentAttemptId: paymentAttempt.id,
        operationId,
        targetStatus,
      });
      return lock.attempt;
    }

    try {
      const attempt = lock.attempt;

      if (attempt.ordenId) {
        if (targetStatus === PaymentStatus.PAID) {
          await this.confirmOrderPayment(attempt, context);
        } else {
          await this.cancelOrderReservation(attempt, targetStatus, context);
        }
      }

      if (attempt.ventaPosId) {
        if (targetStatus === PaymentStatus.PAID) {
          await this.completePosSale(attempt, operationId);
        } else {
          await this.markPosSaleAsTerminal(attempt, targetStatus);
        }
      }

      const providerResult = context.providerResult;
      const patch: Partial<PaymentAttempt> = {
        status: targetStatus,
        providerStatus: providerResult?.providerStatus ?? attempt.providerStatus,
        providerPaymentId:
          providerResult?.providerPaymentId ?? attempt.providerPaymentId,
        providerLoanId: providerResult?.providerLoanId ?? attempt.providerLoanId,
        providerReference:
          providerResult?.providerReference ?? attempt.providerReference,
        rawLastWebhookSanitized:
          context.webhookPayloadSanitized ?? attempt.rawLastWebhookSanitized,
        ...buildTimestampPatch(targetStatus, providerResult),
      };

      return await this.paymentAttemptRepo.finalize(
        paymentAttempt.id,
        operationId,
        patch,
      );
    } catch (error) {
      await this.paymentAttemptRepo.markFinalizationError(
        paymentAttempt.id,
        operationId,
        error instanceof Error ? error.message : "Error desconocido",
      );
      throw error;
    }
  }

  async applyRefundResult(
    paymentAttempt: PaymentAttempt,
    refundResult: ProviderRefundResult,
    context: ApplyRefundContext,
  ): Promise<PaymentAttempt> {
    if (!paymentAttempt.id) {
      throw new PaymentApiError(
        409,
        "PAYMENT_ATTEMPT_NOT_FOUND",
        "El intento de pago no tiene identificador para registrar refund",
      );
    }

    const currentRefundAmount =
      typeof paymentAttempt.refundAmount === "number"
        ? Math.round(paymentAttempt.refundAmount * 100)
        : 0;
    const deltaMinor = refundResult.refundAmountMinor ?? context.refundAmountMinor;
    const nextRefundMinor =
      typeof deltaMinor === "number" && Number.isFinite(deltaMinor)
        ? currentRefundAmount + deltaMinor
        : currentRefundAmount;
    const totalMinor =
      paymentAttempt.amountMinor ?? Math.round(paymentAttempt.monto * 100);
    const nextStatus =
      refundResult.status ??
      (nextRefundMinor >= totalMinor && totalMinor > 0
        ? PaymentStatus.REFUNDED
        : PaymentStatus.PARTIALLY_REFUNDED);

    if (paymentAttempt.ordenId) {
      await this.ensureRefundedOrderIsCanceled(paymentAttempt);
    }

    if (paymentAttempt.ventaPosId) {
      await this.restorePosInventory(paymentAttempt, context.requestedBy);
    }

    return this.paymentAttemptRepo.update(paymentAttempt.id, {
      refundState: refundResult.refundState,
      status: nextStatus,
      providerStatus: refundResult.providerStatus ?? paymentAttempt.providerStatus,
      refundId: refundResult.refundId ?? paymentAttempt.refundId,
      refundAmount:
        typeof nextRefundMinor === "number" && Number.isFinite(nextRefundMinor)
          ? nextRefundMinor / 100
          : paymentAttempt.refundAmount,
      refundReason: context.reason ?? paymentAttempt.refundReason,
      rawCreateResponseSanitized:
        refundResult.rawResponseSanitized ??
        paymentAttempt.rawCreateResponseSanitized,
      metadata: {
        ...(paymentAttempt.metadata || {}),
        lastRefundRequestedBy: context.requestedBy,
      },
    });
  }

  async markManualRefundRequested(
    paymentAttempt: PaymentAttempt,
    requestedBy: string,
    reason?: string,
  ): Promise<PaymentAttempt> {
    if (!paymentAttempt.id) {
      throw new PaymentApiError(
        409,
        "PAYMENT_ATTEMPT_NOT_FOUND",
        "El intento de pago no tiene identificador para solicitar refund",
      );
    }

    return this.paymentAttemptRepo.update(paymentAttempt.id, {
      refundState: RefundState.REQUESTED,
      metadata: {
        ...(paymentAttempt.metadata || {}),
        manualRefundRequestedAt: Timestamp.now(),
        manualRefundRequestedBy: requestedBy,
        manualRefundReason: reason,
      },
    });
  }

  async recordLatePaidDivergence(
    paymentAttempt: PaymentAttempt,
    providerStatus?: string,
    eventId?: string,
  ): Promise<PaymentAttempt> {
    if (!paymentAttempt.id) {
      throw new PaymentApiError(
        409,
        "PAYMENT_ATTEMPT_NOT_FOUND",
        "El intento de pago no tiene identificador para registrar divergencia",
      );
    }

    paymentFinalizerLogger.warn("payment_divergence_late_paid", {
      paymentAttemptId: paymentAttempt.id,
      provider: paymentAttempt.provider,
      orderId: paymentAttempt.ordenId,
      ventaPosId: paymentAttempt.ventaPosId,
      status: paymentAttempt.status,
      providerStatus,
      eventId,
    });

    return this.paymentAttemptRepo.update(paymentAttempt.id, {
      metadata: {
        ...(paymentAttempt.metadata || {}),
        divergenceCode: "divergence_late_paid",
        divergenceAt: Timestamp.now(),
        divergenceProviderStatus: providerStatus,
        divergenceEventId: eventId,
      },
    });
  }

  private async confirmOrderPayment(
    paymentAttempt: PaymentAttempt,
    context: FinalizePaymentContext,
  ): Promise<void> {
    const orderRef = firestoreTienda
      .collection(ORDENES_COLLECTION)
      .doc(paymentAttempt.ordenId);
    const orderSnapshot = await orderRef.get();

    if (!orderSnapshot.exists) {
      throw new PaymentApiError(
        404,
        "PAYMENT_ORDER_NOT_FOUND",
        `Orden ${paymentAttempt.ordenId} no encontrada para confirmar pago`,
      );
    }

    const order = orderSnapshot.data() as Orden;
    if (order.estado === EstadoOrden.CANCELADA) {
      throw new PaymentApiError(
        409,
        "PAYMENT_DIVERGENCE",
        "La orden ya fue cancelada localmente; no se reabre por un pago tardío",
      );
    }

    if (
      order.estado === EstadoOrden.CONFIRMADA ||
      order.estado === EstadoOrden.EN_PROCESO ||
      order.estado === EstadoOrden.ENVIADA ||
      order.estado === EstadoOrden.ENTREGADA
    ) {
      return;
    }

    await orderRef.set(
      {
        estado: EstadoOrden.CONFIRMADA,
        metodoPago:
          paymentAttempt.metodoPago === MetodoPago.APLAZO
            ? MetodoPago.APLAZO
            : order.metodoPago,
        transaccionId:
          context.providerResult?.providerLoanId ||
          paymentAttempt.providerLoanId ||
          context.providerResult?.providerPaymentId ||
          paymentAttempt.providerPaymentId ||
          context.providerResult?.providerReference ||
          paymentAttempt.providerReference ||
          order.transaccionId,
        referenciaPago:
          context.providerResult?.providerReference ||
          paymentAttempt.providerReference ||
          order.referenciaPago,
        paymentMetadata: {
          ...(order.paymentMetadata || {}),
          paymentAttemptId: paymentAttempt.id,
          finalizedBy: context.source,
          provider: paymentAttempt.provider,
        },
        updatedAt: Timestamp.now(),
      },
      { merge: true },
    );
  }

  private async cancelOrderReservation(
    paymentAttempt: PaymentAttempt,
    targetStatus: PaymentStatus,
    context: FinalizePaymentContext,
  ): Promise<void> {
    const orderRef = firestoreTienda
      .collection(ORDENES_COLLECTION)
      .doc(paymentAttempt.ordenId);
    const orderSnapshot = await orderRef.get();

    if (!orderSnapshot.exists) {
      throw new PaymentApiError(
        404,
        "PAYMENT_ORDER_NOT_FOUND",
        `Orden ${paymentAttempt.ordenId} no encontrada para cancelar reserva`,
      );
    }

    const order = orderSnapshot.data() as Orden;
    if (order.estado === EstadoOrden.CANCELADA) {
      return;
    }

    if (
      order.estado !== EstadoOrden.PENDIENTE &&
      order.estado !== EstadoOrden.CONFIRMADA
    ) {
      throw new PaymentApiError(
        409,
        "PAYMENT_DIVERGENCE",
        `La orden ${paymentAttempt.ordenId} está en estado ${order.estado} y no se puede liberar automáticamente`,
        {
          targetStatus,
          source: context.source,
        },
      );
    }

    await ordenService.cancelarOrden(paymentAttempt.ordenId, {
      uid: context.requestedBy || "system",
      rol: RolUsuario.ADMIN,
    });
  }

  private async completePosSale(
    paymentAttempt: PaymentAttempt,
    operationId: string,
  ): Promise<void> {
    const sale = await this.requirePosSale(paymentAttempt.ventaPosId);

    if (sale.status === EstadoVentaPos.PAGADA) {
      return;
    }

    for (const item of sale.items) {
      const movementPayload: RegistrarMovimientoInventarioDTO = {
        tipo: TipoMovimientoInventario.VENTA,
        productoId: item.productoId,
        tallaId: item.tallaId,
        cantidad: item.cantidad,
        ventaPosId: sale.id,
        referencia: sale.id,
        motivo: "Venta POS liquidada vía Aplazo",
        usuarioId: sale.vendedorUid,
        idempotencyKey: Buffer.from(
          `${operationId}:${item.productoId}:${item.tallaId ?? "_"}`,
        ).toString("base64url"),
      };
      await inventoryService.registerMovement(movementPayload);
    }

    await this.posSaleRepo.markStatus(sale.id!, EstadoVentaPos.PAGADA, {
      paymentAttemptId: paymentAttempt.id,
      providerReference:
        paymentAttempt.providerReference ?? sale.providerReference,
    });
  }

  private async markPosSaleAsTerminal(
    paymentAttempt: PaymentAttempt,
    status: PaymentStatus,
  ): Promise<void> {
    const sale = await this.requirePosSale(paymentAttempt.ventaPosId);
    const nextStatus =
      status === PaymentStatus.EXPIRED
        ? EstadoVentaPos.EXPIRADA
        : status === PaymentStatus.CANCELED
          ? EstadoVentaPos.CANCELADA
          : EstadoVentaPos.FALLIDA;

    if (sale.status === nextStatus) {
      return;
    }

    if (sale.status === EstadoVentaPos.PAGADA) {
      throw new PaymentApiError(
        409,
        "PAYMENT_DIVERGENCE",
        `La venta POS ${sale.id} ya fue pagada y no puede transicionar a ${nextStatus}`,
      );
    }

    await this.posSaleRepo.markStatus(sale.id!, nextStatus, {
      paymentAttemptId: paymentAttempt.id,
      providerReference:
        paymentAttempt.providerReference ?? sale.providerReference,
    });
  }

  private async ensureRefundedOrderIsCanceled(
    paymentAttempt: PaymentAttempt,
  ): Promise<void> {
    const orderRef = firestoreTienda
      .collection(ORDENES_COLLECTION)
      .doc(paymentAttempt.ordenId);
    const orderSnapshot = await orderRef.get();
    if (!orderSnapshot.exists) {
      throw new PaymentApiError(
        404,
        "PAYMENT_ORDER_NOT_FOUND",
        `Orden ${paymentAttempt.ordenId} no encontrada para refund`,
      );
    }

    const order = orderSnapshot.data() as Orden;
    if (order.estado === EstadoOrden.CANCELADA) {
      return;
    }

    await ordenService.cancelarOrden(paymentAttempt.ordenId, {
      uid: "system-refund",
      rol: RolUsuario.ADMIN,
    });
  }

  private async restorePosInventory(
    paymentAttempt: PaymentAttempt,
    requestedBy: string,
  ): Promise<void> {
    const sale = await this.requirePosSale(paymentAttempt.ventaPosId);
    if (sale.status !== EstadoVentaPos.PAGADA) {
      return;
    }

    for (const item of sale.items) {
      await inventoryService.registerMovement({
        tipo: TipoMovimientoInventario.DEVOLUCION,
        productoId: item.productoId,
        tallaId: item.tallaId,
        cantidad: item.cantidad,
        ventaPosId: sale.id,
        referencia: sale.id,
        motivo: "Refund POS procesado vía Aplazo",
        usuarioId: requestedBy,
        idempotencyKey: Buffer.from(
          `refund:${paymentAttempt.id}:${item.productoId}:${item.tallaId ?? "_"}`,
        ).toString("base64url"),
      });
    }

    await this.posSaleRepo.markStatus(sale.id!, EstadoVentaPos.CANCELADA, {
      metadata: {
        ...(sale.metadata || {}),
        refundedAt: Timestamp.now(),
      },
    });
  }

  private async requirePosSale(ventaPosId?: string): Promise<VentaPos> {
    if (!ventaPosId) {
      throw new PaymentApiError(
        404,
        "PAYMENT_POS_SALE_NOT_FOUND",
        "El intento de pago no está asociado a una venta POS",
      );
    }

    const sale = await this.posSaleRepo.getById(ventaPosId);
    if (!sale) {
      throw new PaymentApiError(
        404,
        "PAYMENT_POS_SALE_NOT_FOUND",
        `Venta POS ${ventaPosId} no encontrada`,
      );
    }

    return sale;
  }
}

export const paymentFinalizerService = new PaymentFinalizerService();
export default paymentFinalizerService;
