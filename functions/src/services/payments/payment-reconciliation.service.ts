import { Timestamp } from "firebase-admin/firestore";
import { firestoreTienda } from "../../config/firebase";
import logger from "../../utils/logger";
import { getAplazoConfig } from "../../config/aplazo.config";
import { PaymentStatus, ProveedorPago } from "../../models/pago.model";
import paymentAttemptRepository, {
  mapLegacyEstadoToPaymentStatus,
} from "./payment-attempt.repository";
import paymentEventLogRepository from "./payment-event-log.repository";
import paymentFinalizerService from "./payment-finalizer.service";
import paymentEventProcessingService from "./payment-event-processing.service";
import aplazoProvider from "./providers/aplazo.provider";
import { canTransitionPaymentStatus } from "./payment-state-machine";
import { PaymentApiError } from "./payment-api-error";
import { PaymentAttempt } from "./payment-domain.types";

const RECONCILIATION_REPORTS_COLLECTION = "paymentReconciliationReports";
const STALE_EXPIRATION_FALLBACK_MINUTES = 30;

const reconciliationLogger = logger.child({
  component: "payment-reconciliation-service",
});

export class PaymentReconciliationService {
  constructor(
    private readonly paymentAttemptRepo = paymentAttemptRepository,
    private readonly eventLogRepo = paymentEventLogRepository,
    private readonly finalizer = paymentFinalizerService,
    private readonly eventProcessor = paymentEventProcessingService,
  ) {}

  async reconcilePaymentAttempt(
    paymentAttemptId: string,
    requestedBy: string,
  ): Promise<PaymentAttempt> {
    const attempt = await this.paymentAttemptRepo.getById(paymentAttemptId);
    if (!attempt) {
      throw new PaymentApiError(
        404,
        "PAYMENT_ATTEMPT_NOT_FOUND",
        `PaymentAttempt ${paymentAttemptId} no encontrado`,
      );
    }

    if (attempt.provider !== ProveedorPago.APLAZO) {
      return attempt;
    }

    const providerStatus = await aplazoProvider.getStatus(attempt);
    const currentStatus =
      attempt.status ?? mapLegacyEstadoToPaymentStatus(attempt.estado);

    if (!canTransitionPaymentStatus(currentStatus, providerStatus.status)) {
      if (
        providerStatus.status === PaymentStatus.PAID &&
        (currentStatus === PaymentStatus.CANCELED ||
          currentStatus === PaymentStatus.EXPIRED ||
          currentStatus === PaymentStatus.FAILED)
      ) {
        return this.finalizer.recordLatePaidDivergence(
          attempt,
          providerStatus.providerStatus,
        );
      }

      return this.paymentAttemptRepo.update(paymentAttemptId, {
        metadata: {
          ...(attempt.metadata || {}),
          lastReconcileIgnoredTransition: `${currentStatus}->${providerStatus.status}`,
          lastReconcileAt: Timestamp.now(),
          lastReconcileBy: requestedBy,
        },
      });
    }

    if (
      providerStatus.status === PaymentStatus.PAID ||
      providerStatus.status === PaymentStatus.FAILED ||
      providerStatus.status === PaymentStatus.CANCELED ||
      providerStatus.status === PaymentStatus.EXPIRED
    ) {
      return this.finalizer.finalizeTerminalStatus(
        attempt,
        providerStatus.status,
        {
          source: "reconcile",
          requestedBy,
          providerResult: providerStatus,
        },
      );
    }

    return this.paymentAttemptRepo.update(paymentAttemptId, {
      status: providerStatus.status,
      providerStatus: providerStatus.providerStatus ?? attempt.providerStatus,
      providerPaymentId:
        providerStatus.providerPaymentId ?? attempt.providerPaymentId,
      providerLoanId:
        providerStatus.providerLoanId ?? attempt.providerLoanId,
      providerReference:
        providerStatus.providerReference ?? attempt.providerReference,
      paidAt: providerStatus.paidAt
        ? Timestamp.fromDate(providerStatus.paidAt)
        : attempt.paidAt,
      expiresAt: providerStatus.expiresAt
        ? Timestamp.fromDate(providerStatus.expiresAt)
        : attempt.expiresAt,
      metadata: {
        ...(attempt.metadata || {}),
        lastReconcileAt: Timestamp.now(),
        lastReconcileBy: requestedBy,
        lastStatusSyncAt: Timestamp.now(),
      },
    });
  }

  private async cancelExpiredAplazoAttempt(
    attempt: PaymentAttempt,
  ): Promise<PaymentAttempt> {
    if (!attempt.id) {
      throw new PaymentApiError(
        409,
        "PAYMENT_ATTEMPT_NOT_FOUND",
        "El intento Aplazo expirado no tiene identificador",
      );
    }

    const providerStatus = await aplazoProvider.getStatus(attempt);

    if (
      providerStatus.status === PaymentStatus.PAID ||
      providerStatus.status === PaymentStatus.FAILED ||
      providerStatus.status === PaymentStatus.CANCELED ||
      providerStatus.status === PaymentStatus.EXPIRED
    ) {
      return this.finalizer.finalizeTerminalStatus(
        attempt,
        providerStatus.status,
        {
          source: "reconcile",
          requestedBy: "scheduler-expiration-check",
          providerResult: providerStatus,
        },
      );
    }

    if (providerStatus.status !== PaymentStatus.PENDING_CUSTOMER) {
      return this.paymentAttemptRepo.update(attempt.id, {
        status: providerStatus.status,
        providerStatus: providerStatus.providerStatus ?? attempt.providerStatus,
        providerPaymentId:
          providerStatus.providerPaymentId ?? attempt.providerPaymentId,
        providerLoanId:
          providerStatus.providerLoanId ?? attempt.providerLoanId,
        providerReference:
          providerStatus.providerReference ?? attempt.providerReference,
        metadata: {
          ...(attempt.metadata || {}),
          lastExpirationCancelSkippedAt: Timestamp.now(),
          lastExpirationCancelSkippedStatus: providerStatus.status,
          ...(providerStatus.providerStatus
            ? {
                lastExpirationCancelSkippedProviderStatus:
                  providerStatus.providerStatus,
              }
            : {}),
        },
      });
    }

    const cancelResult = await aplazoProvider.cancelOrVoid({
      paymentAttempt: {
        ...attempt,
        providerPaymentId:
          providerStatus.providerPaymentId ?? attempt.providerPaymentId,
        providerLoanId: providerStatus.providerLoanId ?? attempt.providerLoanId,
        providerReference:
          providerStatus.providerReference ?? attempt.providerReference,
        providerStatus: providerStatus.providerStatus ?? attempt.providerStatus,
      },
      reason: "expired_by_timeout",
    });

    if (
      cancelResult.status === PaymentStatus.CANCELED ||
      cancelResult.status === PaymentStatus.REFUNDED
    ) {
      return this.finalizer.finalizeTerminalStatus(
        attempt,
        PaymentStatus.CANCELED,
        {
          source: "timeout",
          requestedBy: "scheduler",
          cancelReason: "expired_by_timeout",
          providerResult: cancelResult,
        },
      );
    }

    return this.paymentAttemptRepo.update(attempt.id, {
      status: cancelResult.status,
      providerStatus: cancelResult.providerStatus ?? attempt.providerStatus,
      providerPaymentId:
        cancelResult.providerPaymentId ?? attempt.providerPaymentId,
      providerLoanId: cancelResult.providerLoanId ?? attempt.providerLoanId,
      providerReference:
        cancelResult.providerReference ?? attempt.providerReference,
      metadata: {
        ...(attempt.metadata || {}),
        lastExpirationCancelAttemptAt: Timestamp.now(),
        lastExpirationCancelResultStatus: cancelResult.status,
        ...(cancelResult.providerStatus
          ? {
              lastExpirationCancelResultProviderStatus:
                cancelResult.providerStatus,
            }
          : {}),
        ...(cancelResult.rawResponseSanitized
          ? {
              lastExpirationCancelProviderResponse:
                cancelResult.rawResponseSanitized,
            }
          : {}),
      },
    });
  }

  async runScheduledReconciliation(): Promise<{
    processedAttempts: number;
    processedEvents: number;
    failedAttempts: number;
  }> {
    const config = getAplazoConfig();
    if (!config.enabled || !config.reconcileEnabled) {
      reconciliationLogger.info("payment_reconciliation_skipped_disabled");
      return {
        processedAttempts: 0,
        processedEvents: 0,
        failedAttempts: 0,
      };
    }

    let processedAttempts = 0;
    let processedEvents = 0;
    let failedAttempts = 0;

    const pendingEvents = await this.eventLogRepo.listPendingMatch(50);
    for (const pendingEvent of pendingEvents) {
      try {
        await this.eventProcessor.processQueuedEvent(pendingEvent.id!);
        processedEvents += 1;
      } catch (error) {
        failedAttempts += 1;
        reconciliationLogger.warn("payment_pending_match_reconcile_failed", {
          paymentEventLogId: pendingEvent.id,
          errorMessage: error instanceof Error ? error.message : "Error desconocido",
        });
      }
    }

    const candidates = await this.paymentAttemptRepo.listReconciliationCandidates(50);
    for (const candidate of candidates) {
      if (!candidate.id || candidate.provider !== ProveedorPago.APLAZO) {
        continue;
      }

      try {
        const effectiveExpiration = candidate.expiresAt
          ? candidate.expiresAt.toDate()
          : new Date(
              candidate.createdAt.toDate().getTime() +
                STALE_EXPIRATION_FALLBACK_MINUTES * 60 * 1000,
            );

        if (effectiveExpiration.getTime() <= Date.now()) {
          await this.cancelExpiredAplazoAttempt(candidate);
        } else {
          await this.reconcilePaymentAttempt(candidate.id, "scheduler");
        }

        processedAttempts += 1;
      } catch (error) {
        failedAttempts += 1;
        reconciliationLogger.warn("payment_attempt_reconcile_failed", {
          paymentAttemptId: candidate.id,
          errorMessage: error instanceof Error ? error.message : "Error desconocido",
        });
      }
    }

    await firestoreTienda.collection(RECONCILIATION_REPORTS_COLLECTION).add({
      provider: ProveedorPago.APLAZO,
      processedAttempts,
      processedEvents,
      failedAttempts,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
      mode: "scheduled",
    });

    return {
      processedAttempts,
      processedEvents,
      failedAttempts,
    };
  }
}

export const paymentReconciliationService = new PaymentReconciliationService();
export default paymentReconciliationService;
