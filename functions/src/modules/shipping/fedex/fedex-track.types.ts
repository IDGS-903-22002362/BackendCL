import { Timestamp } from "firebase-admin/firestore";
import { z } from "zod";

export type FedexTrackingStatus =
  | "LABEL_CREATED"
  | "IN_TRANSIT"
  | "OUT_FOR_DELIVERY"
  | "DELIVERED"
  | "EXCEPTION"
  | "UNKNOWN";

export interface FedexTrackLocation {
  city?: string;
  stateOrProvinceCode?: string;
  countryCode?: string;
}

export interface FedexTrackEvent {
  date?: string;
  time?: string;
  timestamp?: string;
  eventType?: string;
  eventDescription?: string;
  location?: FedexTrackLocation;
}

export interface FedexTrackingResult {
  ok: true;
  provider: "FEDEX";
  orderId?: string;
  trackingNumber: string;
  status: FedexTrackingStatus;
  statusLabel: string;
  statusDescription?: string;
  lastUpdatedAt?: string;
  estimatedDeliveryDate?: string;
  deliveredAt?: string | null;
  lastLocation?: FedexTrackLocation;
  events: FedexTrackEvent[];
  rawStatusCode?: string;
  warnings: string[];
  message?: string;
  serviceType?: string;
  packageCount?: number;
  shipDate?: string;
  recipientCity?: string;
  recipientCountryCode?: string;
}

export interface FedexTrackingSnapshot {
  provider: "FEDEX";
  status: FedexTrackingStatus;
  statusLabel: string;
  rawStatusCode?: string;
  statusDescription?: string;
  estimatedDeliveryDate?: string;
  deliveredAt?: string | null;
  lastUpdatedAt: Timestamp;
  lastCarrierUpdateAt?: string;
  lastEventTimestamp?: string;
  lastLocation?: FedexTrackLocation;
}

export interface FedexTrackAlert {
  code?: string;
  message?: string;
  alertType?: string;
}

export interface FedexTrackResponse {
  output?: {
    completeTrackResults?: Array<{
      trackingNumber?: string;
      trackResults?: FedexTrackResultDetail[];
    }>;
    alerts?: FedexTrackAlert[];
  };
}

export interface FedexTrackResultDetail {
  trackingNumberInfo?: {
    trackingNumber?: string;
  };
  latestStatusDetail?: {
    code?: string;
    description?: string;
    statusByLocale?: string;
    scanLocation?: FedexTrackLocation;
  };
  dateAndTimes?: Array<{
    type?: string;
    dateTime?: string;
  }>;
  estimatedDeliveryTimeWindow?: {
    window?: {
      begins?: string;
      ends?: string;
    };
  };
  scanEvents?: Array<{
    date?: string;
    eventType?: string;
    eventDescription?: string;
    scanLocation?: FedexTrackLocation;
  }>;
  serviceDetail?: {
    type?: string;
    description?: string;
  };
  packageDetails?: {
    count?: number;
  };
  deliveryDetails?: {
    destinationServiceArea?: string;
  };
  recipientInformation?: {
    address?: FedexTrackLocation;
  };
  error?: {
    code?: string;
    message?: string;
  };
}

const normalizeTrackingNumber = (value: string): string =>
  value.trim().replace(/\s+/g, "");

const trackingNumberSchema = z
  .string()
  .transform(normalizeTrackingNumber)
  .refine((value) => value.length > 0, "trackingNumber is required")
  .refine((value) => /^[A-Za-z0-9-]+$/.test(value), {
    message: "trackingNumber contains invalid characters",
  });

export const fedexTrackDirectSchema = z
  .object({
    trackingNumbers: z
      .array(trackingNumberSchema)
      .min(1, "trackingNumbers must contain at least one tracking number")
      .max(30, "trackingNumbers can contain at most 30 tracking numbers"),
    includeDetailedScans: z.boolean().optional().default(false),
  })
  .strict();

export type FedexTrackDirectInput = z.infer<typeof fedexTrackDirectSchema>;
