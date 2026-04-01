import { PaymentStatus } from "../../models/pago.model";

export { PaymentStatus };

export const TERMINAL_PAYMENT_STATUSES: PaymentStatus[] = [
  PaymentStatus.FAILED,
  PaymentStatus.CANCELED,
  PaymentStatus.EXPIRED,
  PaymentStatus.REFUNDED,
];

export const ACTIVE_PAYMENT_STATUSES: PaymentStatus[] = [
  PaymentStatus.CREATED,
  PaymentStatus.PENDING_PROVIDER,
  PaymentStatus.PENDING_CUSTOMER,
  PaymentStatus.AUTHORIZED,
];
