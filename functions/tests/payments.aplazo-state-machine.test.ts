import { canTransitionPaymentStatus } from "../src/services/payments/payment-state-machine";
import { PaymentStatus } from "../src/services/payments/payment-status.enum";
import aplazoProvider from "../src/services/payments/providers/aplazo.provider";

describe("Aplazo payment state matrix", () => {
  it("allows the documented online happy path", () => {
    expect(
      canTransitionPaymentStatus(
        PaymentStatus.CREATED,
        PaymentStatus.PENDING_PROVIDER,
      ),
    ).toBe(true);
    expect(
      canTransitionPaymentStatus(
        PaymentStatus.PENDING_PROVIDER,
        PaymentStatus.PENDING_CUSTOMER,
      ),
    ).toBe(true);
    expect(
      canTransitionPaymentStatus(
        PaymentStatus.PENDING_CUSTOMER,
        PaymentStatus.PAID,
      ),
    ).toBe(true);
  });

  it("blocks terminal regressions and late paid after cancellation", () => {
    expect(
      canTransitionPaymentStatus(
        PaymentStatus.CANCELED,
        PaymentStatus.PAID,
      ),
    ).toBe(false);
    expect(
      canTransitionPaymentStatus(
        PaymentStatus.EXPIRED,
        PaymentStatus.PAID,
      ),
    ).toBe(false);
    expect(
      canTransitionPaymentStatus(
        PaymentStatus.FAILED,
        PaymentStatus.PAID,
      ),
    ).toBe(false);
  });

  it("maps documented aplazo statuses to internal statuses", () => {
    expect(aplazoProvider.mapProviderStatus("Activo")).toBe(PaymentStatus.PAID);
    expect(aplazoProvider.mapProviderStatus("No confirmado")).toBe(
      PaymentStatus.PENDING_CUSTOMER,
    );
    expect(aplazoProvider.mapProviderStatus("authorized")).toBe(
      PaymentStatus.AUTHORIZED,
    );
    expect(aplazoProvider.mapProviderStatus("cancelado")).toBe(
      PaymentStatus.CANCELED,
    );
    expect(aplazoProvider.mapProviderStatus("devuelto")).toBe(
      PaymentStatus.REFUNDED,
    );
    expect(aplazoProvider.mapProviderStatus("partial refund")).toBe(
      PaymentStatus.PARTIALLY_REFUNDED,
    );
  });
});
