import { Timestamp } from "firebase-admin/firestore";
import { firestoreTienda } from "../config/firebase";
import {
  CreatePickupLocationDTO,
  PickupAvailabilityItem,
  PickupAvailabilityResult,
  PickupLocation,
  UpdatePickupLocationDTO,
} from "../models/pickup-location.model";
import { Producto } from "../models/producto.model";
import {
  completeInventarioPorTalla,
  normalizeTallaIds,
} from "../utils/size-inventory.util";

const PICKUP_LOCATIONS_COLLECTION = "pickupLocations";
const CARRITOS_COLLECTION = "carritos";
const PRODUCTOS_COLLECTION = "productos";

export class PickupLocationService {
  async create(data: CreatePickupLocationDTO): Promise<PickupLocation> {
    const now = Timestamp.now();
    const payload: Omit<PickupLocation, "id"> = {
      ...data,
      createdAt: now,
      updatedAt: now,
    };
    const ref = await firestoreTienda
      .collection(PICKUP_LOCATIONS_COLLECTION)
      .add(payload);
    return { id: ref.id, ...payload };
  }

  async update(id: string, data: UpdatePickupLocationDTO): Promise<PickupLocation> {
    const ref = firestoreTienda.collection(PICKUP_LOCATIONS_COLLECTION).doc(id);
    const snapshot = await ref.get();
    if (!snapshot.exists) {
      throw new Error(`Sucursal pickup con ID "${id}" no encontrada`);
    }

    const patch = {
      ...data,
      updatedAt: Timestamp.now(),
    };
    await ref.set(patch, { merge: true });
    return {
      id,
      ...(snapshot.data() as PickupLocation),
      ...patch,
    };
  }

  async deactivate(id: string): Promise<PickupLocation> {
    return this.update(id, { active: false });
  }

  async getById(id: string): Promise<PickupLocation | null> {
    const snapshot = await firestoreTienda
      .collection(PICKUP_LOCATIONS_COLLECTION)
      .doc(id)
      .get();
    if (!snapshot.exists) {
      return null;
    }
    return { id: snapshot.id, ...(snapshot.data() as PickupLocation) };
  }

  async requireActivePickupLocation(id: string): Promise<PickupLocation> {
    const location = await this.getById(id);
    if (!location) {
      throw new Error(`Sucursal pickup con ID "${id}" no encontrada`);
    }
    if (!location.active) {
      throw new Error(`La sucursal pickup "${location.name}" está inactiva`);
    }
    if (!location.pickupEnabled) {
      throw new Error(`La sucursal "${location.name}" no permite pickup`);
    }
    return location;
  }

  async listPublic(): Promise<PickupLocation[]> {
    const snapshot = await firestoreTienda
      .collection(PICKUP_LOCATIONS_COLLECTION)
      .where("active", "==", true)
      .where("pickupEnabled", "==", true)
      .get();
    return snapshot.docs.map((doc) => ({
      id: doc.id,
      ...(doc.data() as PickupLocation),
    }));
  }

  private resolveAvailabilityForProduct(input: {
    productoId: string;
    cantidad: number;
    tallaId?: string;
    producto?: Producto;
  }): PickupAvailabilityItem {
    const unavailable = (reason: string, availableQuantity?: number) => ({
      productoId: input.productoId,
      tallaId: input.tallaId,
      requestedQuantity: input.cantidad,
      availableQuantity,
      available: false,
      reason,
    });

    if (!input.producto) {
      return unavailable("PRODUCT_NOT_FOUND", 0);
    }

    if (!input.producto.activo) {
      return unavailable("PRODUCT_INACTIVE", 0);
    }

    const tallaIds = normalizeTallaIds(input.producto.tallaIds);
    if (tallaIds.length === 0) {
      if (input.tallaId?.trim()) {
        return unavailable("PRODUCT_DOES_NOT_USE_SIZE_INVENTORY", 0);
      }
      const availableQuantity = Math.max(
        0,
        Math.floor(Number(input.producto.existencias ?? 0)),
      );
      return {
        productoId: input.productoId,
        requestedQuantity: input.cantidad,
        availableQuantity,
        available: availableQuantity >= input.cantidad,
        reason: availableQuantity >= input.cantidad ? undefined : "INSUFFICIENT_STOCK",
      };
    }

    const tallaId = input.tallaId?.trim();
    if (!tallaId) {
      return unavailable("SIZE_REQUIRED", 0);
    }
    if (!tallaIds.includes(tallaId)) {
      return unavailable("SIZE_NOT_VALID_FOR_PRODUCT", 0);
    }

    const inventory = completeInventarioPorTalla(
      tallaIds,
      input.producto.inventarioPorTalla,
    );
    const availableQuantity =
      inventory.find((item) => item.tallaId === tallaId)?.cantidad ?? 0;
    return {
      productoId: input.productoId,
      tallaId,
      requestedQuantity: input.cantidad,
      availableQuantity,
      available: availableQuantity >= input.cantidad,
      reason: availableQuantity >= input.cantidad ? undefined : "INSUFFICIENT_STOCK",
    };
  }

  async validateCartAvailability(
    pickupLocationId: string,
    cartId: string,
  ): Promise<PickupAvailabilityResult> {
    await this.requireActivePickupLocation(pickupLocationId);

    const cartSnapshot = await firestoreTienda
      .collection(CARRITOS_COLLECTION)
      .doc(cartId)
      .get();
    if (!cartSnapshot.exists) {
      throw new Error(`Carrito con ID "${cartId}" no encontrado`);
    }

    const cart = cartSnapshot.data() as {
      items?: Array<{ productoId: string; cantidad: number; tallaId?: string }>;
    };
    const items = cart.items || [];
    if (items.length === 0) {
      throw new Error("El carrito está vacío");
    }

    const productDocs = await Promise.all(
      [...new Set(items.map((item) => item.productoId))].map((productoId) =>
        firestoreTienda.collection(PRODUCTOS_COLLECTION).doc(productoId).get(),
      ),
    );
    const products = new Map<string, Producto>();
    productDocs.forEach((doc) => {
      if (doc.exists) {
        products.set(doc.id, doc.data() as Producto);
      }
    });

    const availability = items.map((item) =>
      this.resolveAvailabilityForProduct({
        ...item,
        producto: products.get(item.productoId),
      }),
    );
    const availableItems = availability.filter((item) => item.available);
    const unavailableItems = availability.filter((item) => !item.available);

    return {
      canPickup: unavailableItems.length === 0,
      pickupLocationId,
      inventoryScope: "global",
      availableItems,
      unavailableItems,
    };
  }
}

export const pickupLocationService = new PickupLocationService();
export default pickupLocationService;
