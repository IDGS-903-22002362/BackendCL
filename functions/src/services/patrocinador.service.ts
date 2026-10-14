import { firestoreApp } from "../config/app.firebase";
import { admin } from "../config/firebase.admin";
import {
  ActualizarPatrocinadorDTO,
  CrearPatrocinadorDTO,
} from "../models/patrocinadores.dto";
import {
  Patrocinador,
  PatrocinadorLogoVariante,
} from "../models/patrocinadores.model";

const PATROCINADORES_COLLECTION = "patrocinadores";

const logoFieldByVariante: Record<
  PatrocinadorLogoVariante,
  "imagenBlanca" | "imagenNegra" | "imagen"
> = {
  blanca: "imagenBlanca",
  negra: "imagenNegra",
  exclusiva: "imagen",
};

export class PatrocinadorService {
  private collection = firestoreApp.collection(PATROCINADORES_COLLECTION);

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

  private readString(value: unknown): string | undefined {
    return typeof value === "string" && value.trim().length > 0
      ? value.trim()
      : undefined;
  }

  private readHttpUrl(value: unknown): string | undefined {
    const text = this.readString(value);
    if (!text) {
      return undefined;
    }

    try {
      const parsed = new URL(text);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return undefined;
      }
      return text;
    } catch {
      return undefined;
    }
  }

  private readSponsorUrl(value: unknown): string | undefined {
    if (value === undefined || value === null) {
      return undefined;
    }

    if (typeof value !== "string") {
      throw new Error("La URL debe usar http o https");
    }

    if (!value.trim()) {
      return undefined;
    }

    const url = this.readHttpUrl(value);
    if (!url) {
      throw new Error("La URL debe usar http o https");
    }

    return url;
  }

  private collectMediaUrls(patrocinador: Patrocinador): string[] {
    return [
      patrocinador.imagenBlanca,
      patrocinador.imagenNegra,
      patrocinador.imagen,
    ].filter((url, index, list): url is string => {
      return Boolean(url) && list.indexOf(url) === index;
    });
  }

  private mapDocToPatrocinador(
    doc: FirebaseFirestore.DocumentSnapshot,
  ): Patrocinador {
    const data = doc.data()!;

    return {
      id: doc.id,
      nombre: data.nombre,
      imagenBlanca: this.readString(data.imagenBlanca),
      imagenNegra: this.readString(data.imagenNegra),
      imagen: this.readString(data.imagen),
      url: this.readHttpUrl(data.url),
      exclusivo: data.exclusivo === true,
      estatus: data.estatus === true,
      createdAt: this.normalizeDate(data.createdAt),
      updatedAt: this.normalizeDate(data.updatedAt),
    };
  }

  serializePatrocinadorForApi(patrocinador: Patrocinador) {
    return {
      id: patrocinador.id,
      nombre: patrocinador.nombre,
      ...(patrocinador.imagenBlanca
        ? { imagenBlanca: patrocinador.imagenBlanca }
        : {}),
      ...(patrocinador.imagenNegra
        ? { imagenNegra: patrocinador.imagenNegra }
        : {}),
      ...(patrocinador.imagen ? { imagen: patrocinador.imagen } : {}),
      ...(patrocinador.url ? { url: patrocinador.url } : {}),
      exclusivo: patrocinador.exclusivo === true,
      estatus: patrocinador.estatus === true,
      createdAt: patrocinador.createdAt,
      updatedAt: patrocinador.updatedAt,
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

  async getAllPatrocinadores(): Promise<Patrocinador[]> {
    const snapshot = await this.collection.get();
    return snapshot.docs
      .map((doc) => this.mapDocToPatrocinador(doc))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async getPatrocinadorById(id: string): Promise<Patrocinador | null> {
    const doc = await this.collection.doc(id).get();

    if (!doc.exists) {
      return null;
    }

    return this.mapDocToPatrocinador(doc);
  }

  async createPatrocinador(dto: CrearPatrocinadorDTO): Promise<Patrocinador> {
    const now = new Date();
    const docRef = this.collection.doc();

    const url = this.readSponsorUrl(dto.url);
    const patrocinador: Patrocinador = {
      id: docRef.id,
      nombre: dto.nombre.trim(),
      ...(url ? { url } : {}),
      exclusivo: dto.exclusivo === true,
      estatus: dto.estatus ?? true,
      createdAt: now,
      updatedAt: now,
    };

    await docRef.set(this.convertDatesToTimestamp(patrocinador));

    if (patrocinador.exclusivo) {
      await this.unsetOtherExclusivos(docRef.id);
    }

    return patrocinador;
  }

  async updatePatrocinador(
    id: string,
    dto: ActualizarPatrocinadorDTO,
  ): Promise<Patrocinador> {
    const docRef = this.collection.doc(id);
    const snapshot = await docRef.get();

    if (!snapshot.exists) {
      throw new Error(`Patrocinador con ID ${id} no encontrado`);
    }

    const updateData: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    if (dto.nombre !== undefined) {
      updateData.nombre = dto.nombre.trim();
    }

    if (dto.estatus !== undefined) {
      updateData.estatus = dto.estatus;
    }

    if (dto.exclusivo !== undefined) {
      updateData.exclusivo = dto.exclusivo;
    }

    if (dto.url !== undefined) {
      const url = this.readSponsorUrl(dto.url);
      updateData.url = url ?? admin.firestore.FieldValue.delete();
    }

    await docRef.update(this.convertDatesToTimestamp(updateData));

    if (dto.exclusivo === true) {
      await this.unsetOtherExclusivos(id);
    }

    const updatedDoc = await docRef.get();
    return this.mapDocToPatrocinador(updatedDoc);
  }

  async updatePatrocinadorImagen(
    id: string,
    url: string,
    variante: PatrocinadorLogoVariante,
  ): Promise<{ patrocinador: Patrocinador; previousImagen?: string }> {
    const sanitizedUrl = url.trim();
    if (!sanitizedUrl) {
      throw new Error("No se recibio una URL de imagen valida");
    }

    const field = logoFieldByVariante[variante];
    const docRef = this.collection.doc(id);
    const snapshot = await docRef.get();

    if (!snapshot.exists) {
      throw new Error(`Patrocinador con ID ${id} no encontrado`);
    }

    const previousImagen = this.readString(snapshot.data()?.[field]);

    await docRef.update({
      [field]: sanitizedUrl,
      updatedAt: admin.firestore.Timestamp.now(),
    });

    const updatedDoc = await docRef.get();
    return {
      patrocinador: this.mapDocToPatrocinador(updatedDoc),
      previousImagen:
        previousImagen && previousImagen !== sanitizedUrl
          ? previousImagen
          : undefined,
    };
  }

  async clearPatrocinadorImagen(
    id: string,
    variante: PatrocinadorLogoVariante,
  ): Promise<{ patrocinador: Patrocinador; previousImagen?: string }> {
    const field = logoFieldByVariante[variante];
    const docRef = this.collection.doc(id);
    const snapshot = await docRef.get();

    if (!snapshot.exists) {
      throw new Error(`Patrocinador con ID ${id} no encontrado`);
    }

    const previousImagen = this.readString(snapshot.data()?.[field]);

    await docRef.update({
      [field]: admin.firestore.FieldValue.delete(),
      updatedAt: admin.firestore.Timestamp.now(),
    });

    const updatedDoc = await docRef.get();
    return {
      patrocinador: this.mapDocToPatrocinador(updatedDoc),
      previousImagen,
    };
  }

  private async unsetOtherExclusivos(keepId: string): Promise<void> {
    const snapshot = await this.collection.where("exclusivo", "==", true).get();
    const others = snapshot.docs.filter((doc) => doc.id !== keepId);

    if (others.length === 0) {
      return;
    }

    const batch = this.collection.firestore.batch();
    const now = admin.firestore.Timestamp.now();

    for (const doc of others) {
      batch.update(doc.ref, {
        exclusivo: false,
        updatedAt: now,
      });
    }

    await batch.commit();
  }

  async deletePatrocinador(id: string): Promise<void> {
    const docRef = this.collection.doc(id);
    const snapshot = await docRef.get();

    if (!snapshot.exists) {
      throw new Error(`Patrocinador con ID ${id} no encontrado`);
    }

    await docRef.update({
      estatus: false,
      updatedAt: admin.firestore.Timestamp.now(),
    });
  }

  async permanentlyDeletePatrocinador(id: string): Promise<string[]> {
    const docRef = this.collection.doc(id);
    const snapshot = await docRef.get();

    if (!snapshot.exists) {
      throw new Error(`Patrocinador con ID ${id} no encontrado`);
    }

    const patrocinador = this.mapDocToPatrocinador(snapshot);
    const mediaUrls = this.collectMediaUrls(patrocinador);

    await docRef.delete();

    return mediaUrls;
  }
}

export default new PatrocinadorService();
