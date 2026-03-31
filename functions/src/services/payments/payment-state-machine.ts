import { PaymentStatus } from "./payment-status.enum";

const transitionMap: Record<PaymentStatus, PaymentStatus[]> = {
  [PaymentStatus.CREATED]: [PaymentStatus.PENDING_PROVIDER],
  [PaymentStatus.PENDING_PROVIDER]: [
    PaymentStatus.PENDING_PROVIDER,
    PaymentStatus.PENDING_CUSTOMER,
    PaymentStatus.FAILED,
  ],
  [PaymentStatus.PENDING_CUSTOMER]: [
    PaymentStatus.AUTHORIZED,
    PaymentStatus.PAID,
    PaymentStatus.CANCELED,
    PaymentStatus.EXPIRED,
  ],
  [PaymentStatus.AUTHORIZED]: [
    PaymentStatus.PAID,
    PaymentStatus.CANCELED,
  ],
  [PaymentStatus.PAID]: [
    PaymentStatus.PARTIALLY_REFUNDED,
    PaymentStatus.REFUNDED,
  ],
  [PaymentStatus.FAILED]: [],
  [PaymentStatus.CANCELED]: [],
  [PaymentStatus.EXPIRED]: [],
  [PaymentStatus.REFUNDED]: [],
  [PaymentStatus.PARTIALLY_REFUNDED]: [PaymentStatus.REFUNDED],
};

export const canTransitionPaymentStatus = (
  from: PaymentStatus,
  to: PaymentStatus,
): boolean => {
  if (from === to) {
    return true;
  }

  return transitionMap[from]?.includes(to) ?? false;
};
