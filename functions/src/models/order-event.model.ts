import { Timestamp } from "firebase-admin/firestore";

export type OrderEventType =
  | "PAYMENT_CONFIRMED"
  | "PICKUP_CREATED"
  | "PICKUP_PREPARING"
  | "PICKUP_READY"
  | "PICKUP_CODE_VERIFIED"
  | "PICKUP_COMPLETED"
  | "PICKUP_EXPIRED"
  | "PICKUP_CANCELED"
  | "ORDER_REFUNDED";

export type OrderEventActorType = "system" | "webhook" | "admin" | "staff" | "customer";

export interface OrderEvent {
  id?: string;
  orderId: string;
  eventType: OrderEventType;
  actorType: OrderEventActorType;
  actorId?: string;
  pickupLocationId?: string;
  sourceEventId?: string;
  metadata?: Record<string, unknown>;
  createdAt: Timestamp;
}
