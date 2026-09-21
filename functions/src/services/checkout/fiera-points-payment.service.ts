import { firestoreTienda } from "../../config/firebase";
import { ConfiguracionPuntos } from "../../models/configuracion.model";
import {
  FieraPointsQuote,
  FieraPointsQuoteReason,
  FieraPointsRequest,
  PaymentComposition,
} from "../../models/checkout-pricing.model";
import LoyaltyProblemError from "../../modules/loyalty/errors/loyalty-problem.error";
import { LoyaltyActorType } from "../../modules/loyalty/models/loyalty.enums";
import loyaltyFeatureFlagsService from "../../modules/loyalty/services/loyalty-feature-flags.service";
import loyaltyEngineService from "../../modules/loyalty/services/loyalty-engine.service";
import { ApiError } from "../../utils/error-handler";

const SYSTEM_ACTOR = {
  actorType: LoyaltyActorType.SERVICE,
  actorId: "checkout-fiera-points",
  roles: ["SERVICE"],
  permissions: [] as string[],
};

/** TTL de hold solo para checkout (alineado a Stripe Checkout Session). */
export const CHECKOUT_REDEMPTION_HOLD_TTL_MS = 24 * 60 * 60 * 1000;

function asPositiveInteger(value: unknown): number {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function minorToPesos(minor: number): number {
  return Math.round(minor) / 100;
}

export function emptyPaymentComposition(grossTotal: number): PaymentComposition {
  const grossTotalMinor = Math.max(0, Math.round(grossTotal * 100));
  return {
    mode: "NONE",
    grossTotalMinor,
    providerAmountMinor: grossTotalMinor,
    pointsRequested: 0,
    pointsUsed: 0,
    pointValueMinor: 0,
    pointsDiscountMinor: 0,
    minimumRedemptionPoints: 0,
    redemptionStatus: "NOT_REQUESTED",
  };
}

function buildQuote(input: {
  reason: FieraPointsQuoteReason;
  canRedeem: boolean;
  availablePoints: number;
  pointValueMinor: number;
  minimumRedemptionPoints: number;
  paymentComposition: PaymentComposition;
}): FieraPointsQuote {
  return {
    canRedeem: input.canRedeem,
    reason: input.reason,
    availablePoints: input.availablePoints,
    pointValueMinor: input.pointValueMinor,
    minimumRedemptionPoints: input.minimumRedemptionPoints,
    grossTotal: minorToPesos(input.paymentComposition.grossTotalMinor),
    providerAmount: minorToPesos(input.paymentComposition.providerAmountMinor),
    paymentComposition: input.paymentComposition,
  };
}

export function quotePaymentComposition(input: {
  request: FieraPointsRequest;
  grossTotal: number;
  availablePoints: number;
  config?: ConfiguracionPuntos | null;
  redemptionsEnabled?: boolean;
}): FieraPointsQuote {
  const request = input.request ?? { mode: "NONE" as const };
  const grossTotalMinor = Math.max(0, Math.round(input.grossTotal * 100));
  const availablePoints = Math.max(0, Math.trunc(input.availablePoints));
  const empty = emptyPaymentComposition(input.grossTotal);
  const config = input.config;
  const configuredValuePesos = Number(config?.valorPuntoEnPesos);
  const pointValueMinor = config
    ? Math.round(
        (Number.isFinite(configuredValuePesos) ? configuredValuePesos : 0) *
          100,
      )
    : 0;
  const minimumRedemptionPoints = config
    ? asPositiveInteger(config.puntosMinimoCanje)
    : 0;

  if (!config || !config.activo || input.redemptionsEnabled === false) {
    return buildQuote({
      reason: "DISABLED",
      canRedeem: false,
      availablePoints,
      pointValueMinor,
      minimumRedemptionPoints,
      paymentComposition: empty,
    });
  }

  if (grossTotalMinor <= 0 || pointValueMinor <= 0) {
    return buildQuote({
      reason: "INVALID_CONFIG",
      canRedeem: false,
      availablePoints,
      pointValueMinor,
      minimumRedemptionPoints,
      paymentComposition: empty,
    });
  }

  if (request.mode === "NONE") {
    return buildQuote({
      reason: "NONE",
      canRedeem: false,
      availablePoints,
      pointValueMinor,
      minimumRedemptionPoints,
      paymentComposition: {
        ...empty,
        pointValueMinor,
        minimumRedemptionPoints,
      },
    });
  }

  const maximumForOrder = Math.floor(grossTotalMinor / pointValueMinor);
  const pointsRequested =
    request.mode === "EXACT"
      ? asPositiveInteger(request.points)
      : Math.min(availablePoints, maximumForOrder);

  if (request.mode === "EXACT" && pointsRequested !== request.points) {
    return buildQuote({
      reason: "INVALID_AMOUNT",
      canRedeem: false,
      availablePoints,
      pointValueMinor,
      minimumRedemptionPoints,
      paymentComposition: {
        ...empty,
        mode: request.mode,
        pointsRequested: asPositiveInteger(request.points),
        pointValueMinor,
        minimumRedemptionPoints,
      },
    });
  }
  if (pointsRequested < minimumRedemptionPoints) {
    return buildQuote({
      reason: "MIN_NOT_MET",
      canRedeem: false,
      availablePoints,
      pointValueMinor,
      minimumRedemptionPoints,
      paymentComposition: {
        ...empty,
        mode: request.mode,
        pointsRequested,
        pointValueMinor,
        minimumRedemptionPoints,
      },
    });
  }
  if (pointsRequested > availablePoints) {
    return buildQuote({
      reason: "INSUFFICIENT",
      canRedeem: false,
      availablePoints,
      pointValueMinor,
      minimumRedemptionPoints,
      paymentComposition: {
        ...empty,
        mode: request.mode,
        pointsRequested,
        pointValueMinor,
        minimumRedemptionPoints,
      },
    });
  }
  if (pointsRequested > maximumForOrder) {
    return buildQuote({
      reason: "EXCEEDS_TOTAL",
      canRedeem: false,
      availablePoints,
      pointValueMinor,
      minimumRedemptionPoints,
      paymentComposition: {
        ...empty,
        mode: request.mode,
        pointsRequested,
        pointValueMinor,
        minimumRedemptionPoints,
      },
    });
  }

  const pointsDiscountMinor = Math.min(
    grossTotalMinor,
    pointsRequested * pointValueMinor,
  );
  const composition: PaymentComposition = {
    mode: request.mode,
    grossTotalMinor,
    providerAmountMinor: grossTotalMinor - pointsDiscountMinor,
    pointsRequested,
    pointsUsed: pointsRequested,
    pointValueMinor,
    pointsDiscountMinor,
    minimumRedemptionPoints,
    redemptionStatus: "NOT_REQUESTED",
  };

  return buildQuote({
    reason: "OK",
    canRedeem: true,
    availablePoints,
    pointValueMinor,
    minimumRedemptionPoints,
    paymentComposition: composition,
  });
}

export function calculatePaymentComposition(input: {
  request: FieraPointsRequest;
  grossTotal: number;
  availablePoints: number;
  config: ConfiguracionPuntos;
}): PaymentComposition {
  const quote = quotePaymentComposition({
    ...input,
    redemptionsEnabled: true,
  });

  if (quote.reason === "DISABLED") {
    throw new ApiError(503, "El canje de FieraPuntos no está disponible");
  }
  if (quote.reason === "INVALID_CONFIG") {
    throw new ApiError(409, "La configuración de FieraPuntos no es válida");
  }
  if (quote.reason === "INVALID_AMOUNT") {
    throw new ApiError(400, "La cantidad de FieraPuntos no es válida");
  }
  if (quote.reason === "MIN_NOT_MET") {
    throw new ApiError(
      409,
      `El canje mínimo es de ${quote.minimumRedemptionPoints} FieraPuntos`,
      true,
      "FIERA_POINTS_MIN_NOT_MET",
    );
  }
  if (quote.reason === "INSUFFICIENT") {
    throw new ApiError(
      409,
      "No tienes FieraPuntos suficientes",
      true,
      "INSUFFICIENT_POINTS",
    );
  }
  if (quote.reason === "EXCEEDS_TOTAL") {
    throw new ApiError(
      409,
      "La cantidad de FieraPuntos excede el total de la compra",
      true,
      "FIERA_POINTS_EXCEEDS_TOTAL",
    );
  }

  return {
    ...quote.paymentComposition,
    redemptionStatus: "PENDING",
  };
}

export function isExpiredRedemptionError(error: unknown): boolean {
  if (error instanceof LoyaltyProblemError) {
    return error.code === "REDEMPTION_EXPIRED";
  }
  return error instanceof ApiError && error.code === "REDEMPTION_EXPIRED";
}

export function mapLoyaltyError(error: unknown): never {
  if (error instanceof LoyaltyProblemError) {
    const status = error.code === "INSUFFICIENT_POINTS" ? 409 : error.status;
    throw new ApiError(status, error.message, true, error.code);
  }
  // La transacción del monedero lanza un Error plano cuando el saldo cambió
  // entre la cotización y la reserva; sin este mapeo la carrera termina en 500.
  if (error instanceof Error && error.message === "INSUFFICIENT_POINTS") {
    throw new ApiError(
      409,
      "No tienes FieraPuntos suficientes",
      true,
      "INSUFFICIENT_POINTS",
    );
  }
  throw error;
}

export class FieraPointsPaymentService {
  async quoteForCheckout(input: {
    userId: string;
    grossTotal: number;
    request?: FieraPointsRequest;
  }): Promise<FieraPointsQuote> {
    const request = input.request ?? { mode: "NONE" as const };
    const [configSnap, flags, wallet] = await Promise.all([
      firestoreTienda.collection("configuracion").doc("puntos").get(),
      loyaltyFeatureFlagsService.getFlags(),
      loyaltyEngineService.getWallet(input.userId).catch((error) => {
        if (
          error instanceof LoyaltyProblemError &&
          error.code === "MEMBER_NOT_FOUND"
        ) {
          return { availablePoints: 0 };
        }
        throw error;
      }),
    ]);

    return quotePaymentComposition({
      request,
      grossTotal: input.grossTotal,
      availablePoints: wallet.availablePoints,
      config: configSnap.exists
        ? (configSnap.data() as ConfiguracionPuntos)
        : null,
      redemptionsEnabled: flags.loyaltyRedemptionsEnabled,
    });
  }

  async reserveForCheckout(input: {
    checkoutAttemptId: string;
    userId: string;
    grossTotal: number;
    request?: FieraPointsRequest;
    idempotencyKey?: string;
    holdTtlMs?: number;
  }): Promise<PaymentComposition> {
    const request = input.request ?? { mode: "NONE" as const };
    if (request.mode === "NONE") {
      return emptyPaymentComposition(input.grossTotal);
    }

    const [configSnap, wallet] = await Promise.all([
      firestoreTienda.collection("configuracion").doc("puntos").get(),
      loyaltyEngineService.getWallet(input.userId),
    ]);
    if (!configSnap.exists) {
      throw new ApiError(503, "No existe configuración de FieraPuntos");
    }

    const composition = calculatePaymentComposition({
      request,
      grossTotal: input.grossTotal,
      availablePoints: wallet.availablePoints,
      config: configSnap.data() as ConfiguracionPuntos,
    });

    try {
      const result = await loyaltyEngineService.createRedemption({
        memberId: input.userId,
        points: composition.pointsUsed,
        description: `Reserva para checkout ${input.checkoutAttemptId}`,
        externalReference: `checkout:${input.checkoutAttemptId}`,
        metadata: {
          checkoutAttemptId: input.checkoutAttemptId,
          grossTotalMinor: composition.grossTotalMinor,
          providerAmountMinor: composition.providerAmountMinor,
          pointValueMinor: composition.pointValueMinor,
        },
        idempotencyKey:
          input.idempotencyKey ?? `checkout:${input.checkoutAttemptId}:hold`,
        holdTtlMs: input.holdTtlMs ?? CHECKOUT_REDEMPTION_HOLD_TTL_MS,
        actor: SYSTEM_ACTOR,
      });
      return {
        ...composition,
        redemptionId: result.redemption.redemptionId,
        redemptionStatus: "PENDING",
      };
    } catch (error) {
      mapLoyaltyError(error);
    }
  }

  async confirmForCheckout(composition: PaymentComposition): Promise<void> {
    if (!composition.redemptionId || composition.pointsUsed <= 0) return;
    try {
      await loyaltyEngineService.confirmRedemption(
        composition.redemptionId,
        SYSTEM_ACTOR,
        `checkout:${composition.redemptionId}:confirm`,
      );
    } catch (error) {
      mapLoyaltyError(error);
    }
  }

  async confirmOrRereserveForCheckout(input: {
    composition: PaymentComposition;
    userId: string;
    checkoutAttemptId: string;
    grossTotal: number;
    request: FieraPointsRequest;
  }): Promise<PaymentComposition> {
    const { composition } = input;
    if (!composition.redemptionId || composition.pointsUsed <= 0) {
      return composition;
    }

    try {
      await this.confirmForCheckout(composition);
      return {
        ...composition,
        redemptionStatus: "CONFIRMED",
      };
    } catch (error) {
      if (!isExpiredRedemptionError(error)) {
        throw error;
      }

      const reserved = await this.reserveForCheckout({
        checkoutAttemptId: input.checkoutAttemptId,
        userId: input.userId,
        grossTotal: input.grossTotal,
        request: input.request,
        idempotencyKey: `checkout:${input.checkoutAttemptId}:rehold`,
        holdTtlMs: CHECKOUT_REDEMPTION_HOLD_TTL_MS,
      });
      await this.confirmForCheckout(reserved);
      return {
        ...reserved,
        redemptionStatus: "CONFIRMED",
      };
    }
  }

  async releaseForCheckout(composition?: PaymentComposition): Promise<void> {
    if (!composition?.redemptionId || composition.pointsUsed <= 0) return;
    try {
      await loyaltyEngineService.cancelRedemption(
        composition.redemptionId,
        SYSTEM_ACTOR,
        `checkout:${composition.redemptionId}:release`,
      );
    } catch (error) {
      if (
        error instanceof LoyaltyProblemError &&
        (error.code === "REDEMPTION_EXPIRED" ||
          error.code === "REDEMPTION_ALREADY_CONFIRMED")
      ) {
        return;
      }
      mapLoyaltyError(error);
    }
  }

  async restoreConfirmedRedemption(input: {
    redemptionId: string;
    orderId: string;
  }): Promise<void> {
    try {
      await loyaltyEngineService.refundConfirmedRedemption(
        input.redemptionId,
        SYSTEM_ACTOR,
        `refund:order:${input.orderId}:fiera-points`,
        `Restauración de FieraPuntos por reembolso total de orden ${input.orderId}`,
      );
    } catch (error) {
      mapLoyaltyError(error);
    }
  }
}

const fieraPointsPaymentService = new FieraPointsPaymentService();
export default fieraPointsPaymentService;
