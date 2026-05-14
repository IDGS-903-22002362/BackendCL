import { Timestamp } from "firebase-admin/firestore";
import { z } from "zod";

export type FedexLabelImageType = "PDF" | "PNG";
export type FedexShippingStatus =
  | "LABEL_CREATED"
  | "IN_TRANSIT"
  | "OUT_FOR_DELIVERY"
  | "DELIVERED"
  | "EXCEPTION"
  | "CANCELLED"
  | string;

export interface FedexShipPackageInput {
  weightKg: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
}

export interface FedexShipContactAddress {
  name: string;
  company?: string;
  phone: string;
  email?: string;
  streetLines: string[];
  city: string;
  stateOrProvinceCode: string;
  postalCode: string;
  countryCode: string;
  residential?: boolean;
}

export interface FedexShipRequestInput {
  orderId: string;
  serviceType: string;
  labelImageType: FedexLabelImageType;
  shipDate: string;
  recipient: FedexShipContactAddress;
  packages: FedexShipPackageInput[];
}

export interface FedexShipPackageResult extends FedexShipPackageInput {
  sequenceNumber: number;
  trackingNumber?: string;
}

export interface FedexShipNormalizedResult {
  provider: "FEDEX";
  environment: "sandbox" | "production";
  trackingNumber: string;
  masterTrackingNumber?: string;
  serviceType: string;
  shipmentId?: string;
  labelImageType: FedexLabelImageType;
  labelContentType: string;
  labelBuffer: Buffer;
  warnings: string[];
  packages: FedexShipPackageResult[];
}

export interface FedexShipResponse {
  output?: {
    transactionShipments?: FedexTransactionShipment[];
    alerts?: FedexShipAlert[];
  };
}

export interface FedexTransactionShipment {
  masterTrackingNumber?: string;
  serviceType?: string;
  shipmentDocuments?: FedexShipmentDocument[];
  pieceResponses?: FedexPieceResponse[];
  completedShipmentDetail?: {
    completedPackageDetails?: FedexCompletedPackageDetail[];
  };
  serviceCategory?: string;
  shipmentAdvisoryDetails?: {
    regulatoryAdvisory?: FedexShipAlert[];
  };
}

export interface FedexPieceResponse {
  trackingNumber?: string;
  packageDocuments?: FedexShipmentDocument[];
}

export interface FedexCompletedPackageDetail {
  trackingIds?: Array<{
    trackingNumber?: string;
  }>;
  packageDocuments?: FedexShipmentDocument[];
}

export interface FedexShipmentDocument {
  encodedLabel?: string;
  url?: string;
  contentType?: string;
  docType?: string;
  copiesToPrint?: number;
}

export interface FedexShipAlert {
  code?: string;
  message?: string;
  alertType?: string;
}

export interface FedexCancelShipmentProviderResponse {
  output?: {
    cancelledShipment?: boolean;
    success?: boolean;
    message?: string;
    alerts?: FedexShipAlert[];
    warnings?: FedexShipAlert[];
    transactionId?: string;
  };
  cancelledShipment?: boolean;
  success?: boolean;
  message?: string;
  alerts?: FedexShipAlert[];
  warnings?: FedexShipAlert[];
  transactionId?: string;
  customerTransactionId?: string;
}

export interface FedexCancelShipmentRequestInput {
  trackingNumber: string;
  deletionControl: "DELETE_ALL_PACKAGES";
}

export interface FedexCancelShipmentNormalizedResult {
  cancelled: boolean;
  transactionId?: string;
  message?: string;
  warnings: string[];
}

export interface FedexOrderShippingPackage extends FedexShipPackageInput {
  sequenceNumber?: number;
  trackingNumber?: string;
}

export interface FedexOrderShippingState {
  provider?: "FEDEX";
  status?: FedexShippingStatus | string;
  environment?: "sandbox" | "production";
  accountNumberLast4?: string;
  selectedServiceType?: string;
  quoteId?: string;
  selectedOptionId?: string;
  selectedRate?: {
    serviceType?: string;
    amount?: number;
    currency?: string;
    [key: string]: unknown;
  };
  serviceType?: string;
  packagingType?: "YOUR_PACKAGING" | string;
  pickupType?: "DROPOFF_AT_FEDEX_LOCATION" | string;
  trackingNumber?: string;
  masterTrackingNumber?: string;
  shipmentId?: string;
  labelStoragePath?: string;
  labelUrl?: string | null;
  labelImageType?: FedexLabelImageType;
  labelStockType?: string;
  shipDate?: string;
  estimatedDeliveryDate?: string;
  recipient?: FedexShipContactAddress;
  packages?: FedexOrderShippingPackage[];
  trackingStatus?: {
    status?: string;
    [key: string]: unknown;
  };
  pickup?: {
    pickupId?: string;
    status?: string;
    confirmationNumber?: string;
    [key: string]: unknown;
  };
  cancelledAt?: Timestamp;
  cancelledBy?: string;
  cancellationReason?: string;
  cancelProvider?: "FEDEX";
  cancelTransactionId?: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface FedexCreateShipmentResult {
  ok: true;
  provider: "FEDEX";
  environment: "sandbox" | "production";
  orderId: string;
  trackingNumber: string;
  masterTrackingNumber?: string;
  serviceType: string;
  labelUrl: string | null;
  labelStoragePath: string;
  shipmentId?: string;
  alreadyCreated?: boolean;
  warnings: string[];
}

export const fedexShipCreateSchema = z
  .object({
    serviceType: z.string().trim().min(1).optional(),
    labelImageType: z
      .enum(["PDF", "PNG"])
      .optional()
      .default("PDF"),
  })
  .strict();

export type FedexShipCreateInput = z.infer<typeof fedexShipCreateSchema>;

export const fedexCancelShipmentSchema = z
  .object({
    reason: z.string().trim().max(500).optional(),
    forceRefreshTracking: z.boolean().optional().default(false),
  })
  .strict();

export const fedexCancelTestShipmentSchema = z
  .object({
    trackingNumber: z.string().trim().min(1).max(80),
    reason: z.string().trim().max(500).optional(),
  })
  .strict();

export type FedexCancelShipmentInput = z.infer<
  typeof fedexCancelShipmentSchema
>;
export type FedexCancelTestShipmentInput = z.infer<
  typeof fedexCancelTestShipmentSchema
>;

export interface FedexCancelShipmentResult {
  ok: true;
  provider: "FEDEX";
  environment: "sandbox" | "production";
  orderId: string;
  trackingNumber: string;
  status: "CANCELLED";
  cancelledAt?: string;
  alreadyCancelled?: boolean;
  warnings: string[];
}

export interface FedexCancelTestShipmentResult {
  ok: true;
  provider: "FEDEX";
  environment: "sandbox";
  trackingNumber: string;
  status: "CANCELLED";
  warnings: string[];
}
