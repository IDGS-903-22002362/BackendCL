import { firestoreApp } from "../config/app.firebase";
import { admin } from "../config/firebase.admin";
import {
  ActualizarBeneficioDTO,
  CrearBeneficioDTO,
} from "../models/beneficios.dto";
import { Beneficio } from "../models/beneficios.model";

const BENEFICIOS_COLLECTION = "beneficios";

export class BeneficioService {
  private collection = firestoreApp.collection(BENEFICIOS_COLLECTION);

  private normalizeDate(value: unknown): Date {
    if (!value) return new Date();

    if (
      typeof value === "object" &&
      value !== null &&
      "toDate" in value &&
      typeof (value as { toDate: () => Date }).toDate === "function"
    ) {
      return (value as { toDate: () => Date }).toDate();
    }

    if (value instanceof Date) return value;

    return new Date(value as string | number);
  }

  private mapDocToBeneficio(
    doc: FirebaseFirestore.DocumentSnapshot,
  ): Beneficio {
    const data = doc.data()!;

    return {
      id: doc.id,
      titulo: data.titulo,
      descripcion: data.descripcion,
      estatus: data.estatus,
      createdAt: this.normalizeDate(data.createdAt),
      updatedAt: this.normalizeDate(data.updatedAt),
    };
  }

  private convertDatesToTimestamp<T extends object>(data: T) {
    const converted = { ...data };

    if ("createdAt" in data && data.createdAt instanceof Date) {
      (converted as Record<string, unknown>).createdAt =
        admin.firestore.Timestamp.fromDate(data.createdAt);
    }

    if ("updatedAt" in data && data.updatedAt instanceof Date) {
      (converted as Record<string, unknown>).updatedAt =
        admin.firestore.Timestamp.fromDate(data.updatedAt);
    }

    return converted;
  }

  async getAllBeneficios(): Promise<Beneficio[]> {
    const snapshot = await this.collection.get();
    return snapshot.docs.map((doc) => this.mapDocToBeneficio(doc));
  }

  async getBeneficioById(id: string): Promise<Beneficio | null> {
    const doc = await this.collection.doc(id).get();

    if (!doc.exists) {
      return null;
    }

    return this.mapDocToBeneficio(doc);
  }

  async createBeneficio(dto: CrearBeneficioDTO): Promise<Beneficio> {
    const now = new Date();
    const docRef = this.collection.doc();

    const beneficio: Beneficio = {
      id: docRef.id,
      titulo: dto.titulo,
      descripcion: dto.descripcion,
      estatus: dto.estatus,
      createdAt: now,
      updatedAt: now,
    };

    await docRef.set(this.convertDatesToTimestamp(beneficio));

    return beneficio;
  }

  async updateBeneficio(
    id: string,
    dto: ActualizarBeneficioDTO,
  ): Promise<Beneficio> {
    const docRef = this.collection.doc(id);
    const snapshot = await docRef.get();

    if (!snapshot.exists) {
      throw new Error(`Beneficio con ID ${id} no encontrado`);
    }

    const updateData = {
      ...dto,
      updatedAt: new Date(),
    };

    await docRef.update(this.convertDatesToTimestamp(updateData));

    const updatedDoc = await docRef.get();
    return this.mapDocToBeneficio(updatedDoc);
  }

  async deleteBeneficio(id: string): Promise<void> {
    const docRef = this.collection.doc(id);
    const snapshot = await docRef.get();

    if (!snapshot.exists) {
      throw new Error(`Beneficio con ID ${id} no encontrado`);
    }

    await docRef.update({
      estatus: false,
      updatedAt: admin.firestore.Timestamp.now(),
    });
  }
}

export default new BeneficioService();