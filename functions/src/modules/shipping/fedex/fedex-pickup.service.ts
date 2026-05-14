import crypto from "crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { EstadoOrden, Orden } from "../../../models/orden.model";
import { fedexClient } from "./fedex-client";
import { getFedexConfig } from "./fedex.config";
import {
  mapFedexPickupAvailabilityRequest,
  mapFedexPickupAvailabilityResponse,
  mapFedexPickupCancelRequest,
  mapFedexPickupCreateRequest,
  mapFedexPickupCreateResponse,
} from "./fedex-pickup.mapper";
import { getFedexShipperConfig } from "./fedex-ship.mapper";
import {
  FedexPickupAddress,
  FedexPickupAvailabilityInput,
  FedexPickupAvailabilityRequestInput,
  FedexPickupAvailabilityResult,
  FedexPickupCancelInput,
  FedexPickupCancelResult,
  FedexPickupCarrierCode,
  FedexPickupContact,
  FedexPickupCreateInput,
  FedexPickupCreateRequestInput,
  FedexPickupCreateResult,
  FedexPickupFirestoreDocument,
  FedexPickupProviderResponse,
} from "./fedex-pickup.types";

export const FEDEX_PICKUP_AVAILABILITY_PATH = "/pickup/v1/pickups/availabilities";
export const FEDEX_PICKUP_CREATE_PATH = "/pickup/v1/pickups";
export const FEDEX_PICKUP_CANCEL_PATH = "/pickup/v1/pickups/cancel";

const ORDERS_COLLECTION = "ordenes";
const SHIPPING_PICKUPS_COLLECTION = "shipping_pickups";
const SHIPPING_EVENTS_COLLECTION = "shipping_events";

type FirestoreLike = FirebaseFirestore.Firestore;
type TransactionLike = FirebaseFirestore.Transaction;
type DocumentReferenceLike = FirebaseFirestore.DocumentReference;
type DocumentSnapshotLike = FirebaseFirestore.DocumentSnapshot;

type FedexClientLike = {
  post<T = unknown>(path: string, data?: unknown): Promise<T>;
  put<T = unknown>(path: string, data?: unknown): Promise<T>;
};

type ShippingPackage = {
  weightKg?: number;
  sequenceNumber?: number;
  trackingNumber?: string;
};

type ShippingPickupState = {
  pickupId?: string;
  status?: string;
  confirmationNumber?: string;
};

type ShippingState = {
  provider?: string;
  status?: string;
  trackingNumber?: string;
  trackingStatus?: {
    status?: string;
  };
  packages?: ShippingPackage[];
  packageCount?: number;
  totalWeightKg?: number;
  pickup?: ShippingPickupState;
};

type PickupOrder = Orden & {
  id: string;
  shipping?: ShippingState;
};

export class FedexPickupError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "FedexPickupError";
    this.statusCode = statusCode;
    Error.captureStackTrace(this, this.constructor);
  }
}

const isPositiveNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

const isActivePickup = (pickup: ShippingPickupState | undefined): boolean =>
  Boolean(
    pickup?.pickupId &&
      pickup.status !== "CANCELLED" &&
      pickup.status !== "FAILED",
  );

const isCarrierCode = (value: string): value is FedexPickupCarrierCode =>
  value === "FDXE" || value === "FDXG";

const safeErrorMessage = (error: unknown): string =>
  error instanceof Error && error.message ? error.message : "FedEx pickup failed";

const toIsoDate = (value: Timestamp | undefined): string =>
  value ? value.toDate().toISOString() : new Date().toISOString();

const hashId = (value: string): string =>
  crypto.createHash("sha256").update(value).digest("hex").slice(0, 32);

const getActorId = (user?: { uid?: string }): string | undefined => user?.uid;

const uniqSorted = (values: string[]): string[] =>
  Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).sort();

const createPickupId = (input: {
  carrierCode: FedexPickupCarrierCode;
  pickupDate: string;
  readyTime: string;
  latestTime: string;
  orderIds: string[];
}): string =>
  `fedex_pickup_${hashId(
    [
      "FEDEX",
      input.carrierCode,
      input.pickupDate,
      input.readyTime,
      input.latestTime,
      ...input.orderIds,
    ].join("|"),
  )}`;

const normalizeCarrierCode = (
  input: string | undefined,
): FedexPickupCarrierCode => {
  if (input && isCarrierCode(input)) {
    return input;
  }

  return getFedexConfig().pickupDefaultCarrierCode;
};

const normalizePickupLocation = (input: string | undefined): string =>
  input || getFedexConfig().pickupDefaultLocation;

const getPickupAddress = (): FedexPickupAddress => {
  const shipper = getFedexShipperConfig();

  return {
    streetLines: shipper.streetLines,
    city: shipper.city,
    stateOrProvinceCode: shipper.stateOrProvinceCode,
    postalCode: shipper.postalCode,
    countryCode: shipper.countryCode,
    residential: false,
  };
};

const getPickupContact = (
  input: FedexPickupCreateInput["contact"],
): FedexPickupContact => {
  const shipper = getFedexShipperConfig();

  return {
    name: input?.name || shipper.name,
    phone: input?.phone || shipper.phone,
    email: input?.email || shipper.email,
  };
};

const assertPickupEnabled = (): void => {
  if (!getFedexConfig().pickupEnabled) {
    throw new FedexPickupError(
      "Las recolecciones FedEx están desactivadas para este entorno",
      409,
    );
  }
};

const validateOrderForPickup = (order: PickupOrder): void => {
  const shipping = order.shipping;

  if (shipping?.provider !== "FEDEX") {
    throw new FedexPickupError(
      `La orden ${order.id} no tiene envío FedEx`,
      400,
    );
  }

  if (!shipping.trackingNumber) {
    throw new FedexPickupError(
      `La orden ${order.id} no tiene trackingNumber FedEx`,
      400,
    );
  }

  if (shipping.status === "CANCELLED" || order.estado === EstadoOrden.CANCELADA) {
    throw new FedexPickupError(
      `La orden ${order.id} tiene envío cancelado`,
      409,
    );
  }

  if (
    order.estado === EstadoOrden.ENTREGADA ||
    shipping.status === "DELIVERED" ||
    shipping.trackingStatus?.status === "DELIVERED"
  ) {
    throw new FedexPickupError(
      `La orden ${order.id} ya fue entregada`,
      409,
    );
  }

  if (isActivePickup(shipping.pickup)) {
    throw new FedexPickupError(
      `La orden ${order.id} ya tiene una recolección FedEx activa`,
      409,
    );
  }
};

const calculateShipmentTotals = (
  orders: PickupOrder[],
): { packageCount: number; totalWeightKg: number; trackingNumbers: string[] } => {
  let packageCount = 0;
  let totalWeightKg = 0;
  const trackingNumbers: string[] = [];

  for (const order of orders) {
    const shipping = order.shipping;
    if (shipping?.trackingNumber) {
      trackingNumbers.push(shipping.trackingNumber);
    }

    const packages = shipping?.packages;
    if (Array.isArray(packages) && packages.length > 0) {
      packageCount += packages.length;
      totalWeightKg += packages.reduce(
        (sum, item) => sum + (isPositiveNumber(item.weightKg) ? item.weightKg : 0),
        0,
      );
      continue;
    }

    const storedPackageCount = shipping?.packageCount;
    if (isPositiveNumber(storedPackageCount)) {
      packageCount += storedPackageCount;
    }
    const storedTotalWeightKg = shipping?.totalWeightKg;
    if (isPositiveNumber(storedTotalWeightKg)) {
      totalWeightKg += storedTotalWeightKg;
    }
  }

  if (packageCount <= 0 || packageCount > 99) {
    throw new FedexPickupError(
      "Las órdenes requieren entre 1 y 99 paquetes para solicitar recolección FedEx",
      400,
    );
  }

  if (totalWeightKg <= 0) {
    throw new FedexPickupError(
      "Las órdenes requieren peso total mayor a 0 para solicitar recolección FedEx",
      400,
    );
  }

  return {
    packageCount,
    totalWeightKg: Math.round(totalWeightKg * 100) / 100,
    trackingNumbers,
  };
};

const pickupDocToCreateResult = (
  pickupId: string,
  doc: FedexPickupFirestoreDocument,
): FedexPickupCreateResult => ({
  ok: true,
  provider: "FEDEX",
  pickupId,
  status: "SCHEDULED",
  confirmationNumber: doc.confirmationNumber || "",
  locationCode: doc.locationCode,
  pickupNotification: doc.pickupNotification,
  pickupDate: doc.pickupDate,
  readyTime: doc.readyTime,
  latestTime: doc.latestTime,
  orderIds: doc.orderIds,
  alreadyCreated: true,
  warnings: [],
});

const getPickupData = (
  doc: DocumentSnapshotLike,
): FedexPickupFirestoreDocument | undefined =>
  doc.exists ? (doc.data() as FedexPickupFirestoreDocument) : undefined;

export class FedexPickupService {
  constructor(
    private readonly db?: FirestoreLike,
    private readonly client: FedexClientLike = fedexClient,
  ) {}

  private getDb(): FirestoreLike {
    if (this.db) {
      return this.db;
    }

    return require("../../../config/firebase").firestoreTienda as FirestoreLike;
  }

  private async writeShippingEvent(input: {
    orderId?: string;
    pickupId?: string;
    type:
      | "PICKUP_AVAILABILITY_CHECKED"
      | "PICKUP_SCHEDULED"
      | "PICKUP_CANCELLED"
      | "PICKUP_FAILED";
    trackingNumber?: string;
    status?: string;
    metadata?: Record<string, unknown>;
    deterministicKey?: string;
  }): Promise<void> {
    const db = this.getDb();
    const now = Timestamp.now();
    const payload = {
      provider: "FEDEX",
      type: input.type,
      orderId: input.orderId,
      pickupId: input.pickupId,
      trackingNumber: input.trackingNumber,
      status: input.status,
      metadata: input.metadata,
      createdAt: now,
    };

    if (input.deterministicKey) {
      const eventId = hashId(input.deterministicKey);
      try {
        await db.collection(SHIPPING_EVENTS_COLLECTION).doc(eventId).create(payload);
      } catch (error) {
        const code = String((error as { code?: unknown })?.code ?? "");
        if (code !== "6" && code !== "already-exists") {
          throw error;
        }
      }
      return;
    }

    await db.collection(SHIPPING_EVENTS_COLLECTION).add(payload);
  }

  async checkAvailability(
    input: FedexPickupAvailabilityInput,
  ): Promise<FedexPickupAvailabilityResult> {
    assertPickupEnabled();

    const carrierCode = normalizeCarrierCode(input.carrierCode);
    const availabilityInput: FedexPickupAvailabilityRequestInput = {
      ...input,
      carrierCode,
    };
    const response = await this.client.post<FedexPickupProviderResponse>(
      FEDEX_PICKUP_AVAILABILITY_PATH,
      mapFedexPickupAvailabilityRequest(availabilityInput),
    );
    const result = mapFedexPickupAvailabilityResponse(availabilityInput, response);
    const hourKey = new Date().toISOString().slice(0, 13);

    await this.writeShippingEvent({
      type: "PICKUP_AVAILABILITY_CHECKED",
      status: result.available ? "AVAILABLE" : "UNAVAILABLE",
      metadata: {
        carrierCode,
        pickupDate: input.pickupDate,
        postalCode: input.postalCode,
        available: result.available,
      },
      deterministicKey: [
        "availability",
        carrierCode,
        input.pickupDate,
        input.postalCode,
        hourKey,
      ].join("|"),
    });

    return result;
  }

  private async reservePickup(input: {
    pickupId: string;
    orderIds: string[];
    carrierCode: FedexPickupCarrierCode;
    pickupDate: string;
    readyTime: string;
    latestTime: string;
    pickupLocation: string;
    remarks?: string;
    contact: FedexPickupContact;
    address: FedexPickupAddress;
    createdBy?: string;
  }): Promise<
    | { alreadyCreated: true; result: FedexPickupCreateResult }
    | {
        alreadyCreated: false;
        orders: PickupOrder[];
        totals: {
          packageCount: number;
          totalWeightKg: number;
          trackingNumbers: string[];
        };
      }
  > {
    const db = this.getDb();
    const now = Timestamp.now();
    const pickupRef = db
      .collection(SHIPPING_PICKUPS_COLLECTION)
      .doc(input.pickupId);

    return db.runTransaction(async (tx: TransactionLike) => {
      const pickupDoc = await tx.get(pickupRef);
      const existingPickup = getPickupData(pickupDoc);

      if (existingPickup?.status === "SCHEDULED" && !existingPickup.pending) {
        return {
          alreadyCreated: true,
          result: pickupDocToCreateResult(input.pickupId, existingPickup),
        };
      }

      if (existingPickup?.status === "SCHEDULED" && existingPickup.pending) {
        throw new FedexPickupError(
          "Ya existe una recolección FedEx en proceso para estas órdenes",
          409,
        );
      }

      const orderRefs = input.orderIds.map((orderId) =>
        db.collection(ORDERS_COLLECTION).doc(orderId),
      );
      const orderDocs = await Promise.all(
        orderRefs.map((orderRef) => tx.get(orderRef)),
      );
      const orders = orderDocs.map((doc) => {
        if (!doc.exists) {
          throw new FedexPickupError(`Orden no encontrada: ${doc.id}`, 404);
        }

        return { id: doc.id, ...(doc.data() as Orden) } as PickupOrder;
      });

      for (const order of orders) {
        validateOrderForPickup(order);
      }

      const totals = calculateShipmentTotals(orders);
      const pickupDocData: FedexPickupFirestoreDocument = {
        provider: "FEDEX",
        environment: getFedexConfig().environment,
        status: "SCHEDULED",
        pending: true,
        carrierCode: input.carrierCode,
        pickupDate: input.pickupDate,
        readyTime: input.readyTime,
        latestTime: input.latestTime,
        orderIds: input.orderIds,
        trackingNumbers: totals.trackingNumbers,
        packageCount: totals.packageCount,
        totalWeightKg: totals.totalWeightKg,
        address: input.address,
        contact: input.contact,
        remarks: input.remarks,
        createdBy: input.createdBy,
        createdAt: now,
        updatedAt: now,
        cancelledAt: null,
        cancellationReason: null,
      };

      tx.set(pickupRef, pickupDocData);

      orderRefs.forEach((orderRef) => {
        tx.update(orderRef, {
          "shipping.pickup": {
            pickupId: input.pickupId,
            status: "SCHEDULED",
            pickupDate: input.pickupDate,
            readyTime: input.readyTime,
            latestTime: input.latestTime,
            pending: true,
            updatedAt: now,
          },
          "shipping.updatedAt": now,
          updatedAt: now,
        });
      });

      return {
        alreadyCreated: false,
        orders,
        totals,
      };
    });
  }

  private async markPickupFailed(input: {
    pickupId: string;
    orderIds: string[];
    reason: string;
  }): Promise<void> {
    const db = this.getDb();
    const batch = db.batch();
    const now = Timestamp.now();

    batch.update(db.collection(SHIPPING_PICKUPS_COLLECTION).doc(input.pickupId), {
      status: "FAILED",
      pending: false,
      failureReason: input.reason,
      updatedAt: now,
    });

    for (const orderId of input.orderIds) {
      batch.update(db.collection(ORDERS_COLLECTION).doc(orderId), {
        "shipping.pickup": FieldValue.delete(),
        "shipping.updatedAt": now,
        updatedAt: now,
      });
    }

    await batch.commit();

    await Promise.all(
      input.orderIds.map((orderId) =>
        this.writeShippingEvent({
          orderId,
          pickupId: input.pickupId,
          type: "PICKUP_FAILED",
          status: "FAILED",
          metadata: {
            reason: input.reason,
          },
        }),
      ),
    );
  }

  async createPickup(
    input: FedexPickupCreateInput,
    user?: { uid?: string },
  ): Promise<FedexPickupCreateResult> {
    assertPickupEnabled();

    const orderIds = uniqSorted(input.orderIds);
    const carrierCode = normalizeCarrierCode(input.carrierCode);
    const pickupId = createPickupId({
      carrierCode,
      pickupDate: input.pickupDate,
      readyTime: input.readyTime,
      latestTime: input.latestTime,
      orderIds,
    });
    const address = getPickupAddress();
    const contact = getPickupContact(input.contact);
    const pickupLocation = normalizePickupLocation(input.pickupLocation);
    const reservation = await this.reservePickup({
      pickupId,
      orderIds,
      carrierCode,
      pickupDate: input.pickupDate,
      readyTime: input.readyTime,
      latestTime: input.latestTime,
      pickupLocation,
      remarks: input.remarks,
      contact,
      address,
      createdBy: getActorId(user),
    });

    if (reservation.alreadyCreated) {
      return reservation.result;
    }

    try {
      const availability = await this.checkAvailability({
        pickupDate: input.pickupDate,
        readyTime: input.readyTime,
        latestTime: input.latestTime,
        carrierCode,
        countryCode: address.countryCode,
        postalCode: address.postalCode,
        city: address.city,
        stateOrProvinceCode: address.stateOrProvinceCode,
        isDomestic: true,
        packageCount: reservation.totals.packageCount,
        totalWeightKg: reservation.totals.totalWeightKg,
      });

      if (!availability.available) {
        throw new FedexPickupError(
          availability.reason || "FedEx no tiene disponibilidad para esta recolección",
          422,
        );
      }

      const createInput: FedexPickupCreateRequestInput = {
        pickupDate: input.pickupDate,
        readyTime: input.readyTime,
        latestTime: input.latestTime,
        carrierCode,
        pickupLocation,
        remarks: input.remarks,
        contact,
        address,
        packageCount: reservation.totals.packageCount,
        totalWeightKg: reservation.totals.totalWeightKg,
        trackingNumbers: reservation.totals.trackingNumbers,
      };
      const response = await this.client.post<FedexPickupProviderResponse>(
        FEDEX_PICKUP_CREATE_PATH,
        mapFedexPickupCreateRequest(createInput),
      );
      const mapped = mapFedexPickupCreateResponse(response);
      const db = this.getDb();
      const now = Timestamp.now();
      const batch = db.batch();
      const pickupRef = db.collection(SHIPPING_PICKUPS_COLLECTION).doc(pickupId);

      batch.update(pickupRef, {
        pending: false,
        confirmationNumber: mapped.confirmationNumber,
        locationCode: mapped.locationCode,
        pickupNotification: mapped.pickupNotification,
        updatedAt: now,
      });

      for (const order of reservation.orders) {
        batch.update(db.collection(ORDERS_COLLECTION).doc(order.id), {
          "shipping.pickup": {
            pickupId,
            status: "SCHEDULED",
            confirmationNumber: mapped.confirmationNumber,
            locationCode: mapped.locationCode,
            pickupDate: input.pickupDate,
            readyTime: input.readyTime,
            latestTime: input.latestTime,
            updatedAt: now,
          },
          "shipping.updatedAt": now,
          updatedAt: now,
        });
      }

      await batch.commit();

      await Promise.all(
        reservation.orders.map((order) =>
          this.writeShippingEvent({
            orderId: order.id,
            pickupId,
            type: "PICKUP_SCHEDULED",
            trackingNumber: order.shipping?.trackingNumber,
            status: "SCHEDULED",
            metadata: {
              confirmationNumber: mapped.confirmationNumber,
              locationCode: mapped.locationCode,
              pickupDate: input.pickupDate,
            },
          }),
        ),
      );

      return {
        ok: true,
        provider: "FEDEX",
        pickupId,
        status: "SCHEDULED",
        confirmationNumber: mapped.confirmationNumber,
        locationCode: mapped.locationCode,
        pickupNotification: mapped.pickupNotification,
        pickupDate: input.pickupDate,
        readyTime: input.readyTime,
        latestTime: input.latestTime,
        orderIds,
        warnings: [...availability.warnings, ...mapped.warnings],
      };
    } catch (error) {
      const reason = safeErrorMessage(error);
      await this.markPickupFailed({
        pickupId,
        orderIds,
        reason,
      });

      throw error;
    }
  }

  private async getPickupForCancel(
    pickupId: string,
  ): Promise<{
    data: FedexPickupFirestoreDocument & { confirmationNumber: string };
  }> {
    const db = this.getDb();
    const ref: DocumentReferenceLike = db
      .collection(SHIPPING_PICKUPS_COLLECTION)
      .doc(pickupId);
    const doc = await ref.get();
    const data = getPickupData(doc);

    if (!data) {
      throw new FedexPickupError("Recolección FedEx no encontrada", 404);
    }

    if (!data.confirmationNumber) {
      throw new FedexPickupError(
        "La recolección FedEx no tiene número de confirmación",
        409,
      );
    }

    return { data: { ...data, confirmationNumber: data.confirmationNumber } };
  }

  async cancelPickup(
    pickupId: string,
    input: FedexPickupCancelInput,
  ): Promise<FedexPickupCancelResult> {
    const { data } = await this.getPickupForCancel(pickupId);

    if (data.status === "CANCELLED") {
      return {
        ok: true,
        provider: "FEDEX",
        pickupId,
        status: "CANCELLED",
        confirmationNumber: data.confirmationNumber || "",
        cancelledAt: toIsoDate(data.cancelledAt || undefined),
        alreadyCancelled: true,
      };
    }

    try {
      await this.client.put<FedexPickupProviderResponse>(
        FEDEX_PICKUP_CANCEL_PATH,
        mapFedexPickupCancelRequest({
          confirmationNumber: data.confirmationNumber,
          carrierCode: data.carrierCode,
          scheduledDate: data.pickupDate,
          locationCode: data.locationCode,
        }),
      );
    } catch (error) {
      const message = safeErrorMessage(error).toLowerCase();
      if (
        message.includes("dispatch") ||
        message.includes("picked") ||
        message.includes("courier")
      ) {
        throw new FedexPickupError(
          "FedEx ya despachó la recolección y no permite cancelarla desde el sistema",
          409,
        );
      }

      throw error;
    }

    const db = this.getDb();
    const now = Timestamp.now();
    const batch = db.batch();

    batch.update(db.collection(SHIPPING_PICKUPS_COLLECTION).doc(pickupId), {
      status: "CANCELLED",
      pending: false,
      cancelledAt: now,
      cancellationReason: input.reason || null,
      updatedAt: now,
    });

    for (const orderId of data.orderIds) {
      batch.update(db.collection(ORDERS_COLLECTION).doc(orderId), {
        "shipping.pickup.status": "CANCELLED",
        "shipping.pickup.updatedAt": now,
        "shipping.updatedAt": now,
        updatedAt: now,
      });
    }

    await batch.commit();

    await Promise.all(
      data.orderIds.map((orderId) =>
        this.writeShippingEvent({
          orderId,
          pickupId,
          type: "PICKUP_CANCELLED",
          status: "CANCELLED",
          metadata: {
            confirmationNumber: data.confirmationNumber,
            reason: input.reason,
          },
        }),
      ),
    );

    return {
      ok: true,
      provider: "FEDEX",
      pickupId,
      status: "CANCELLED",
      confirmationNumber: data.confirmationNumber,
      cancelledAt: now.toDate().toISOString(),
    };
  }
}

export const fedexPickupService = new FedexPickupService();
