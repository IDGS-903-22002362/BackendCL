import { firestoreApp } from "../config/app.firebase";
import { admin } from "../config/firebase.admin";
import {
  ActualizarBeneficioDTO,
  CrearBeneficioDTO,
} from "../models/beneficios.dto";
import {
  Beneficio,
  BeneficioClaimResult,
  BeneficioMediaTipo,
  BeneficioRedireccion,
  BENEFICIO_DESTINOS,
  MAX_BENEFICIO_IMAGENES,
  MAX_BENEFICIO_PUNTOS_RECOMPENSA,
} from "../models/beneficios.model";
import loyaltyEngineService from "../modules/loyalty/services/loyalty-engine.service";

const BENEFICIOS_COLLECTION = "beneficios";
const USUARIOS_COLLECTION = "usuariosApp";
const BENEFICIOS_RECLAMADOS_SUBCOLLECTION = "beneficios_reclamados";

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

  private readString(value: unknown): string | undefined {
    return typeof value === "string" && value.trim().length > 0
      ? value.trim()
      : undefined;
  }

  private readImagenes(data: Record<string, unknown>): string[] {
    const rawImagenes = data.imagenes;
    if (Array.isArray(rawImagenes)) {
      return rawImagenes
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter((item) => item.length > 0);
    }

    const single = this.readString(data.imagen);
    return single ? [single] : [];
  }

  private readPuntosRecompensa(value: unknown): number {
    if (typeof value === "number" && Number.isFinite(value)) {
      return Math.min(
        MAX_BENEFICIO_PUNTOS_RECOMPENSA,
        Math.max(0, Math.floor(value)),
      );
    }

    if (typeof value === "string" && value.trim().length > 0) {
      const parsed = Number.parseInt(value.trim(), 10);
      if (Number.isFinite(parsed)) {
        return Math.min(
          MAX_BENEFICIO_PUNTOS_RECOMPENSA,
          Math.max(0, parsed),
        );
      }
    }

    return 0;
  }

  private readMediaTipo(value: unknown): BeneficioMediaTipo | undefined {
    return value === "imagen" || value === "video" ? value : undefined;
  }

  private readRedireccion(value: unknown): BeneficioRedireccion | undefined {
    if (!value || typeof value !== "object") {
      return undefined;
    }

    const data = value as Record<string, unknown>;
    const modulo = data.modulo;

    if (typeof modulo !== "string") {
      return undefined;
    }

    if (!(BENEFICIO_DESTINOS as readonly string[]).includes(modulo)) {
      return { modulo: "none" };
    }

    return {
      modulo: modulo as BeneficioRedireccion["modulo"],
    };
  }

  collectMediaUrls(beneficio: Beneficio): string[] {
    const imagenes =
      beneficio.imagenes && beneficio.imagenes.length > 0
        ? beneficio.imagenes
        : beneficio.imagen
          ? [beneficio.imagen]
          : [];

    return [
      ...imagenes,
      ...(beneficio.video?.trim() ? [beneficio.video.trim()] : []),
    ];
  }

  private mapDocToBeneficio(
    doc: FirebaseFirestore.DocumentSnapshot,
  ): Beneficio {
    const data = doc.data()!;
    const imagenes = this.readImagenes(data);

    return {
      id: doc.id,
      titulo: data.titulo,
      descripcion: data.descripcion,
      imagenes,
      imagen: imagenes[0],
      video: this.readString(data.video),
      mediaTipo: this.readMediaTipo(data.mediaTipo),
      redireccion: this.readRedireccion(data.redireccion),
      puntosRecompensa: this.readPuntosRecompensa(data.puntosRecompensa),
      estatus: data.estatus === true,
      createdAt: this.normalizeDate(data.createdAt),
      updatedAt: this.normalizeDate(data.updatedAt),
    };
  }

  /** Respuesta estable para mobile/admin: siempre incluye puntos e imágenes. */
  serializeBeneficioForApi(beneficio: Beneficio) {
    const imagenes =
      beneficio.imagenes && beneficio.imagenes.length > 0
        ? beneficio.imagenes
        : beneficio.imagen
          ? [beneficio.imagen]
          : [];
    const puntosRecompensa = this.readPuntosRecompensa(
      beneficio.puntosRecompensa,
    );
    const mediaTipo =
      beneficio.mediaTipo ??
      (beneficio.video ? "video" : imagenes.length > 0 ? "imagen" : undefined);

    return {
      id: beneficio.id,
      titulo: beneficio.titulo,
      descripcion: beneficio.descripcion,
      imagenes,
      ...(imagenes[0] ? { imagen: imagenes[0] } : {}),
      ...(beneficio.video ? { video: beneficio.video } : {}),
      ...(mediaTipo ? { mediaTipo } : {}),
      ...(beneficio.redireccion ? { redireccion: beneficio.redireccion } : {}),
      puntosRecompensa,
      estatus: beneficio.estatus === true,
      createdAt: beneficio.createdAt,
      updatedAt: beneficio.updatedAt,
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
      ...(dto.redireccion ? { redireccion: dto.redireccion } : {}),
      puntosRecompensa: this.readPuntosRecompensa(dto.puntosRecompensa ?? 0),
      estatus: dto.estatus ?? true,
      createdAt: now,
      updatedAt: now,
    };

    await docRef.set({
      ...this.convertDatesToTimestamp(beneficio),
      puntosRecompensa: beneficio.puntosRecompensa ?? 0,
    });

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
      ...(dto.puntosRecompensa !== undefined
        ? { puntosRecompensa: this.readPuntosRecompensa(dto.puntosRecompensa) }
        : {}),
      updatedAt: new Date(),
    };

    await docRef.update(this.convertDatesToTimestamp(updateData));

    const updatedDoc = await docRef.get();
    return this.mapDocToBeneficio(updatedDoc);
  }

  async appendBeneficioImagenes(
    id: string,
    urls: string[],
  ): Promise<Beneficio> {
    const docRef = this.collection.doc(id);
    const snapshot = await docRef.get();

    if (!snapshot.exists) {
      throw new Error(`Beneficio con ID ${id} no encontrado`);
    }

    const sanitizedUrls = urls
      .map((url) => url.trim())
      .filter((url) => url.length > 0);

    if (sanitizedUrls.length === 0) {
      throw new Error("No se recibieron URLs de imagen validas");
    }

    const current = this.readImagenes(snapshot.data()!);
    const merged = [...current, ...sanitizedUrls];

    if (merged.length > MAX_BENEFICIO_IMAGENES) {
      throw new Error(
        `Un beneficio puede tener maximo ${MAX_BENEFICIO_IMAGENES} imagenes`,
      );
    }

    await docRef.update({
      imagenes: merged,
      imagen: admin.firestore.FieldValue.delete(),
      video: admin.firestore.FieldValue.delete(),
      mediaTipo: "imagen",
      updatedAt: admin.firestore.Timestamp.now(),
    });

    const updatedDoc = await docRef.get();
    return this.mapDocToBeneficio(updatedDoc);
  }

  async updateBeneficioMedia(
    id: string,
    mediaTipo: BeneficioMediaTipo,
    url: string,
  ): Promise<Beneficio> {
    if (mediaTipo === "imagen") {
      return this.appendBeneficioImagenes(id, [url]);
    }

    const docRef = this.collection.doc(id);
    const snapshot = await docRef.get();

    if (!snapshot.exists) {
      throw new Error(`Beneficio con ID ${id} no encontrado`);
    }

    await docRef.update({
      video: url,
      imagen: admin.firestore.FieldValue.delete(),
      imagenes: admin.firestore.FieldValue.delete(),
      mediaTipo: "video",
      updatedAt: admin.firestore.Timestamp.now(),
    });

    const updatedDoc = await docRef.get();
    return this.mapDocToBeneficio(updatedDoc);
  }

  async removeBeneficioImagen(id: string, url: string): Promise<Beneficio> {
    const docRef = this.collection.doc(id);
    const snapshot = await docRef.get();

    if (!snapshot.exists) {
      throw new Error(`Beneficio con ID ${id} no encontrado`);
    }

    const targetUrl = url.trim();
    const current = this.readImagenes(snapshot.data()!);
    const next = current.filter((item) => item !== targetUrl);

    if (next.length === current.length) {
      throw new Error("La imagen indicada no pertenece al beneficio");
    }

    if (next.length === 0) {
      return this.clearBeneficioMedia(id);
    }

    await docRef.update({
      imagenes: next,
      imagen: admin.firestore.FieldValue.delete(),
      mediaTipo: "imagen",
      updatedAt: admin.firestore.Timestamp.now(),
    });

    const updatedDoc = await docRef.get();
    return this.mapDocToBeneficio(updatedDoc);
  }

  async clearBeneficioMedia(id: string): Promise<Beneficio> {
    const docRef = this.collection.doc(id);
    const snapshot = await docRef.get();

    if (!snapshot.exists) {
      throw new Error(`Beneficio con ID ${id} no encontrado`);
    }

    await docRef.update({
      imagen: admin.firestore.FieldValue.delete(),
      imagenes: admin.firestore.FieldValue.delete(),
      video: admin.firestore.FieldValue.delete(),
      mediaTipo: admin.firestore.FieldValue.delete(),
      updatedAt: admin.firestore.Timestamp.now(),
    });

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

  async permanentlyDeleteBeneficio(id: string): Promise<string[]> {
    const docRef = this.collection.doc(id);
    const snapshot = await docRef.get();

    if (!snapshot.exists) {
      throw new Error(`Beneficio con ID ${id} no encontrado`);
    }

    const beneficio = this.mapDocToBeneficio(snapshot);
    const mediaUrls = this.collectMediaUrls(beneficio);

    await docRef.delete();

    return mediaUrls;
  }

  private reclamosCollection(memberId: string) {
    return firestoreApp
      .collection(USUARIOS_COLLECTION)
      .doc(memberId)
      .collection(BENEFICIOS_RECLAMADOS_SUBCOLLECTION);
  }

  async listReclamadosByMember(memberId: string): Promise<string[]> {
    const snapshot = await this.reclamosCollection(memberId).get();
    return snapshot.docs.map((doc) => doc.id);
  }

  async hasMemberClaimedBeneficio(
    memberId: string,
    beneficioId: string,
  ): Promise<boolean> {
    const doc = await this.reclamosCollection(memberId).doc(beneficioId).get();
    return doc.exists;
  }

  private isFirestoreAlreadyExists(error: unknown): boolean {
    if (typeof error !== "object" || error === null) {
      return false;
    }

    const code = (error as { code?: number | string }).code;
    return code === 6 || code === "already-exists";
  }

  async claimBeneficioPoints(
    beneficioId: string,
    memberId: string,
  ): Promise<BeneficioClaimResult> {
    const beneficio = await this.getBeneficioById(beneficioId);

    if (!beneficio) {
      throw new Error(`Beneficio con ID ${beneficioId} no encontrado`);
    }

    if (!beneficio.estatus) {
      throw new Error("Este beneficio ya no esta disponible");
    }

    const puntos = this.readPuntosRecompensa(beneficio.puntosRecompensa ?? 0);
    if (puntos <= 0) {
      throw new Error("Este beneficio no otorga puntos");
    }

    const claimRef = this.reclamosCollection(memberId).doc(beneficioId);
    const existingClaim = await claimRef.get();

    if (existingClaim.exists) {
      const data = existingClaim.data() ?? {};
      const alreadySynced =
        typeof data.transactionId === "string" ||
        data.loyaltySynced === true;

      if (alreadySynced) {
        const wallet = await loyaltyEngineService.getWallet(memberId);
        return {
          alreadyClaimed: true,
          puntosAsignados: 0,
          puntosActuales: wallet.availablePoints,
          beneficioId,
        };
      }
    } else {
      try {
        await claimRef.create({
          beneficioId,
          memberId,
          puntos,
          beneficioTitulo: beneficio.titulo,
          claimedAt: admin.firestore.Timestamp.now(),
        });
      } catch (error) {
        if (this.isFirestoreAlreadyExists(error)) {
          const wallet = await loyaltyEngineService.getWallet(memberId);
          return {
            alreadyClaimed: true,
            puntosAsignados: 0,
            puntosActuales: wallet.availablePoints,
            beneficioId,
          };
        }
        throw error;
      }
    }

    const txn = await loyaltyEngineService.applyBeneficioClaimBonus(
      memberId,
      beneficioId,
      puntos,
      beneficio.titulo,
      memberId,
    );

    const wallet = await loyaltyEngineService.getWallet(memberId);

    if (txn === null) {
      await claimRef.set(
        {
          beneficioId,
          memberId,
          puntos,
          beneficioTitulo: beneficio.titulo,
          loyaltySynced: true,
          claimedAt: admin.firestore.Timestamp.now(),
        },
        { merge: true },
      );

      return {
        alreadyClaimed: true,
        puntosAsignados: 0,
        puntosActuales: wallet.availablePoints,
        beneficioId,
      };
    }

    await claimRef.set(
      {
        transactionId: txn.transactionId,
        loyaltySynced: true,
        puntos,
        beneficioTitulo: beneficio.titulo,
        claimedAt: admin.firestore.Timestamp.now(),
      },
      { merge: true },
    );

    return {
      alreadyClaimed: false,
      puntosAsignados: puntos,
      puntosActuales: wallet.availablePoints,
      beneficioId,
    };
  }
}

export default new BeneficioService();
