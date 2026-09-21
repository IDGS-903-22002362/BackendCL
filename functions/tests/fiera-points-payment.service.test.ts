import { ApiError } from "../src/utils/error-handler";
import LoyaltyProblemError from "../src/modules/loyalty/errors/loyalty-problem.error";
import {
  calculatePaymentComposition,
  emptyPaymentComposition,
  isExpiredRedemptionError,
  mapLoyaltyError,
  quotePaymentComposition,
} from "../src/services/checkout/fiera-points-payment.service";

const config = {
  puntosPorPesoTienda: 0.1,
  puntosPorPesoComedor: 0.1,
  valorPuntoEnPesos: 0.1,
  puntosMinimoCanje: 100,
  activo: true,
};

describe("FieraPoints payment composition", () => {
  it("preserves the Stripe amount when points are not used", () => {
    expect(emptyPaymentComposition(399.99)).toMatchObject({
      mode: "NONE",
      grossTotalMinor: 39999,
      providerAmountMinor: 39999,
      pointsUsed: 0,
      pointsDiscountMinor: 0,
    });
  });

  it("uses an exact amount and leaves only the cash remainder", () => {
    expect(
      calculatePaymentComposition({
        request: { mode: "EXACT", points: 150 },
        grossTotal: 399,
        availablePoints: 500,
        config,
      }),
    ).toMatchObject({
      grossTotalMinor: 39900,
      providerAmountMinor: 38400,
      pointsUsed: 150,
      pointValueMinor: 10,
      pointsDiscountMinor: 1500,
      redemptionStatus: "PENDING",
    });
  });

  it("uses the maximum bounded by the backend total", () => {
    expect(
      calculatePaymentComposition({
        request: { mode: "MAX" },
        grossTotal: 25,
        availablePoints: 900,
        config,
      }),
    ).toMatchObject({
      providerAmountMinor: 0,
      pointsUsed: 250,
      pointsDiscountMinor: 2500,
    });
  });

  it("rejects redemption below the configured minimum", () => {
    expect(() =>
      calculatePaymentComposition({
        request: { mode: "EXACT", points: 99 },
        grossTotal: 250,
        availablePoints: 900,
        config,
      }),
    ).toThrow("El canje mínimo es de 100 FieraPuntos");
  });

  it("rejects points that would exceed the order", () => {
    expect(() =>
      calculatePaymentComposition({
        request: { mode: "EXACT", points: 2501 },
        grossTotal: 250,
        availablePoints: 3000,
        config,
      }),
    ).toThrow("excede el total");
  });

  it("rejects MAX when the available balance is below the minimum", () => {
    expect(() =>
      calculatePaymentComposition({
        request: { mode: "MAX" },
        grossTotal: 250,
        availablePoints: 40,
        config,
      }),
    ).toThrow("El canje mínimo es de 100 FieraPuntos");
  });
});

describe("FieraPoints quote preview", () => {
  it("returns NONE without reserving when points are not requested", () => {
    expect(
      quotePaymentComposition({
        request: { mode: "NONE" },
        grossTotal: 399,
        availablePoints: 500,
        config,
      }),
    ).toMatchObject({
      canRedeem: false,
      reason: "NONE",
      availablePoints: 500,
      pointValueMinor: 10,
      minimumRedemptionPoints: 100,
      grossTotal: 399,
      providerAmount: 399,
      paymentComposition: {
        pointsUsed: 0,
        providerAmountMinor: 39900,
        redemptionStatus: "NOT_REQUESTED",
      },
    });
  });

  it("quotes a hybrid exact redemption", () => {
    expect(
      quotePaymentComposition({
        request: { mode: "EXACT", points: 150 },
        grossTotal: 399,
        availablePoints: 500,
        config,
      }),
    ).toMatchObject({
      canRedeem: true,
      reason: "OK",
      providerAmount: 384,
      paymentComposition: {
        pointsUsed: 150,
        providerAmountMinor: 38400,
        pointsDiscountMinor: 1500,
        redemptionStatus: "NOT_REQUESTED",
      },
    });
  });

  it("quotes a 100% points MAX redemption", () => {
    expect(
      quotePaymentComposition({
        request: { mode: "MAX" },
        grossTotal: 25,
        availablePoints: 900,
        config,
      }),
    ).toMatchObject({
      canRedeem: true,
      reason: "OK",
      providerAmount: 0,
      paymentComposition: {
        pointsUsed: 250,
        providerAmountMinor: 0,
        pointsDiscountMinor: 2500,
      },
    });
  });

  it("does not throw when the exact amount is below the minimum", () => {
    expect(
      quotePaymentComposition({
        request: { mode: "EXACT", points: 99 },
        grossTotal: 250,
        availablePoints: 900,
        config,
      }),
    ).toMatchObject({
      canRedeem: false,
      reason: "MIN_NOT_MET",
      minimumRedemptionPoints: 100,
      providerAmount: 250,
    });
  });

  it("does not throw when MAX cannot reach the minimum", () => {
    expect(
      quotePaymentComposition({
        request: { mode: "MAX" },
        grossTotal: 250,
        availablePoints: 40,
        config,
      }),
    ).toMatchObject({
      canRedeem: false,
      reason: "MIN_NOT_MET",
      availablePoints: 40,
    });
  });

  it("reports insufficient balance without throwing", () => {
    expect(
      quotePaymentComposition({
        request: { mode: "EXACT", points: 200 },
        grossTotal: 250,
        availablePoints: 150,
        config,
      }),
    ).toMatchObject({
      canRedeem: false,
      reason: "INSUFFICIENT",
    });
  });

  it("reports when points exceed the order total", () => {
    expect(
      quotePaymentComposition({
        request: { mode: "EXACT", points: 2501 },
        grossTotal: 250,
        availablePoints: 3000,
        config,
      }),
    ).toMatchObject({
      canRedeem: false,
      reason: "EXCEEDS_TOTAL",
    });
  });

  it("marks the quote as disabled when config is inactive", () => {
    expect(
      quotePaymentComposition({
        request: { mode: "MAX" },
        grossTotal: 250,
        availablePoints: 500,
        config: { ...config, activo: false },
      }),
    ).toMatchObject({
      canRedeem: false,
      reason: "DISABLED",
    });
  });

  it("marks the quote as disabled when redemptions are flagged off", () => {
    expect(
      quotePaymentComposition({
        request: { mode: "MAX" },
        grossTotal: 250,
        availablePoints: 500,
        config,
        redemptionsEnabled: false,
      }),
    ).toMatchObject({
      canRedeem: false,
      reason: "DISABLED",
    });
  });
});

describe("FieraPoints expired redemption detection", () => {
  it("detects loyalty and API expired-redemption errors", () => {
    expect(isExpiredRedemptionError(new LoyaltyProblemError("REDEMPTION_EXPIRED"))).toBe(
      true,
    );
    expect(
      isExpiredRedemptionError(
        new ApiError(409, "El canje expiró", true, "REDEMPTION_EXPIRED"),
      ),
    ).toBe(true);
    expect(isExpiredRedemptionError(new ApiError(409, "Otro error"))).toBe(false);
  });
});

describe("FieraPoints loyalty error mapping", () => {
  const expectApiError = (error: unknown, status: number, code: string) => {
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ statusCode: status, code });
  };

  it("keeps a wallet race condition as a client conflict instead of a server error", () => {
    try {
      mapLoyaltyError(new Error("INSUFFICIENT_POINTS"));
      throw new Error("mapLoyaltyError should rethrow");
    } catch (error) {
      expectApiError(error, 409, "INSUFFICIENT_POINTS");
    }
  });

  it("maps loyalty problems to their API status", () => {
    try {
      mapLoyaltyError(new LoyaltyProblemError("INSUFFICIENT_POINTS"));
      throw new Error("mapLoyaltyError should rethrow");
    } catch (error) {
      expectApiError(error, 409, "INSUFFICIENT_POINTS");
    }
  });

  it("leaves unrelated errors untouched", () => {
    const unrelated = new Error("firestore unavailable");
    expect(() => mapLoyaltyError(unrelated)).toThrow(unrelated);
  });
});
