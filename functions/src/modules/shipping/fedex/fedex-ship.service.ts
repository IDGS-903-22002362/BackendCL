import { Timestamp } from "firebase-admin/firestore";
import { Orden, EstadoOrden, FulfillmentMethod } from "../../../models/orden.model";
import {
  COLECCION_PAGOS,
  EstadoPago,
  Pago,
  PaymentStatus,
} from "../../../models/pago.model";
import { fedexClient } from "./fedex-client";
import { FedexProviderError } from "./fedex.errors";
import { getFedexConfig } from "./fedex.config";
import {
  fedexLabelStockType,
  mapFedexCancelShipmentRequest,
  mapFedexCancelShipmentResponse,
  mapFedexShipRequest,
  mapFedexShipResponse,
} from "./fedex-ship.mapper";
import { fedexTrackService } from "./fedex-track.service";
import {
  FedexCancelShipmentInput,
  FedexCancelShipmentProviderResponse,
  FedexCancelShipmentResult,
  FedexCancelTestShipmentInput,
  FedexCancelTestShipmentResult,
  FedexCreateShipmentResult,
  FedexLabelImageType,
  FedexOrderShippingPackage,
  FedexOrderShippingState,
  FedexShipCreateInput,
  FedexShipRequestInput,
  FedexShipResponse,
} from "./fedex-ship.types";

const ORDERS_COLLECTION = "ordenes";
const SHIPPING_EVENTS_COLLECTION = "shipping_events";
const FEDEX_SHIP_PATH = "/ship/v1/shipments";
export const FEDEX_CANCEL_SHIPMENT_METHOD = "PUT";
export const FEDEX_CANCEL_SHIPMENT_PATH = "/ship/v1/shipments/cancel";
export const FEDEX_CANCEL_DELETION_CONTROL = "DELETE_ALL_PACKAGES";
const DEFAULT_SERVICE_TYPE = "FEDEX_EXPRESS_SAVER";

type FirestoreLike = FirebaseFirestore.Firestore;

type FedexClientLike = {
  post<T = unknown>(path: string, data?: unknown): Promise<T>;
  put<T = unknown>(path: string, data?: unknown): Promise<T>;
};

type StorageBucketLike = {
  file(path: string): {
    save(
      data: Buffer,
      options?: { metadata?: { contentType?: string } },
    ): Promise<unknown>;
  };
};

export class FedexShipError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "FedexShipError";
    this.statusCode = statusCode;
    Error.captureStackTrace(this, this.constructor);
  }
}

const currentShipDate = (): string => new Date().toISOString().slice(0, 10);

const isPositiveNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

const assertCompleteAddress = (orden: Orden): NonNullable<Orden["direccionEnvio"]> => {
  const address = orden.direccionEnvio;
  if (
    !address?.nombre ||
    !address.telefono ||
    !address.calle ||
    !address.numero ||
    !address.colonia ||
    !address.ciudad ||
    !address.estado ||
    !address.codigoPostal
  ) {
    throw new FedexShipError("La orden no tiene dirección de envío completa");
  }

  return address;
};

const assertPackages = (
  packages: FedexOrderShippingPackage[] | undefined,
): FedexOrderShippingPackage[] => {
  if (!Array.isArray(packages) || packages.length === 0) {
    throw new FedexShipError("La orden no tiene paquetes configurados para FedEx");
  }

  for (const item of packages) {
    if (
      !isPositiveNumber(item.weightKg) ||
      !isPositiveNumber(item.lengthCm) ||
      !isPositiveNumber(item.widthCm) ||
      !isPositiveNumber(item.heightCm)
    ) {
      throw new FedexShipError(
        "Los paquetes FedEx requieren peso y dimensiones mayores a 0",
      );
    }
  }

  return packages;
};

const buildRecipient = (orden: Orden): FedexShipRequestInput["recipient"] => {
  const address = assertCompleteAddress(orden);
  const streetLines = [
    `${address.calle} ${address.numero}`,
    address.numeroInterior ? `Interior ${address.numeroInterior}` : undefined,
    address.colonia ? `Colonia ${address.colonia}` : undefined,
  ].filter((item): item is string => Boolean(item));

  return {
    name: address.nombre,
    phone: address.telefono,
    streetLines,
    city: address.ciudad,
    stateOrProvinceCode: address.estado,
    postalCode: address.codigoPostal,
    countryCode: "MX",
    residential: true,
  };
};

const isExistingLabel = (shipping: FedexOrderShippingState | undefined, orden: Orden) =>
  Boolean(
    shipping?.trackingNumber ||
      shipping?.status === "LABEL_CREATED" ||
      orden.numeroGuia,
  );

const getFedexOrderShippingState = (
  shipping: Orden["shipping"],
): FedexOrderShippingState | undefined => {
  if (!shipping || shipping.provider !== "FEDEX") {
    return undefined;
  }

  return shipping as FedexOrderShippingState;
};

const isPaidPayment = (pago: Pago): boolean =>
  pago.estado === EstadoPago.COMPLETADO || pago.status === PaymentStatus.PAID;

const isRefundedPayment = (pago: Pago): boolean =>
  pago.estado === EstadoPago.REEMBOLSADO ||
  pago.status === PaymentStatus.REFUNDED ||
  pago.status === PaymentStatus.PARTIALLY_REFUNDED;

const isActivePickup = (
  pickup: FedexOrderShippingState["pickup"] | undefined,
): boolean =>
  Boolean(
    pickup?.pickupId &&
      pickup.status !== "CANCELLED" &&
      pickup.status !== "FAILED",
  );

const toSafeEventErrorMessage = (error: unknown): string =>
  error instanceof Error && error.message
    ? error.message
    : "FedEx cancel shipment failed";

const isCannotCancelFedexError = (message: string): boolean => {
  const normalized = message.toLowerCase();

  return (
    normalized.includes("tender") ||
    normalized.includes("processed") ||
    normalized.includes("picked") ||
    normalized.includes("pickup") ||
    normalized.includes("cannot cancel") ||
    normalized.includes("unable to delete") ||
    normalized.includes("unable to cancel")
  );
};

const timestampToIso = (value: Timestamp | undefined): string | undefined =>
  value ? value.toDate().toISOString() : undefined;

export class FedexShipService {
  constructor(
    private readonly db?: FirestoreLike,
    private readonly bucket?: StorageBucketLike,
    private readonly client?: FedexClientLike,
  ) {}

  private getDb(): FirestoreLike {
    if (this.db) {
      return this.db;
    }

    return require("../../../config/firebase").firestoreTienda as FirestoreLike;
  }

  private getBucket(): StorageBucketLike {
    if (this.bucket) {
      return this.bucket;
    }

    return require("../../../config/firebase").storageTienda.bucket() as StorageBucketLike;
  }

  private getClient(): FedexClientLike {
    return this.client || fedexClient;
  }

  async assertOrderPaymentAllowsFedexLabel(orderId: string): Promise<void> {
    const snapshot = await this.getDb()
      .collection(COLECCION_PAGOS)
      .where("ordenId", "==", orderId)
      .get();

    const payments = snapshot.docs.map((doc) => doc.data() as Pago);
    if (payments.some(isRefundedPayment)) {
      throw new FedexShipError(
        "No se puede generar guía FedEx para pagos reembolsados",
        409,
      );
    }

    if (!payments.some(isPaidPayment)) {
      throw new FedexShipError(
        "Solo se pueden generar guías FedEx con pago confirmado",
        409,
      );
    }
  }

  async markShipmentLabelFailed(input: {
    orderId: string;
    errorMessage: string;
    createdBy?: string;
  }): Promise<void> {
    const now = Timestamp.now();
    const safeMessage = input.errorMessage.slice(0, 500);
    await this.getDb().collection(ORDERS_COLLECTION).doc(input.orderId).set(
      {
        shipping: {
          status: "LABEL_FAILED",
          labelErrorMessage: safeMessage,
          labelFailedAt: now,
          updatedAt: now,
        },
        updatedAt: now,
      },
      { merge: true },
    );

    await this.getDb().collection(SHIPPING_EVENTS_COLLECTION).add({
      orderId: input.orderId,
      provider: "FEDEX",
      type: "FEDEX_LABEL_FAILED",
      errorMessageSeguro: safeMessage,
      createdBy: input.createdBy,
      environment: getFedexConfig().environment,
      createdAt: now,
    });
  }

  private async writeShipmentCancelEvent(input: {
    orderId?: string;
    type:
      | "SHIPMENT_CANCELLED"
      | "SHIPMENT_CANCEL_FAILED"
      | "FEDEX_SHIPMENT_CANCELLED"
      | "FEDEX_SHIPMENT_CANCEL_FAILED";
    trackingNumber: string;
    reason?: string;
    createdBy?: string;
    errorMessageSeguro?: string;
    environment: "sandbox" | "production";
  }): Promise<void> {
    await this.getDb().collection(SHIPPING_EVENTS_COLLECTION).add({
      orderId: input.orderId,
      provider: "FEDEX",
      type: input.type,
      trackingNumber: input.trackingNumber,
      reason: input.reason,
      createdBy: input.createdBy,
      errorMessageSeguro: input.errorMessageSeguro,
      environment: input.environment,
      createdAt: Timestamp.now(),
    });
  }

  private async cancelShipmentWithFedex(
    trackingNumber: string,
  ): Promise<{
    transactionId?: string;
    warnings: string[];
  }> {
    if (FEDEX_CANCEL_SHIPMENT_METHOD !== "PUT") {
      throw new FedexShipError("Metodo FedEx Cancel Shipment no soportado", 500);
    }

    const response = await this.getClient().put<FedexCancelShipmentProviderResponse>(
      FEDEX_CANCEL_SHIPMENT_PATH,
      mapFedexCancelShipmentRequest({
        trackingNumber,
        deletionControl: FEDEX_CANCEL_DELETION_CONTROL,
      }),
    );
    const mapped = mapFedexCancelShipmentResponse(response);

    if (!mapped.cancelled) {
      throw new FedexShipError(
        mapped.message || "FedEx no confirmo la cancelacion de la guia",
        409,
      );
    }

    return {
      transactionId: mapped.transactionId,
      warnings: mapped.warnings,
    };
  }

  async cancelShipmentForOrder(
    orderId: string,
    input: FedexCancelShipmentInput,
    user?: { uid?: string },
  ): Promise<FedexCancelShipmentResult> {
    const db = this.getDb();
    const orderRef = db.collection(ORDERS_COLLECTION).doc(orderId);
    const orderDoc = await orderRef.get();
    const config = getFedexConfig();
    const warnings: string[] = [];

    if (!orderDoc.exists) {
      throw new FedexShipError("Orden no encontrada", 404);
    }

    const order = { id: orderDoc.id, ...(orderDoc.data() as Orden) };
    const shipping = getFedexOrderShippingState(order.shipping);

    if (shipping?.provider !== "FEDEX") {
      throw new FedexShipError("La orden no tiene envio FedEx", 400);
    }

    const trackingNumber = shipping.trackingNumber || order.numeroGuia;
    if (!trackingNumber) {
      throw new FedexShipError("La orden no tiene trackingNumber FedEx", 400);
    }

    if (shipping.status === "CANCELLED") {
      return {
        ok: true,
        provider: "FEDEX",
        environment: shipping.environment || config.environment,
        orderId,
        trackingNumber,
        status: "CANCELLED",
        cancelledAt: timestampToIso(shipping.cancelledAt),
        alreadyCancelled: true,
        warnings: [],
      };
    }

    if (
      shipping.status === "DELIVERED" ||
      shipping.trackingStatus?.status === "DELIVERED"
    ) {
      throw new FedexShipError("No se puede cancelar una guia ya entregada", 409);
    }

    if (input.forceRefreshTracking) {
      const tracking = await fedexTrackService.trackOrder({
        orderId,
        user,
        admin: true,
        forceRefresh: true,
        includeDetailedScans: false,
      });

      if (tracking.status === "DELIVERED") {
        throw new FedexShipError("No se puede cancelar una guia ya entregada", 409);
      }

      if (tracking.status === "OUT_FOR_DELIVERY") {
        throw new FedexShipError(
          "No se puede cancelar una guia que ya esta en reparto",
          409,
        );
      }

      if (tracking.status === "IN_TRANSIT" || tracking.status === "EXCEPTION") {
        warnings.push(
          "La guia ya tiene actividad FedEx; se intento cancelar con precaucion.",
        );
      }
    }

    if (isActivePickup(shipping.pickup)) {
      warnings.push(
        "La orden tiene una recoleccion FedEx activa; cancela el pickup por separado.",
      );
    }

    const cancelTrackingNumber = shipping.masterTrackingNumber || trackingNumber;

    try {
      const result = await this.cancelShipmentWithFedex(cancelTrackingNumber);
      const now = Timestamp.now();

      await orderRef.update({
        "shipping.status": "CANCELLED",
        "shipping.cancelledAt": now,
        "shipping.cancelledBy": user?.uid,
        "shipping.cancellationReason": input.reason,
        "shipping.cancelProvider": "FEDEX",
        "shipping.cancelTransactionId": result.transactionId,
        "shipping.updatedAt": now,
        updatedAt: now,
      });

      await this.writeShipmentCancelEvent({
        orderId,
        type: "FEDEX_SHIPMENT_CANCELLED",
        trackingNumber,
        reason: input.reason,
        createdBy: user?.uid,
        environment: config.environment,
      });

      return {
        ok: true,
        provider: "FEDEX",
        environment: config.environment,
        orderId,
        trackingNumber,
        status: "CANCELLED",
        cancelledAt: now.toDate().toISOString(),
        alreadyCancelled: false,
        warnings: [...warnings, ...result.warnings],
      };
    } catch (error) {
      await this.writeShipmentCancelEvent({
        orderId,
        type: "FEDEX_SHIPMENT_CANCEL_FAILED",
        trackingNumber,
        reason: input.reason,
        createdBy: user?.uid,
        errorMessageSeguro: toSafeEventErrorMessage(error),
        environment: config.environment,
      });

      if (
        error instanceof FedexProviderError &&
        isCannotCancelFedexError(error.message)
      ) {
        throw new FedexShipError(
          "FedEx ya no permite cancelar esta guia. Puede que el paquete ya haya sido procesado o recolectado.",
          409,
        );
      }

      throw error;
    }
  }

  async cancelSandboxTestShipment(
    input: FedexCancelTestShipmentInput,
  ): Promise<FedexCancelTestShipmentResult> {
    const config = getFedexConfig();

    if (config.environment !== "sandbox") {
      throw new FedexShipError("cancel-test solo esta disponible en sandbox", 403);
    }

    const result = await this.cancelShipmentWithFedex(input.trackingNumber);

    return {
      ok: true,
      provider: "FEDEX",
      environment: "sandbox",
      trackingNumber: input.trackingNumber,
      status: "CANCELLED",
      warnings: result.warnings,
    };
  }

  async createShipmentForOrder(
    orderId: string,
    input: FedexShipCreateInput = { labelImageType: "PDF" },
  ): Promise<FedexCreateShipmentResult> {
    const db = this.getDb();
    const orderRef = db.collection(ORDERS_COLLECTION).doc(orderId);
    const orderDoc = await orderRef.get();

    if (!orderDoc.exists) {
      throw new FedexShipError("Orden no encontrada", 404);
    }

    const orden = { id: orderDoc.id, ...(orderDoc.data() as Orden) };
    const shipping = getFedexOrderShippingState(orden.shipping);

    if (isExistingLabel(shipping, orden)) {
      return {
        ok: true,
        provider: "FEDEX",
        environment: shipping?.environment || getFedexConfig().environment,
        orderId,
        trackingNumber: shipping?.trackingNumber || orden.numeroGuia || "",
        masterTrackingNumber: shipping?.masterTrackingNumber,
        serviceType:
          shipping?.serviceType ||
          shipping?.selectedServiceType ||
          input.serviceType ||
          DEFAULT_SERVICE_TYPE,
        labelUrl: shipping?.labelUrl || null,
        labelStoragePath: shipping?.labelStoragePath || "",
        shipmentId: shipping?.shipmentId,
        alreadyCreated: true,
        warnings: [],
      };
    }

    if (orden.estado !== EstadoOrden.CONFIRMADA) {
      throw new FedexShipError("Solo se pueden generar guías de órdenes pagadas");
    }

    if (orden.fulfillmentMethod === FulfillmentMethod.PICKUP) {
      throw new FedexShipError("No se puede generar guía FedEx para órdenes pickup");
    }

    await this.assertOrderPaymentAllowsFedexLabel(orderId);

    if (
      shipping?.provider !== "FEDEX" ||
      !shipping.quoteId ||
      (shipping.status !== "QUOTE_SELECTED" && shipping.status !== "LABEL_FAILED")
    ) {
      throw new FedexShipError(
        "La orden requiere una cotización FedEx seleccionada para generar guía",
        409,
      );
    }

    const packages = assertPackages(shipping?.packages);
    const labelImageType: FedexLabelImageType = input.labelImageType || "PDF";
    const serviceType =
      shipping?.selectedServiceType || input.serviceType || DEFAULT_SERVICE_TYPE;
    const shipInput: FedexShipRequestInput = {
      orderId,
      serviceType,
      labelImageType,
      shipDate: currentShipDate(),
      recipient: buildRecipient(orden),
      packages,
    };
    const requestPayload = mapFedexShipRequest(shipInput);
    const response = await this.getClient().post<FedexShipResponse>(
      FEDEX_SHIP_PATH,
      requestPayload,
    );
    const shipment = mapFedexShipResponse(shipInput, response);
    const labelStoragePath = `shipping-labels/${orderId}/fedex-label.${labelImageType.toLowerCase()}`;

    try {
      await this.getBucket().file(labelStoragePath).save(shipment.labelBuffer, {
        metadata: {
          contentType: shipment.labelContentType,
        },
      });
    } catch (error) {
      throw new FedexShipError(
        "FedEx creó la guía, pero no fue posible guardar la etiqueta. Requiere revisión manual.",
        500,
      );
    }

    const config = getFedexConfig();
    const now = Timestamp.now();
    const shippingData: FedexOrderShippingState = {
      ...shipping,
      provider: "FEDEX",
      status: "LABEL_CREATED",
      environment: config.environment,
      accountNumberLast4: config.accountNumber.slice(-4),
      serviceType: shipment.serviceType,
      packagingType: "YOUR_PACKAGING",
      pickupType: "DROPOFF_AT_FEDEX_LOCATION",
      trackingNumber: shipment.trackingNumber,
      masterTrackingNumber: shipment.masterTrackingNumber,
      shipmentId: shipment.shipmentId,
      labelStoragePath,
      labelUrl: null,
      labelImageType,
      labelStockType: fedexLabelStockType,
      shipDate: shipInput.shipDate,
      recipient: shipInput.recipient,
      packages: shipment.packages,
      createdAt: shipping?.createdAt || now,
      updatedAt: now,
    };

    await orderRef.update({
      shipping: shippingData,
      numeroGuia: shipment.trackingNumber,
      transportista: "FEDEX",
      updatedAt: now,
    });

    await db.collection(SHIPPING_EVENTS_COLLECTION).add({
      orderId,
      provider: "FEDEX",
      type: "FEDEX_LABEL_CREATED",
      trackingNumber: shipment.trackingNumber,
      environment: config.environment,
      createdAt: now,
    });

    return {
      ok: true,
      provider: "FEDEX",
      environment: config.environment,
      orderId,
      trackingNumber: shipment.trackingNumber,
      masterTrackingNumber: shipment.masterTrackingNumber,
      serviceType: shipment.serviceType,
      labelUrl: null,
      labelStoragePath,
      shipmentId: shipment.shipmentId,
      warnings: shipment.warnings,
    };
  }

  async createSandboxTestLabel(
    input: FedexShipCreateInput = { labelImageType: "PDF" },
  ): Promise<Omit<FedexCreateShipmentResult, "orderId"> & { orderId: string }> {
    const config = getFedexConfig();
    if (config.environment === "production") {
      throw new FedexShipError("test-label is not available in production", 403);
    }

    const orderId = `fedex_test_${Date.now()}`;
    const shipInput: FedexShipRequestInput = {
      orderId,
      serviceType: input.serviceType || DEFAULT_SERVICE_TYPE,
      labelImageType: input.labelImageType || "PDF",
      shipDate: currentShipDate(),
      recipient: {
        name: "FedEx Test Recipient",
        phone: "4771234567",
        streetLines: [
          "Blvd Adolfo Lopez Mateos 1810",
          "Colonia La Martinica",
        ],
        city: "Leon",
        stateOrProvinceCode: "GUA",
        postalCode: "37500",
        countryCode: "MX",
        residential: true,
      },
      packages: [
        {
          weightKg: 1,
          lengthCm: 30,
          widthCm: 25,
          heightCm: 10,
        },
      ],
    };
    const response = await this.getClient().post<FedexShipResponse>(
      FEDEX_SHIP_PATH,
      mapFedexShipRequest(shipInput),
    );
    const shipment = mapFedexShipResponse(shipInput, response);
    const labelStoragePath = `shipping-labels/test/${orderId}/fedex-label.${shipInput.labelImageType.toLowerCase()}`;

    await this.getBucket().file(labelStoragePath).save(shipment.labelBuffer, {
      metadata: {
        contentType: shipment.labelContentType,
      },
    });

    return {
      ok: true,
      provider: "FEDEX",
      environment: config.environment,
      orderId,
      trackingNumber: shipment.trackingNumber,
      masterTrackingNumber: shipment.masterTrackingNumber,
      serviceType: shipment.serviceType,
      labelUrl: null,
      labelStoragePath,
      shipmentId: shipment.shipmentId,
      warnings: shipment.warnings,
    };
  }
}

export const fedexShipService = new FedexShipService();
