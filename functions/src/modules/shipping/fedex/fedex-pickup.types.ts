import { Timestamp } from "firebase-admin/firestore";
import { z } from "zod";

export type FedexPickupCarrierCode = "FDXE" | "FDXG";
export type FedexPickupStatus = "SCHEDULED" | "CANCELLED" | "FAILED";

const dateSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "pickupDate debe tener formato YYYY-MM-DD");

const timeSchema = z
  .string()
  .trim()
  .regex(/^\d{2}:\d{2}:\d{2}$/, "La hora debe tener formato HH:mm:ss");

const carrierCodeSchema = z.enum(["FDXE", "FDXG"]);

const contactSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    phone: z.string().trim().min(7).max(30),
    email: z.string().trim().email().max(160).optional(),
  })
  .strict();

const validatePickupWindow = <
  T extends {
    readyTime: string;
    latestTime: string;
  },
>(
  value: T,
  ctx: z.RefinementCtx,
) => {
  if (value.latestTime <= value.readyTime) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["latestTime"],
      message: "latestTime debe ser mayor que readyTime",
    });
  }
};

export const fedexPickupAvailabilitySchema = z
  .object({
    pickupDate: dateSchema,
    readyTime: timeSchema,
    latestTime: timeSchema,
    carrierCode: carrierCodeSchema.optional(),
    countryCode: z.string().trim().min(2).max(2).default("MX"),
    postalCode: z.string().trim().min(1).max(20),
    city: z.string().trim().min(1).max(80),
    stateOrProvinceCode: z.string().trim().min(1).max(20),
    isDomestic: z.boolean().default(true),
    packageCount: z.number().int().min(1).max(99),
    totalWeightKg: z.number().positive(),
  })
  .strict()
  .superRefine(validatePickupWindow);

export const fedexPickupCreateSchema = z
  .object({
    orderIds: z.array(z.string().trim().min(1).max(120)).min(1).max(99),
    pickupDate: dateSchema,
    readyTime: timeSchema,
    latestTime: timeSchema,
    carrierCode: carrierCodeSchema.optional(),
    pickupLocation: z.string().trim().min(1).max(40).optional(),
    remarks: z.string().trim().max(500).optional(),
    contact: contactSchema.optional(),
  })
  .strict()
  .superRefine(validatePickupWindow);

export const fedexPickupCancelSchema = z
  .object({
    reason: z.string().trim().min(1).max(500).optional(),
  })
  .strict();

export const fedexPickupIdParamSchema = z
  .object({
    pickupId: z.string().trim().min(1).max(160),
  })
  .strict();

export type FedexPickupAvailabilityInput = z.infer<
  typeof fedexPickupAvailabilitySchema
>;
export type FedexPickupCreateInput = z.infer<typeof fedexPickupCreateSchema>;
export type FedexPickupCancelInput = z.infer<typeof fedexPickupCancelSchema>;

export interface FedexPickupAddress {
  streetLines: string[];
  city: string;
  stateOrProvinceCode: string;
  postalCode: string;
  countryCode: string;
  residential?: boolean;
}

export interface FedexPickupContact {
  name: string;
  phone: string;
  email?: string;
}

export interface FedexPickupAvailabilityRequestInput
  extends FedexPickupAvailabilityInput {
  carrierCode: FedexPickupCarrierCode;
}

export interface FedexPickupCreateRequestInput {
  pickupDate: string;
  readyTime: string;
  latestTime: string;
  carrierCode: FedexPickupCarrierCode;
  pickupLocation: string;
  remarks?: string;
  contact: FedexPickupContact;
  address: FedexPickupAddress;
  packageCount: number;
  totalWeightKg: number;
  trackingNumbers: string[];
}

export interface FedexPickupCancelRequestInput {
  confirmationNumber: string;
  carrierCode: FedexPickupCarrierCode;
  scheduledDate: string;
  locationCode?: string;
}

export interface FedexPickupProviderResponse {
  output?: Record<string, unknown>;
  alerts?: FedexPickupAlert[];
  errors?: FedexPickupAlert[];
  transactionId?: string;
  customerTransactionId?: string;
}

export interface FedexPickupAlert {
  code?: string;
  message?: string;
  alertType?: string;
  type?: string;
}

export interface FedexPickupAvailabilityResult {
  ok: true;
  provider: "FEDEX";
  available: boolean;
  carrierCode: FedexPickupCarrierCode;
  pickupDate: string;
  cutOffTime?: string;
  accessTime?: string;
  readyTime: string;
  latestTime: string;
  defaultReadyTime?: string;
  localTime?: string;
  reason?: string;
  warnings: string[];
}

export interface FedexPickupCreateResult {
  ok: true;
  provider: "FEDEX";
  pickupId: string;
  status: "SCHEDULED";
  confirmationNumber: string;
  locationCode?: string;
  pickupNotification?: string;
  pickupDate: string;
  readyTime: string;
  latestTime: string;
  orderIds: string[];
  alreadyCreated?: boolean;
  warnings: string[];
}

export interface FedexPickupCancelResult {
  ok: true;
  provider: "FEDEX";
  pickupId: string;
  status: "CANCELLED";
  confirmationNumber: string;
  cancelledAt: string;
  alreadyCancelled?: boolean;
}

export interface FedexPickupFirestoreDocument {
  provider: "FEDEX";
  environment: "sandbox" | "production";
  status: FedexPickupStatus;
  pending?: boolean;
  carrierCode: FedexPickupCarrierCode;
  pickupDate: string;
  readyTime: string;
  latestTime: string;
  confirmationNumber?: string;
  locationCode?: string;
  pickupNotification?: string;
  orderIds: string[];
  trackingNumbers: string[];
  packageCount: number;
  totalWeightKg: number;
  address: FedexPickupAddress;
  contact: FedexPickupContact;
  remarks?: string;
  createdBy?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  cancelledAt?: Timestamp | null;
  cancellationReason?: string | null;
  failureReason?: string;
}

