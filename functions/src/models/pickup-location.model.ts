import { Timestamp } from "firebase-admin/firestore";

export interface PickupLocation {
  id?: string;
  name: string;
  address: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  phone?: string;
  active: boolean;
  pickupEnabled: boolean;
  pickupInstructions?: string;
  businessHours?: Record<string, unknown>;
  preparationCutoffTime?: string;
  estimatedPreparationMinutes?: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export type CreatePickupLocationDTO = Omit<
  PickupLocation,
  "id" | "createdAt" | "updatedAt"
>;

export type UpdatePickupLocationDTO = Partial<CreatePickupLocationDTO>;

export interface PickupAvailabilityItem {
  productoId: string;
  tallaId?: string;
  requestedQuantity: number;
  availableQuantity?: number;
  available: boolean;
  reason?: string;
}

export interface PickupAvailabilityResult {
  canPickup: boolean;
  pickupLocationId: string;
  inventoryScope: "global";
  availableItems: PickupAvailabilityItem[];
  unavailableItems: PickupAvailabilityItem[];
}
