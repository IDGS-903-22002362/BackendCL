import { Timestamp } from "firebase-admin/firestore";
import { firestoreTienda } from "../../config/firebase";
import {
  COLECCION_PAGOS,
  EstadoPago,
  Pago,
  PaymentFinalizationState,
  PaymentStatus,
  ProveedorPago,
} from "../../models/pago.model";
import logger from "../../utils/logger";
import {
  CreatePaymentAttemptInput,
  PaymentAttempt,
} from "./payment-domain.types";

const paymentAttemptLogger = logger.child({
  component: "payment-attempt-repository",
});

const fallbackLegacyStatus = (status: PaymentStatus): EstadoPago => {
  switch (status) {
    case PaymentStatus.PAID:
      return EstadoPago.COMPLETADO;
    case PaymentStatus.FAILED:
    case PaymentStatus.CANCELED:
    case PaymentStatus.EXPIRED:
      return EstadoPago.FALLIDO;
    case PaymentStatus.AUTHORIZED:
      return EstadoPago.REQUIERE_ACCION;
    case PaymentStatus.REFUNDED:
    case PaymentStatus.PARTIALLY_REFUNDED:
      return EstadoPago.REEMBOLSADO;
    case PaymentStatus.PENDING_PROVIDER:
      return EstadoPago.PROCESANDO;
    case PaymentStatus.CREATED:
    case PaymentStatus.PENDING_CUSTOMER:
    default:
      return EstadoPago.PENDIENTE;
  }
};

export const mapLegacyEstadoToPaymentStatus = (
  estado?: EstadoPago,
): PaymentStatus => {
  switch (estado) {
    case EstadoPago.COMPLETADO:
      return PaymentStatus.PAID;
    case EstadoPago.FALLIDO:
      return PaymentStatus.FAILED;
    case EstadoPago.REEMBOLSADO:
      return PaymentStatus.REFUNDED;
    case EstadoPago.REQUIERE_ACCION:
      return PaymentStatus.AUTHORIZED;
    case EstadoPago.PROCESANDO:
      return PaymentStatus.PENDING_PROVIDER;
    case EstadoPago.PENDIENTE:
    default:
      return PaymentStatus.PENDING_CUSTOMER;
  }
};

const toPaymentAttempt = (id: string, data: Pago): PaymentAttempt => {
  const normalizedStatus = data.status ?? mapLegacyEstadoToPaymentStatus(data.estado);
  return {
    id,
    ...data,
    status: normalizedStatus,
    estado: data.estado ?? fallbackLegacyStatus(normalizedStatus),
  };
};

export class PaymentAttemptRepository {
  private readonly collection = firestoreTienda.collection(COLECCION_PAGOS);

  async create(input: CreatePaymentAttemptInput): Promise<PaymentAttempt> {
    const now = Timestamp.now();
    const status = input.status ?? PaymentStatus.CREATED;
    const estado = input.estado ?? fallbackLegacyStatus(status);
    const draft: Omit<Pago, "id"> = {
      ordenId: input.ordenId ?? "",
      ventaPosId: input.ventaPosId,
      userId: input.userId,
      customerId: input.customerId,
      customerName: input.customerName,
      customerEmail: input.customerEmail,
      customerPhone: input.customerPhone,
      provider: input.provider,
      flowType: input.flowType,
      paymentMethodCode: input.paymentMethodCode,
      metodoPago: input.metodoPago,
      monto: input.amount,
      amountMinor: input.amountMinor,
      currency: input.currency,
      estado,
      status,
      idempotencyKey: input.idempotencyKey,
      successUrl: input.successUrl,
      cancelUrl: input.cancelUrl,
      failureUrl: input.failureUrl,
      webhookUrl: input.webhookUrl,
      expiresAt: input.expiresAt,
      metadata: input.metadata,
      posSessionId: input.posSessionId,
      deviceId: input.deviceId,
      redirectUrl: input.redirectUrl,
      providerStatus: input.providerStatus,
      providerLoanId: input.providerLoanId,
      providerReference: input.providerReference,
      pricingSnapshot: input.pricingSnapshot,
      rawCreateRequestSanitized: input.rawCreateRequestSanitized,
      rawCreateResponseSanitized: input.rawCreateResponseSanitized,
      createdAt: now,
      updatedAt: now,
      finalization: {
        inProgress: false,
        updatedAt: now,
      },
    };

    const docRef = await this.collection.add(draft);
    return toPaymentAttempt(docRef.id, draft);
  }

  async getById(id: string): Promise<PaymentAttempt | null> {
    const snapshot = await this.collection.doc(id).get();
    if (!snapshot.exists) {
      return null;
    }

    return toPaymentAttempt(snapshot.id, snapshot.data() as Pago);
  }

  async findByIdempotencyKey(
    provider: ProveedorPago,
    idempotencyKey: string,
  ): Promise<PaymentAttempt | null> {
    const snapshot = await this.collection
      .where("provider", "==", provider)
      .where("idempotencyKey", "==", idempotencyKey)
      .limit(1)
      .get();

    if (snapshot.empty) {
      return null;
    }

    return toPaymentAttempt(snapshot.docs[0].id, snapshot.docs[0].data() as Pago);
  }

  async findLatestByOrderAndFlow(
    provider: ProveedorPago,
    orderId: string,
    flowType: PaymentAttempt["flowType"],
  ): Promise<PaymentAttempt | null> {
    const snapshot = await this.collection
      .where("ordenId", "==", orderId)
      .orderBy("createdAt", "desc")
      .limit(10)
      .get();
    const candidate = snapshot.docs
      .map((doc) => toPaymentAttempt(doc.id, doc.data() as Pago))
      .find(
        (attempt) => attempt.provider === provider && attempt.flowType === flowType,
      );

    return candidate || null;
  }

  async findLatestByVentaPosAndFlow(
    provider: ProveedorPago,
    ventaPosId: string,
    flowType: PaymentAttempt["flowType"],
  ): Promise<PaymentAttempt | null> {
    const snapshot = await this.collection
      .where("ventaPosId", "==", ventaPosId)
      .limit(10)
      .get();
    const candidates = snapshot.docs
      .map((doc) => toPaymentAttempt(doc.id, doc.data() as Pago))
      .filter(
        (attempt) =>
          attempt.provider === provider && attempt.flowType === flowType,
      )
      .sort((left, right) => {
        const leftDate =
          typeof left.createdAt?.toDate === "function"
            ? left.createdAt.toDate().getTime()
            : 0;
        const rightDate =
          typeof right.createdAt?.toDate === "function"
            ? right.createdAt.toDate().getTime()
            : 0;

        return rightDate - leftDate;
      });

    return candidates[0] || null;
  }

  async findByProviderIdentifiers(input: {
    provider: ProveedorPago;
    providerPaymentId?: string;
    providerLoanId?: string;
    providerReference?: string;
  }): Promise<PaymentAttempt | null> {
    if (input.providerLoanId) {
      const byLoanId = await this.collection
        .where("provider", "==", input.provider)
        .where("providerLoanId", "==", input.providerLoanId)
        .limit(1)
        .get();

      if (!byLoanId.empty) {
        return toPaymentAttempt(
          byLoanId.docs[0].id,
          byLoanId.docs[0].data() as Pago,
        );
      }
    }

    if (input.providerPaymentId) {
      const byPaymentId = await this.collection
        .where("provider", "==", input.provider)
        .where("providerPaymentId", "==", input.providerPaymentId)
        .limit(1)
        .get();

      if (!byPaymentId.empty) {
        return toPaymentAttempt(
          byPaymentId.docs[0].id,
          byPaymentId.docs[0].data() as Pago,
        );
      }
    }

    if (input.providerReference) {
      const byReference = await this.collection
        .where("provider", "==", input.provider)
        .where("providerReference", "==", input.providerReference)
        .limit(1)
        .get();

      if (!byReference.empty) {
        return toPaymentAttempt(
          byReference.docs[0].id,
          byReference.docs[0].data() as Pago,
        );
      }
    }

    return null;
  }

  async listReconciliationCandidates(limit = 50): Promise<PaymentAttempt[]> {
    const statuses = [
      PaymentStatus.PENDING_PROVIDER,
      PaymentStatus.PENDING_CUSTOMER,
      PaymentStatus.AUTHORIZED,
    ];
    const snapshot = await this.collection
      .where("status", "in", statuses)
      .orderBy("createdAt", "asc")
      .limit(limit)
      .get();

    return snapshot.docs.map((doc) =>
      toPaymentAttempt(doc.id, doc.data() as Pago),
    );
  }

  async update(
    id: string,
    patch: Partial<PaymentAttempt>,
  ): Promise<PaymentAttempt> {
    const updatePatch: Record<string, unknown> = {
      ...patch,
      updatedAt: Timestamp.now(),
    };

    if (patch.status) {
      updatePatch.estado = patch.estado ?? fallbackLegacyStatus(patch.status);
    }

    await this.collection.doc(id).set(updatePatch, { merge: true });
    const refreshed = await this.getById(id);
    if (!refreshed) {
      throw new Error(`No se pudo refrescar el paymentAttempt ${id}`);
    }

    return refreshed;
  }

  async tryStartFinalization(
    id: string,
    operationId: string,
    terminalStatus: PaymentStatus,
  ): Promise<{ acquired: boolean; attempt: PaymentAttempt }> {
    const docRef = this.collection.doc(id);
    let acquired = false;
    let capturedAttempt: PaymentAttempt | null = null;

    await firestoreTienda.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(docRef);
      if (!snapshot.exists) {
        throw new Error(`PaymentAttempt ${id} no encontrado`);
      }

      const attempt = toPaymentAttempt(snapshot.id, snapshot.data() as Pago);
      const finalization = (attempt.finalization ?? {}) as PaymentFinalizationState;
      capturedAttempt = attempt;

      if (finalization.finalizedAt) {
        return;
      }

      if (
        finalization.inProgress &&
        finalization.operationId &&
        finalization.operationId !== operationId
      ) {
        return;
      }

      acquired = true;
      transaction.set(
        docRef,
        {
          status: terminalStatus,
          estado: fallbackLegacyStatus(terminalStatus),
          finalization: {
            inProgress: true,
            operationId,
            lastTerminalStatus: terminalStatus,
            updatedAt: Timestamp.now(),
          },
          updatedAt: Timestamp.now(),
        },
        { merge: true },
      );
    });

    if (!capturedAttempt) {
      throw new Error(`No se pudo capturar paymentAttempt ${id}`);
    }

    const refreshed = await this.getById(id);
    if (!refreshed) {
      throw new Error(`No se pudo refrescar paymentAttempt ${id}`);
    }

    return {
      acquired,
      attempt: refreshed,
    };
  }

  async finalize(
    id: string,
    operationId: string,
    patch: Partial<PaymentAttempt>,
  ): Promise<PaymentAttempt> {
    const finalizationPatch: PaymentFinalizationState = {
      inProgress: false,
      operationId,
      finalizedAt: Timestamp.now(),
      lastTerminalStatus: patch.status,
      updatedAt: Timestamp.now(),
    };

    return this.update(id, {
      ...patch,
      finalization: finalizationPatch,
    });
  }

  async markFinalizationError(
    id: string,
    operationId: string,
    errorMessage: string,
  ): Promise<void> {
    paymentAttemptLogger.error("payment_finalization_error", {
      paymentAttemptId: id,
      operationId,
      errorMessage,
    });

    await this.collection.doc(id).set(
      {
        finalization: {
          inProgress: false,
          operationId,
          lastError: errorMessage,
          updatedAt: Timestamp.now(),
        },
        updatedAt: Timestamp.now(),
      },
      { merge: true },
    );
  }

  async listPendingMatchEvents(limit = 50): Promise<PaymentAttempt[]> {
    const snapshot = await this.collection
      .where("status", "==", PaymentStatus.PENDING_PROVIDER)
      .orderBy("createdAt", "asc")
      .limit(limit)
      .get();

    return snapshot.docs.map((doc) =>
      toPaymentAttempt(doc.id, doc.data() as Pago),
    );
  }

  buildOperationId(id: string, suffix: string): string {
    return Buffer.from(`${id}:${suffix}`).toString("base64url");
  }
}

export const paymentAttemptRepository = new PaymentAttemptRepository();
export default paymentAttemptRepository;
