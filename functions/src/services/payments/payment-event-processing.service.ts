import logger from "../../utils/logger";
import { canTransitionPaymentStatus } from "./payment-state-machine";
import {
  PaymentAttempt,
  PaymentEventLogRecord,
} from "./payment-domain.types";
import paymentAttemptRepository, {
  mapLegacyEstadoToPaymentStatus,
} from "./payment-attempt.repository";
import paymentEventLogRepository from "./payment-event-log.repository";
import paymentFinalizerService from "./payment-finalizer.service";
import { PaymentStatus } from "./payment-status.enum";
import { PaymentApiError } from "./payment-api-error";

const ORPHAN_EVENT_TTL_MS = 30 * 60 * 1000;

const eventProcessorLogger = logger.child({
  component: "payment-event-processing-service",
});

export class PaymentEventProcessingService {
  constructor(
    private readonly eventLogRepo = paymentEventLogRepository,
    private readonly paymentAttemptRepo = paymentAttemptRepository,
    private readonly finalizer = paymentFinalizerService,
  ) {}

  async processQueuedEvent(eventLogId: string): Promise<void> {
    const processingRecord = await this.eventLogRepo.markProcessing(eventLogId);
    if (!processingRecord) {
      return;
    }

    if (
      processingRecord.status === "processed" ||
      processingRecord.status === "duplicate"
    ) {
      return;
    }

    try {
      const attempt = await this.resolvePaymentAttempt(processingRecord);
      if (!attempt) {
        await this.handleOrphanEvent(processingRecord);
        return;
      }

      await this.assertAmountAndCurrencyMatch(processingRecord, attempt);

      const currentStatus =
        attempt.status ?? mapLegacyEstadoToPaymentStatus(attempt.estado);
      const targetStatus = processingRecord.mappedStatus;

      if (!targetStatus) {
        await this.eventLogRepo.markStatus(processingRecord.id!, "processed", {
          paymentAttemptId: attempt.id,
        });
        return;
      }

      if (!canTransitionPaymentStatus(currentStatus, targetStatus)) {
        if (
          targetStatus === PaymentStatus.PAID &&
          (currentStatus === PaymentStatus.CANCELED ||
            currentStatus === PaymentStatus.EXPIRED ||
            currentStatus === PaymentStatus.FAILED)
        ) {
          await this.finalizer.recordLatePaidDivergence(
            attempt,
            processingRecord.payloadSanitized.status as string | undefined,
            processingRecord.eventId,
          );
          await this.eventLogRepo.markStatus(processingRecord.id!, "processed", {
            paymentAttemptId: attempt.id,
            errorMessage:
              "Late paid recibido después de liberar la orden; requiere revisión manual",
          });
          return;
        }

        await this.eventLogRepo.markStatus(processingRecord.id!, "duplicate", {
          paymentAttemptId: attempt.id,
          errorMessage: `Transición ignorada ${currentStatus} -> ${targetStatus}`,
        });
        return;
      }

      const providerResult = {
        status: targetStatus,
        providerStatus: processingRecord.payloadSanitized.status as
          | string
          | undefined,
        providerPaymentId:
          processingRecord.providerPaymentId ?? attempt.providerPaymentId,
        providerLoanId:
          processingRecord.providerLoanId ?? attempt.providerLoanId,
        providerReference:
          processingRecord.providerReference ?? attempt.providerReference,
        paidAt:
          typeof processingRecord.payloadSanitized.paidAt === "string"
            ? new Date(processingRecord.payloadSanitized.paidAt)
            : undefined,
        expiresAt:
          typeof processingRecord.payloadSanitized.expiresAt === "string"
            ? new Date(processingRecord.payloadSanitized.expiresAt)
            : undefined,
      };

      if (
        targetStatus === PaymentStatus.PAID ||
        targetStatus === PaymentStatus.FAILED ||
        targetStatus === PaymentStatus.CANCELED ||
        targetStatus === PaymentStatus.EXPIRED
      ) {
        const finalized = await this.finalizer.finalizeTerminalStatus(
          attempt,
          targetStatus,
          {
            source: "webhook",
            requestedBy: "aplazo-webhook",
            providerResult,
            webhookPayloadSanitized: processingRecord.payloadSanitized,
            eventId: processingRecord.eventId,
          },
        );

        await this.eventLogRepo.markStatus(processingRecord.id!, "processed", {
          paymentAttemptId: finalized.id,
        });
        return;
      }

      await this.paymentAttemptRepo.update(attempt.id!, {
        status: targetStatus,
        providerStatus:
          providerResult.providerStatus ?? attempt.providerStatus,
        providerPaymentId:
          providerResult.providerPaymentId ?? attempt.providerPaymentId,
        providerLoanId:
          providerResult.providerLoanId ?? attempt.providerLoanId,
        providerReference:
          providerResult.providerReference ?? attempt.providerReference,
        rawLastWebhookSanitized: processingRecord.payloadSanitized,
      });

      await this.eventLogRepo.markStatus(processingRecord.id!, "processed", {
        paymentAttemptId: attempt.id,
      });
    } catch (error) {
      eventProcessorLogger.error("payment_event_processing_failed", {
        paymentEventLogId: eventLogId,
        errorMessage: error instanceof Error ? error.message : "Error desconocido",
      });
      await this.eventLogRepo.markStatus(eventLogId, "failed", {
        errorMessage: error instanceof Error ? error.message : "Error desconocido",
      });
    }
  }

  private async resolvePaymentAttempt(
    record: PaymentEventLogRecord,
  ): Promise<PaymentAttempt | null> {
    if (record.paymentAttemptId) {
      const direct = await this.paymentAttemptRepo.getById(record.paymentAttemptId);
      if (direct) {
        return direct;
      }
    }

    const byProviderIdentifiers = await this.paymentAttemptRepo.findByProviderIdentifiers({
      provider: record.provider,
      providerPaymentId: record.providerPaymentId,
      providerLoanId: record.providerLoanId,
      providerReference: record.providerReference,
    });

    if (byProviderIdentifiers && record.id) {
      await this.eventLogRepo.markStatus(record.id, "processing", {
        paymentAttemptId: byProviderIdentifiers.id,
      });
    }

    return byProviderIdentifiers;
  }

  private async handleOrphanEvent(record: PaymentEventLogRecord): Promise<void> {
    const createdAt =
      typeof record.createdAt?.toDate === "function"
        ? record.createdAt.toDate()
        : new Date();
    const isExpired = Date.now() - createdAt.getTime() >= ORPHAN_EVENT_TTL_MS;

    await this.eventLogRepo.markStatus(
      record.id!,
      isExpired ? "orphaned" : "pending_match",
      {
        errorMessage: isExpired
          ? "No se pudo vincular el webhook con un PaymentAttempt dentro del TTL"
          : "Webhook recibido antes de persistir el PaymentAttempt; se reintentará match",
      },
    );
  }

  private async assertAmountAndCurrencyMatch(
    record: PaymentEventLogRecord,
    attempt: PaymentAttempt,
  ): Promise<void> {
    if (
      typeof record.amountMinor === "number" &&
      typeof attempt.amountMinor === "number" &&
      record.amountMinor !== attempt.amountMinor
    ) {
      throw new PaymentApiError(
        409,
        "PAYMENT_AMOUNT_MISMATCH",
        "El monto del webhook no coincide con el snapshot esperado",
      );
    }

    if (
      record.currency &&
      attempt.currency &&
      record.currency.toLowerCase() !== attempt.currency.toLowerCase()
    ) {
      throw new PaymentApiError(
        409,
        "PAYMENT_AMOUNT_MISMATCH",
        "La moneda del webhook no coincide con la moneda interna",
      );
    }
  }
}

export const paymentEventProcessingService = new PaymentEventProcessingService();
export default paymentEventProcessingService;
