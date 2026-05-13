import { Timestamp } from "firebase-admin/firestore";
import { RolUsuario } from "../../../models/usuario.model";
import { FedexAuthService } from "./fedex-auth.service";
import { FedexClient } from "./fedex-client";
import { getFedexTrackConfig } from "./fedex.config";
import {
  mapFedexTrackRequest,
  mapFedexTrackResponse,
} from "./fedex-track.mapper";
import {
  FedexTrackDirectInput,
  fedexTrackDirectSchema,
  FedexTrackResponse,
  FedexTrackingResult,
  FedexTrackingSnapshot,
} from "./fedex-track.types";

const ORDERS_COLLECTION = "ordenes";
const SHIPPING_EVENTS_COLLECTION = "shipping_events";
const FEDEX_TRACK_PATH = "/track/v1/trackingnumbers";
const CUSTOMER_CACHE_MS = 15 * 60 * 1000;
const DELIVERED_CACHE_MS = 24 * 60 * 60 * 1000;

type FirestoreLike = FirebaseFirestore.Firestore;

type FedexClientLike = {
  post<T = unknown>(path: string, data?: unknown): Promise<T>;
};

type TrackingOrder = {
  id?: string;
  usuarioId?: string;
  shipping?: {
    provider?: string;
    status?: string;
    trackingNumber?: string;
    trackingStatus?: FedexTrackingSnapshot;
    updatedAt?: FirebaseFirestore.Timestamp;
  };
};

export class FedexTrackError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "FedexTrackError";
    this.statusCode = statusCode;
    Error.captureStackTrace(this, this.constructor);
  }
}

export const fedexTrackAuthService = new FedexAuthService(getFedexTrackConfig);
export const fedexTrackClient = new FedexClient(
  fedexTrackAuthService,
  getFedexTrackConfig,
);

const isPrivileged = (user?: { rol?: RolUsuario | string }): boolean =>
  user?.rol === RolUsuario.ADMIN || user?.rol === RolUsuario.EMPLEADO;

const timestampToMillis = (value: unknown): number | undefined => {
  if (!value) {
    return undefined;
  }

  if (value instanceof Timestamp) {
    return value.toMillis();
  }

  const maybeTimestamp = value as { toMillis?: () => number; seconds?: number };
  if (typeof maybeTimestamp.toMillis === "function") {
    return maybeTimestamp.toMillis();
  }
  if (typeof maybeTimestamp.seconds === "number") {
    return maybeTimestamp.seconds * 1000;
  }

  return undefined;
};

const shouldUseCache = (
  snapshot: FedexTrackingSnapshot | undefined,
  forceRefresh: boolean,
): boolean => {
  if (!snapshot || forceRefresh) {
    return false;
  }

  const updatedAt = timestampToMillis(snapshot.lastUpdatedAt);
  if (!updatedAt) {
    return false;
  }

  const maxAge =
    snapshot.status === "DELIVERED" ? DELIVERED_CACHE_MS : CUSTOMER_CACHE_MS;

  return Date.now() - updatedAt < maxAge;
};

const snapshotToResult = (
  orderId: string,
  trackingNumber: string,
  snapshot: FedexTrackingSnapshot,
): FedexTrackingResult => ({
  ok: true,
  provider: "FEDEX",
  orderId,
  trackingNumber,
  status: snapshot.status,
  statusLabel: snapshot.statusLabel,
  ...(snapshot.statusDescription
    ? { statusDescription: snapshot.statusDescription }
    : {}),
  lastUpdatedAt: snapshot.lastCarrierUpdateAt,
  ...(snapshot.estimatedDeliveryDate
    ? { estimatedDeliveryDate: snapshot.estimatedDeliveryDate }
    : {}),
  deliveredAt: snapshot.deliveredAt || null,
  ...(snapshot.lastLocation ? { lastLocation: snapshot.lastLocation } : {}),
  events: [],
  ...(snapshot.rawStatusCode ? { rawStatusCode: snapshot.rawStatusCode } : {}),
  warnings: [],
});

const buildSnapshot = (result: FedexTrackingResult): FedexTrackingSnapshot => ({
  provider: "FEDEX",
  status: result.status,
  statusLabel: result.statusLabel,
  rawStatusCode: result.rawStatusCode,
  statusDescription: result.statusDescription,
  estimatedDeliveryDate: result.estimatedDeliveryDate,
  deliveredAt: result.deliveredAt || null,
  lastUpdatedAt: Timestamp.now(),
  lastCarrierUpdateAt: result.lastUpdatedAt,
  lastEventTimestamp: result.events[0]?.timestamp,
  lastLocation: result.lastLocation,
});

export class FedexTrackService {
  constructor(
    private readonly db?: FirestoreLike,
    private readonly client: FedexClientLike = fedexTrackClient,
  ) {}

  private getDb(): FirestoreLike {
    if (this.db) {
      return this.db;
    }

    return require("../../../config/firebase").firestoreTienda as FirestoreLike;
  }

  async trackNumbers(input: FedexTrackDirectInput): Promise<FedexTrackingResult[]> {
    const parsed = fedexTrackDirectSchema.parse(input);
    const response = await this.client.post<FedexTrackResponse>(
      FEDEX_TRACK_PATH,
      mapFedexTrackRequest(parsed),
    );

    return parsed.trackingNumbers.map((trackingNumber) =>
      mapFedexTrackResponse(trackingNumber, response),
    );
  }

  async trackOrder(input: {
    orderId: string;
    user?: { uid?: string; rol?: RolUsuario | string };
    admin: boolean;
    forceRefresh?: boolean;
    includeDetailedScans?: boolean;
  }): Promise<FedexTrackingResult> {
    const db = this.getDb();
    const orderRef = db.collection(ORDERS_COLLECTION).doc(input.orderId);
    const orderDoc = await orderRef.get();

    if (!orderDoc.exists) {
      throw new FedexTrackError("Orden no encontrada", 404);
    }

    const order = {
      id: orderDoc.id,
      ...(orderDoc.data() as TrackingOrder),
    };

    if (
      !input.admin &&
      order.usuarioId !== input.user?.uid &&
      !isPrivileged(input.user)
    ) {
      throw new FedexTrackError("No tienes permisos para rastrear esta orden", 403);
    }

    if (order.shipping?.provider !== "FEDEX") {
      throw new FedexTrackError("La orden no tiene envío FedEx", 400);
    }

    const trackingNumber = order.shipping.trackingNumber;
    if (!trackingNumber) {
      throw new FedexTrackError("La orden no tiene trackingNumber FedEx", 400);
    }

    const cached = order.shipping.trackingStatus;
    if (!input.admin && shouldUseCache(cached, Boolean(input.forceRefresh))) {
      return snapshotToResult(input.orderId, trackingNumber, cached!);
    }

    if (
      input.admin !== true &&
      cached?.status === "DELIVERED" &&
      shouldUseCache(cached, Boolean(input.forceRefresh))
    ) {
      return snapshotToResult(input.orderId, trackingNumber, cached);
    }

    const result = (
      await this.trackNumbers({
        trackingNumbers: [trackingNumber],
        includeDetailedScans: Boolean(input.includeDetailedScans),
      })
    )[0];
    const withOrderId = {
      ...result,
      orderId: input.orderId,
    };
    const snapshot = buildSnapshot(withOrderId);
    const previous = order.shipping.trackingStatus;
    const statusChanged = previous?.status !== snapshot.status;
    const eventChanged =
      previous?.lastEventTimestamp !== snapshot.lastEventTimestamp &&
      Boolean(snapshot.lastEventTimestamp);

    await orderRef.update({
      "shipping.trackingStatus": snapshot,
      "shipping.status": snapshot.status,
      "shipping.updatedAt": Timestamp.now(),
    });

    if (statusChanged || eventChanged) {
      await db.collection(SHIPPING_EVENTS_COLLECTION).add({
        orderId: input.orderId,
        provider: "FEDEX",
        type: "FEDEX_TRACKING_REFRESHED",
        trackingNumber,
        status: snapshot.status,
        rawStatusCode: snapshot.rawStatusCode,
        createdAt: Timestamp.now(),
      });
    }

    return withOrderId;
  }
}

export const fedexTrackService = new FedexTrackService();
