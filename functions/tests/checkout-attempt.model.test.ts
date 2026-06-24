import { CheckoutAttemptStatus, TERMINAL_CHECKOUT_ATTEMPT_STATUSES } from "../src/models/checkout-attempt.model";

describe("checkout-attempt.model", () => {
  it("define estados terminales del intento", () => {
    expect(TERMINAL_CHECKOUT_ATTEMPT_STATUSES.has(CheckoutAttemptStatus.FINALIZED)).toBe(true);
    expect(TERMINAL_CHECKOUT_ATTEMPT_STATUSES.has(CheckoutAttemptStatus.FAILED)).toBe(true);
    expect(TERMINAL_CHECKOUT_ATTEMPT_STATUSES.has(CheckoutAttemptStatus.PAYMENT_PENDING)).toBe(false);
  });
});
