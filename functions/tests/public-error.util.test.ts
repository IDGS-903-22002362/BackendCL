import {
  buildPublicErrorBody,
  isTechnicalMessage,
  sanitizePublicMessage,
} from "../src/utils/public-error.util";
import { ApiError } from "../src/utils/error-handler";
import { PaymentApiError } from "../src/services/payments/payment-api-error";

describe("public-error.util", () => {
  it("detects technical messages that must not reach users", () => {
    expect(isTechnicalMessage("auth/invalid-credential")).toBe(true);
    expect(isTechnicalMessage("Stripe: No such payment_intent pi_123")).toBe(
      true,
    );
    expect(isTechnicalMessage("PENDING_REGISTRATION_SECRET missing")).toBe(true);
    expect(isTechnicalMessage("Tu carrito está vacío.")).toBe(false);
  });

  it("sanitizes technical messages to fallback", () => {
    expect(
      sanitizePublicMessage(
        "Firestore permission-denied at /orders/abc",
        "Mensaje seguro",
      ),
    ).toBe("Mensaje seguro");
  });

  it("preserves operational ApiError messages", () => {
    const error = new ApiError(400, "El carrito está vacío");
    const { statusCode, body } = buildPublicErrorBody(error, "req-1");

    expect(statusCode).toBe(400);
    expect(body).toMatchObject({
      success: false,
      message: "El carrito está vacío",
      requestId: "req-1",
    });
  });

  it("maps non-operational errors to safe internal response", () => {
    const error = new Error("Stripe secret key sk_test_abc leaked");
    const { statusCode, body } = buildPublicErrorBody(error, "req-2", {
      fallbackMessage: "No pudimos procesar el pago.",
      fallbackCode: "PAYMENT_INTERNAL_ERROR",
    });

    expect(statusCode).toBe(500);
    expect(body).toMatchObject({
      success: false,
      code: "PAYMENT_INTERNAL_ERROR",
      message: "No pudimos procesar el pago.",
      retryable: true,
      requestId: "req-2",
    });
  });

  it("returns payment provider codes without leaking raw provider text", () => {
    const error = new PaymentApiError(
      502,
      "PAYMENT_PROVIDER_ERROR",
      "No fue posible contactar al proveedor de pago.",
    );
    const { statusCode, body } = buildPublicErrorBody(error);

    expect(statusCode).toBe(502);
    expect(body.code).toBe("PAYMENT_PROVIDER_ERROR");
    expect(body.message).toBe("No fue posible contactar al proveedor de pago.");
    expect(body.retryable).toBe(true);
  });
});
