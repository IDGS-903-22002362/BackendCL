import { firestoreTienda } from "../config/firebase";
import { admin } from "../config/firebase.admin";
import {
  ConfirmarRecepcionMercanciaDTO,
  CrearRecepcionMercanciaDTO,
  EstadoRecepcionMercancia,
  LineaRecepcionMercancia,
  ListarRecepcionesMercanciaQuery,
  RecepcionMercancia,
} from "../models/inventario.model";
import inventoryService from "./inventory.service";
import productService from "./product.service";
import { normalizeTallaIds } from "../utils/size-inventory.util";

const RECEPCIONES_COLLECTION = "recepcionesMercancia";
const CONFIRMACION_IDEMPOTENCY_COLLECTION = "recepcionesConfirmacionIdempotency";

class InventoryReceptionService {
  private normalizeLinea(linea: LineaRecepcionMercancia): LineaRecepcionMercancia {
    const cantidadEsperada = Math.max(0, Math.floor(linea.cantidadEsperada));
    const cantidadAceptada = Math.max(0, Math.floor(linea.cantidadAceptada));
    const cantidadRechazada = Math.max(0, Math.floor(linea.cantidadRechazada));
    const procesadas = cantidadAceptada + cantidadRechazada;

    return {
      productoId: linea.productoId,
      tallaId: linea.tallaId?.trim() || null,
      cantidadEsperada,
      cantidadAceptada,
      cantidadRechazada,
      cantidadPendiente: Math.max(0, cantidadEsperada - procesadas),
    };
  }

  private lineKey(productoId: string, tallaId: string | null): string {
    return `${productoId}::${tallaId ?? "_"}`;
  }

  private mapDoc(id: string, data: FirebaseFirestore.DocumentData): RecepcionMercancia {
    const lineas = Array.isArray(data.lineas)
      ? (data.lineas as LineaRecepcionMercancia[]).map((linea) =>
          this.normalizeLinea(linea),
        )
      : [];

    return {
      id,
      proveedorId: data.proveedorId,
      proveedorNombre: data.proveedorNombre,
      referencia: String(data.referencia ?? ""),
      fechaRecepcion: data.fechaRecepcion?.toDate?.() ?? new Date(data.fechaRecepcion),
      responsableId: String(data.responsableId ?? ""),
      responsableNombre: data.responsableNombre,
      estado: data.estado as EstadoRecepcionMercancia,
      lineas,
      notas: data.notas,
      cerradaEn: data.cerradaEn?.toDate?.(),
      createdAt: data.createdAt?.toDate?.() ?? new Date(),
      updatedAt: data.updatedAt?.toDate?.(),
    };
  }

  private async validateProductLine(
    productoId: string,
    tallaId: string | null,
  ): Promise<void> {
    const stock = await productService.getStockBySize(productoId);
    if (!stock) {
      throw new Error(`Producto con ID ${productoId} no encontrado`);
    }

    const tallaIds = normalizeTallaIds(stock.tallaIds);
    if (tallaIds.length > 0) {
      if (!tallaId) {
        throw new Error(
          `Se requiere tallaId para el producto ${productoId} con inventario por talla`,
        );
      }
      if (!tallaIds.includes(tallaId)) {
        throw new Error(
          `La talla "${tallaId}" no pertenece al producto ${productoId}`,
        );
      }
      return;
    }

    if (tallaId) {
      throw new Error(
        `El producto ${productoId} no maneja inventario por talla; omita tallaId`,
      );
    }
  }

  async createRecepcion(payload: CrearRecepcionMercanciaDTO): Promise<RecepcionMercancia> {
    const now = admin.firestore.Timestamp.now();
    const fechaRecepcion = admin.firestore.Timestamp.fromDate(
      new Date(payload.fechaRecepcion),
    );

    const lineas: LineaRecepcionMercancia[] = [];
    for (const linea of payload.lineas ?? []) {
      const tallaId = linea.tallaId?.trim() || null;
      await this.validateProductLine(linea.productoId, tallaId);
      lineas.push(
        this.normalizeLinea({
          productoId: linea.productoId,
          tallaId,
          cantidadEsperada: linea.cantidadEsperada,
          cantidadAceptada: 0,
          cantidadRechazada: 0,
          cantidadPendiente: linea.cantidadEsperada,
        }),
      );
    }

    const docRef = firestoreTienda.collection(RECEPCIONES_COLLECTION).doc();
    const data = {
      proveedorId: payload.proveedorId?.trim() || null,
      proveedorNombre: payload.proveedorNombre?.trim() || null,
      referencia: payload.referencia.trim(),
      fechaRecepcion,
      responsableId: payload.responsableId,
      responsableNombre: payload.responsableNombre?.trim() || null,
      estado: EstadoRecepcionMercancia.BORRADOR,
      lineas,
      notas: payload.notas?.trim() || null,
      createdAt: now,
      updatedAt: now,
    };

    await docRef.set(data);
    return this.mapDoc(docRef.id, data);
  }

  async getRecepcion(recepcionId: string): Promise<RecepcionMercancia> {
    const doc = await firestoreTienda
      .collection(RECEPCIONES_COLLECTION)
      .doc(recepcionId)
      .get();

    if (!doc.exists) {
      throw new Error(`Recepcion con ID ${recepcionId} no encontrada`);
    }

    return this.mapDoc(doc.id, doc.data() as FirebaseFirestore.DocumentData);
  }

  async listRecepciones(
    queryParams: ListarRecepcionesMercanciaQuery,
  ): Promise<{ recepciones: RecepcionMercancia[]; nextCursor: string | null }> {
    let query: FirebaseFirestore.Query = firestoreTienda.collection(
      RECEPCIONES_COLLECTION,
    );

    if (queryParams.estado) {
      query = query.where("estado", "==", queryParams.estado);
    }
    if (queryParams.proveedorId) {
      query = query.where("proveedorId", "==", queryParams.proveedorId);
    }

    query = query.orderBy("createdAt", "desc");

    if (queryParams.cursor) {
      const cursorDoc = await firestoreTienda
        .collection(RECEPCIONES_COLLECTION)
        .doc(queryParams.cursor)
        .get();
      if (cursorDoc.exists) {
        query = query.startAfter(cursorDoc);
      }
    }

    query = query.limit(queryParams.limit + 1);
    const snapshot = await query.get();
    const hasNext = snapshot.docs.length > queryParams.limit;
    const docs = hasNext
      ? snapshot.docs.slice(0, queryParams.limit)
      : snapshot.docs;

    let recepciones = docs.map((doc) =>
      this.mapDoc(doc.id, doc.data() as FirebaseFirestore.DocumentData),
    );

    const referencia = queryParams.referencia?.trim().toLowerCase();
    if (referencia) {
      recepciones = recepciones.filter((item) =>
        item.referencia.toLowerCase().includes(referencia),
      );
    }

    return {
      recepciones,
      nextCursor: hasNext ? docs[docs.length - 1].id : null,
    };
  }

  async updateLineas(
    recepcionId: string,
    lineas: Array<{
      productoId: string;
      tallaId?: string;
      cantidadEsperada: number;
    }>,
  ): Promise<RecepcionMercancia> {
    const docRef = firestoreTienda.collection(RECEPCIONES_COLLECTION).doc(recepcionId);
    const doc = await docRef.get();
    if (!doc.exists) {
      throw new Error(`Recepcion con ID ${recepcionId} no encontrada`);
    }

    const current = this.mapDoc(doc.id, doc.data() as FirebaseFirestore.DocumentData);

    if (
      current.estado === EstadoRecepcionMercancia.CERRADA ||
      current.estado === EstadoRecepcionMercancia.CANCELADA
    ) {
      throw new Error("No se pueden modificar lineas de una recepcion cerrada o cancelada");
    }

    const existingByKey = new Map(
      current.lineas.map((linea) => [this.lineKey(linea.productoId, linea.tallaId), linea]),
    );

    const merged: LineaRecepcionMercancia[] = [];
    for (const linea of lineas) {
      const tallaId = linea.tallaId?.trim() || null;
      await this.validateProductLine(linea.productoId, tallaId);
      const key = this.lineKey(linea.productoId, tallaId);
      const prev = existingByKey.get(key);
      const cantidadEsperada = Math.max(0, Math.floor(linea.cantidadEsperada));
      const cantidadAceptada = prev?.cantidadAceptada ?? 0;
      const cantidadRechazada = prev?.cantidadRechazada ?? 0;

      if (cantidadAceptada + cantidadRechazada > cantidadEsperada) {
        throw new Error(
          `La cantidad esperada no puede ser menor a lo ya procesado para ${linea.productoId}`,
        );
      }

      merged.push(
        this.normalizeLinea({
          productoId: linea.productoId,
          tallaId,
          cantidadEsperada,
          cantidadAceptada,
          cantidadRechazada,
          cantidadPendiente: cantidadEsperada - cantidadAceptada - cantidadRechazada,
        }),
      );
      existingByKey.delete(key);
    }

    for (const remaining of existingByKey.values()) {
      if (remaining.cantidadAceptada > 0 || remaining.cantidadRechazada > 0) {
        merged.push(remaining);
      }
    }

    const now = admin.firestore.Timestamp.now();
    await docRef.update({ lineas: merged, updatedAt: now });
    return this.getRecepcion(recepcionId);
  }

  private async getCachedConfirmacion(
    recepcionId: string,
    idempotencyKey: string,
  ): Promise<RecepcionMercancia | null> {
    const docId = Buffer.from(`${recepcionId}:${idempotencyKey}`).toString("base64url");
    const snapshot = await firestoreTienda
      .collection(CONFIRMACION_IDEMPOTENCY_COLLECTION)
      .doc(docId)
      .get();

    if (!snapshot.exists) {
      return null;
    }

    const cachedId = snapshot.data()?.recepcionId as string | undefined;
    return cachedId ? this.getRecepcion(cachedId) : null;
  }

  private async cacheConfirmacion(
    recepcionId: string,
    idempotencyKey: string,
    recepcion: RecepcionMercancia,
  ): Promise<void> {
    const docId = Buffer.from(`${recepcionId}:${idempotencyKey}`).toString("base64url");
    await firestoreTienda
      .collection(CONFIRMACION_IDEMPOTENCY_COLLECTION)
      .doc(docId)
      .set({
        recepcionId,
        idempotencyKey,
        recepcion,
        createdAt: admin.firestore.Timestamp.now(),
      });
  }

  async confirmRecepcion(
    payload: ConfirmarRecepcionMercanciaDTO,
  ): Promise<RecepcionMercancia> {
    const idempotencyKey = payload.idempotencyKey?.trim();
    if (idempotencyKey) {
      const cached = await this.getCachedConfirmacion(payload.recepcionId, idempotencyKey);
      if (cached) {
        return cached;
      }
    }

    const docRef = firestoreTienda
      .collection(RECEPCIONES_COLLECTION)
      .doc(payload.recepcionId);

    const doc = await docRef.get();
    if (!doc.exists) {
      throw new Error(`Recepcion con ID ${payload.recepcionId} no encontrada`);
    }

    const current = this.mapDoc(doc.id, doc.data() as FirebaseFirestore.DocumentData);

    if (current.estado === EstadoRecepcionMercancia.CERRADA) {
      throw new Error("La recepcion ya esta cerrada y no puede procesarse de nuevo");
    }
    if (current.estado === EstadoRecepcionMercancia.CANCELADA) {
      throw new Error("La recepcion esta cancelada");
    }

    const lineasByKey = new Map(
      current.lineas.map((linea) => [
        this.lineKey(linea.productoId, linea.tallaId),
        { ...linea },
      ]),
    );

    for (const confirm of payload.lineas) {
      const tallaId = confirm.tallaId?.trim() || null;
      const key = this.lineKey(confirm.productoId, tallaId);
      const linea = lineasByKey.get(key);

      if (!linea) {
        throw new Error(`Linea no encontrada en recepcion: ${confirm.productoId}`);
      }

      const deltaAceptada = Math.max(0, Math.floor(confirm.cantidadAceptada));
      const deltaRechazada = Math.max(0, Math.floor(confirm.cantidadRechazada));

      if (deltaAceptada + deltaRechazada === 0) {
        continue;
      }

      if (deltaAceptada + deltaRechazada > linea.cantidadPendiente) {
        throw new Error(
          `Cantidad confirmada excede pendiente para ${confirm.productoId}. Pendiente: ${linea.cantidadPendiente}`,
        );
      }

      if (deltaAceptada > 0) {
        await inventoryService.registerRecepcionMovement({
          productoId: confirm.productoId,
          tallaId: tallaId ?? undefined,
          cantidad: deltaAceptada,
          recepcionId: payload.recepcionId,
          referencia: current.referencia,
          usuarioId: payload.responsableId,
          idempotencyKey: idempotencyKey
            ? `${idempotencyKey}:${key}:aceptada`
            : undefined,
        });
      }

      linea.cantidadAceptada += deltaAceptada;
      linea.cantidadRechazada += deltaRechazada;
      linea.cantidadPendiente = Math.max(
        0,
        linea.cantidadEsperada - linea.cantidadAceptada - linea.cantidadRechazada,
      );
      lineasByKey.set(key, linea);
    }

    const lineasActualizadas = Array.from(lineasByKey.values()).map((linea) =>
      this.normalizeLinea(linea),
    );
    const tieneProcesadas = lineasActualizadas.some(
      (linea) => linea.cantidadAceptada > 0 || linea.cantidadRechazada > 0,
    );

    const estado = tieneProcesadas
      ? EstadoRecepcionMercancia.PARCIAL
      : current.estado;

    const now = admin.firestore.Timestamp.now();
    await docRef.update({ lineas: lineasActualizadas, estado, updatedAt: now });

    const updated = await this.getRecepcion(payload.recepcionId);

    if (idempotencyKey) {
      await this.cacheConfirmacion(payload.recepcionId, idempotencyKey, updated);
    }

    return updated;
  }

  async closeRecepcion(
    recepcionId: string,
    responsableId: string,
  ): Promise<RecepcionMercancia> {
    const docRef = firestoreTienda.collection(RECEPCIONES_COLLECTION).doc(recepcionId);
    const doc = await docRef.get();
    if (!doc.exists) {
      throw new Error(`Recepcion con ID ${recepcionId} no encontrada`);
    }

    const current = this.mapDoc(doc.id, doc.data() as FirebaseFirestore.DocumentData);

    if (current.estado === EstadoRecepcionMercancia.CERRADA) {
      throw new Error("La recepcion ya esta cerrada");
    }
    if (current.estado === EstadoRecepcionMercancia.CANCELADA) {
      throw new Error("La recepcion esta cancelada");
    }

    const now = admin.firestore.Timestamp.now();
    await docRef.update({
      estado: EstadoRecepcionMercancia.CERRADA,
      cerradaEn: now,
      responsableId,
      updatedAt: now,
    });

    return this.getRecepcion(recepcionId);
  }
}

export const inventoryReceptionService = new InventoryReceptionService();
export default inventoryReceptionService;
