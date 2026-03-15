import { Timestamp } from "firebase-admin/firestore";

export type NotificationEventType =
  | "order_created"
  | "order_confirmed"
  | "order_shipped"
  | "order_delivered"
  | "cart_abandoned"
  | "product_restocked"
  | "price_drop"
  | "inactive_user"
  | "promo_campaign"
  | "matchday_campaign"
  | "probable_repurchase"
  | "manual_test";

export type NotificationCategory =
  | "order"
  | "cart"
  | "restock"
  | "price_drop"
  | "promo"
  | "matchday"
  | "reactivation"
  | "recommendation"
  | "test";

export type NotificationPriority = "normal" | "high";

export type NotificationEventStatus =
  | "queued"
  | "processing"
  | "processed"
  | "skipped"
  | "failed";

export type NotificationDeliveryStatus =
  | "queued"
  | "sent"
  | "skipped"
  | "failed"
  | "invalid_token";

export type NotificationDeliveryMode = "token" | "topic";

export type NotificationEntityType =
  | "order"
  | "product"
  | "cart"
  | "campaign"
  | "promo"
  | "user"
  | "notification";

export interface NotificationQuietHours {
  enabled: boolean;
  startHour: number;
  endHour: number;
}

export interface NotificationPreferenceDocument {
  id?: string;
  userId: string;
  pushEnabled: boolean;
  transactionalEnabled: boolean;
  orderUpdatesEnabled: boolean;
  cartRemindersEnabled: boolean;
  restockEnabled: boolean;
  priceDropEnabled: boolean;
  marketingEnabled: boolean;
  matchdayEnabled: boolean;
  reactivationEnabled: boolean;
  recommendationsEnabled: boolean;
  quietHours: NotificationQuietHours;
  timezone: string;
  locale: string;
  maxMarketingPerDay: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface DevicePushToken {
  id?: string;
  userId: string;
  deviceId: string;
  token: string;
  platform: "ios" | "android" | "web";
  enabled: boolean;
  locale?: string;
  timezone?: string;
  appVersion?: string;
  buildNumber?: string;
  lastSeenAt: Timestamp;
  lastSentAt?: Timestamp;
  lastFailureAt?: Timestamp;
  invalidReason?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface NotificationEvent {
  id?: string;
  eventType: NotificationEventType;
  category: NotificationCategory;
  userId: string;
  productId?: string;
  orderId?: string;
  cartId?: string;
  campaignId?: string;
  promoId?: string;
  entityType: NotificationEntityType;
  entityId: string;
  fingerprint: string;
  deliveryMode: NotificationDeliveryMode;
  topic?: string;
  priority: NotificationPriority;
  status: NotificationEventStatus;
  sourceData: Record<string, unknown>;
  triggerSource?: string;
  skipReason?: string;
  lastError?: string;
  processedAt?: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface GeneratedPushCopy {
  send: boolean;
  title: string;
  body: string;
  deeplink: string;
  category: NotificationCategory;
  priority: NotificationPriority;
  reasoningTag: string;
  screen: string;
  promptVersion?: string;
  modelVersion?: string;
  source: "ai" | "fallback";
}

export interface NotificationDeliveryRecord {
  id?: string;
  eventId: string;
  fingerprint: string;
  userId: string;
  eventType: NotificationEventType;
  category: NotificationCategory;
  status: NotificationDeliveryStatus;
  channel: "push" | "in_app";
  deliveryMode: NotificationDeliveryMode;
  deviceId?: string;
  token?: string;
  topic?: string;
  entityType: NotificationEntityType;
  entityId: string;
  title?: string;
  body?: string;
  deeplink?: string;
  screen?: string;
  priority?: NotificationPriority;
  skipReason?: string;
  providerMessageId?: string;
  providerErrorCode?: string;
  providerErrorMessage?: string;
  localDayKey?: string;
  createdAt: Timestamp;
  sentAt?: Timestamp;
}

export interface NotificationCampaignDocument {
  id?: string;
  active: boolean;
  type: "promo_campaign" | "matchday_campaign";
  title?: string;
  description?: string;
  startsAt?: Timestamp;
  endsAt?: Timestamp;
  deliveryMode?: NotificationDeliveryMode;
  topic?: string;
  lineIds?: string[];
  categoryIds?: string[];
  productIds?: string[];
  sourceData?: Record<string, unknown>;
  lastEnqueuedAt?: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface NotificationEligibilityResult {
  allowed: boolean;
  reason?: string;
  devices: DevicePushToken[];
  preference: NotificationPreferenceDocument;
  localDayKey: string;
  timezone: string;
}

export interface NotificationProcessingResult {
  eventId: string;
  status: NotificationEventStatus;
  skipReason?: string;
  deliveries: NotificationDeliveryRecord[];
  copy?: GeneratedPushCopy;
}
