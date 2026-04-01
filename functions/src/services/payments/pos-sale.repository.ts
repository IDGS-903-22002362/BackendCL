import { Timestamp } from "firebase-admin/firestore";
import { firestoreTienda } from "../../config/firebase";
import { EstadoVentaPos, VentaPos } from "../../models/venta-pos.model";

export const POS_SALES_COLLECTION = "ventasPos";

export class PosSaleRepository {
  private readonly collection = firestoreTienda.collection(POS_SALES_COLLECTION);

  async create(sale: Omit<VentaPos, "id" | "createdAt" | "updatedAt">): Promise<VentaPos> {
    const now = Timestamp.now();
    const payload: Omit<VentaPos, "id"> = {
      ...sale,
      createdAt: now,
      updatedAt: now,
    };
    const docRef = await this.collection.add(payload);
    return {
      id: docRef.id,
      ...payload,
    };
  }

  async getById(id: string): Promise<VentaPos | null> {
    const snapshot = await this.collection.doc(id).get();
    if (!snapshot.exists) {
      return null;
    }

    return {
      id: snapshot.id,
      ...(snapshot.data() as VentaPos),
    };
  }

  async update(id: string, patch: Partial<VentaPos>): Promise<VentaPos> {
    await this.collection.doc(id).set(
      {
        ...patch,
        updatedAt: Timestamp.now(),
      },
      { merge: true },
    );

    const refreshed = await this.getById(id);
    if (!refreshed) {
      throw new Error(`Venta POS ${id} no encontrada`);
    }

    return refreshed;
  }

  async markStatus(
    id: string,
    status: EstadoVentaPos,
    patch?: Partial<VentaPos>,
  ): Promise<VentaPos> {
    const timestampKey =
      status === EstadoVentaPos.PAGADA
        ? "paidAt"
        : status === EstadoVentaPos.CANCELADA
          ? "canceledAt"
          : status === EstadoVentaPos.EXPIRADA
            ? "expiredAt"
            : undefined;

    const statusPatch: Record<string, unknown> = {
      status,
      ...(patch || {}),
    };

    if (timestampKey) {
      statusPatch[timestampKey] = Timestamp.now();
    }

    return this.update(id, statusPatch as Partial<VentaPos>);
  }
}

export const posSaleRepository = new PosSaleRepository();
export default posSaleRepository;
