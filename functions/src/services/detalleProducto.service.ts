import { firestoreTienda } from "../config/firebase";
import { admin } from "../config/firebase.admin";
import { DetalleProducto } from "../models/producto.model";
import logger from "../utils/logger";

const PRODUCTOS_COLLECTION = "productos";
const detalleProductoLogger = logger.child({
  component: "detalle-producto-service",
});

type ProductoSnapshotLike = {
  exists: boolean;
  data: () => FirebaseFirestore.DocumentData | undefined;
};

export class DetalleProductoServiceError extends Error {
  constructor(
    public readonly code:
      | "INVALID_ARGUMENT"
      | "NOT_FOUND"
      | "CONFLICT"
      | "INTERNAL",
    message: string,
  ) {
    super(message);
    this.name = "DetalleProductoServiceError";
  }
}

export class DetalleProductoService {
  private getProductoRef(productoId: string) {
    return firestoreTienda.collection(PRODUCTOS_COLLECTION).doc(productoId);
  }

  private getDetalleRef(productoId: string, detalleId: string) {
    return this.getProductoRef(productoId).collection("detalles").doc(detalleId);
  }

  private ensureValidIds(productoId: string, detalleId?: string): void {
    if (!productoId.trim()) {
      throw new DetalleProductoServiceError(
        "INVALID_ARGUMENT",
        "productoId es requerido",
      );
    }

    if (detalleId !== undefined && !detalleId.trim()) {
      throw new DetalleProductoServiceError(
        "INVALID_ARGUMENT",
        "detalleId es requerido",
      );
    }
  }

  private ensureProductoDisponible(
    productoId: string,
    productoDoc: ProductoSnapshotLike,
  ): FirebaseFirestore.DocumentData {
    if (!productoDoc.exists) {
      throw new DetalleProductoServiceError(
        "NOT_FOUND",
        `Producto con ID ${productoId} no encontrado`,
      );
    }

    const productoData = productoDoc.data();
    if (!productoData) {
      throw new DetalleProductoServiceError(
        "NOT_FOUND",
        `Producto con ID ${productoId} no encontrado`,
      );
    }

    if (productoData.activo === false) {
      throw new DetalleProductoServiceError(
        "NOT_FOUND",
        `Producto con ID ${productoId} no encontrado`,
      );
    }

    return productoData;
  }

  private normalizeDetalle(
    detalleId: string,
    productoId: string,
    data: FirebaseFirestore.DocumentData | undefined,
  ): DetalleProducto {
    return {
      id: detalleId,
      descripcion: String(data?.descripcion ?? ""),
      productoId,
      createdAt: data?.createdAt,
      updatedAt: data?.updatedAt,
    };
  }

  async getDetallesByProducto(productoId: string): Promise<DetalleProducto[]> {
    try {
      this.ensureValidIds(productoId);
      const productoRef = this.getProductoRef(productoId);
      const productoDoc = await productoRef.get();
      this.ensureProductoDisponible(productoId, productoDoc);

      const snapshot = await productoRef
        .collection("detalles")
        .orderBy("createdAt", "desc")
        .get();

      return snapshot.docs.map((doc) =>
        this.normalizeDetalle(doc.id, productoId, doc.data()),
      );
    } catch (error) {
      detalleProductoLogger.error("detalle_list_failed", {
        productoId,
        errorCode:
          error instanceof DetalleProductoServiceError ? error.code : "INTERNAL",
        error: error instanceof Error ? error.message : "unknown_error",
      });
      if (error instanceof DetalleProductoServiceError) {
        throw error;
      }

      throw new DetalleProductoServiceError(
        "INTERNAL",
        "Error al obtener detalles del producto",
      );
    }
  }

  async getDetalleById(
    productoId: string,
    detalleId: string,
  ): Promise<DetalleProducto | null> {
    try {
      this.ensureValidIds(productoId, detalleId);
      const productoRef = this.getProductoRef(productoId);
      const productoDoc = await productoRef.get();
      this.ensureProductoDisponible(productoId, productoDoc);

      const detalleDoc = await productoRef.collection("detalles").doc(detalleId).get();
      if (!detalleDoc.exists) {
        return null;
      }

      const detalleData = detalleDoc.data();
      if (detalleData?.productoId && detalleData.productoId !== productoId) {
        throw new DetalleProductoServiceError(
          "CONFLICT",
          `Detalle con ID ${detalleId} no pertenece al producto ${productoId}`,
        );
      }

      return this.normalizeDetalle(detalleDoc.id, productoId, detalleData);
    } catch (error) {
      detalleProductoLogger.error("detalle_get_failed", {
        productoId,
        detalleId,
        errorCode:
          error instanceof DetalleProductoServiceError ? error.code : "INTERNAL",
        error: error instanceof Error ? error.message : "unknown_error",
      });
      if (error instanceof DetalleProductoServiceError) {
        throw error;
      }

      throw new DetalleProductoServiceError("INTERNAL", "Error al obtener el detalle");
    }
  }

  async createDetalle(
    productoId: string,
    data: { descripcion: string },
  ): Promise<DetalleProducto> {
    this.ensureValidIds(productoId);
    const productoRef = this.getProductoRef(productoId);
    const now = admin.firestore.Timestamp.now();

    try {
      return await firestoreTienda.runTransaction(async (transaction) => {
        const productoDoc = await transaction.get(productoRef);
        const productoData = this.ensureProductoDisponible(productoId, productoDoc);

        const detalleRef = productoRef.collection("detalles").doc();
        const nuevoDetalle: Omit<DetalleProducto, "id"> = {
          descripcion: data.descripcion,
          productoId,
          createdAt: now,
          updatedAt: now,
        };

        transaction.set(detalleRef, nuevoDetalle);

        const currentDetalleIds = Array.isArray(productoData.detalleIds)
          ? productoData.detalleIds.filter(
              (id: unknown): id is string => typeof id === "string",
            )
          : [];
        const newDetalleIds = Array.from(new Set([...currentDetalleIds, detalleRef.id]));

        transaction.update(productoRef, {
          detalleIds: newDetalleIds,
          updatedAt: now,
        });

        return {
          id: detalleRef.id,
          ...nuevoDetalle,
        };
      });
    } catch (error) {
      detalleProductoLogger.error("detalle_create_failed", {
        productoId,
        errorCode:
          error instanceof DetalleProductoServiceError ? error.code : "INTERNAL",
        error: error instanceof Error ? error.message : "unknown_error",
      });
      if (error instanceof DetalleProductoServiceError) {
        throw error;
      }

      throw new DetalleProductoServiceError("INTERNAL", "Error al crear el detalle");
    }
  }

  async updateDetalle(
    productoId: string,
    detalleId: string,
    data: { descripcion?: string },
  ): Promise<DetalleProducto> {
    this.ensureValidIds(productoId, detalleId);
    const productoRef = this.getProductoRef(productoId);
    const detalleRef = this.getDetalleRef(productoId, detalleId);
    const now = admin.firestore.Timestamp.now();

    try {
      const productoDoc = await productoRef.get();
      this.ensureProductoDisponible(productoId, productoDoc);

      const detalleDoc = await detalleRef.get();
      if (!detalleDoc.exists) {
        throw new DetalleProductoServiceError(
          "NOT_FOUND",
          `Detalle con ID ${detalleId} no encontrado en el producto ${productoId}`,
        );
      }

      const detalleData = detalleDoc.data();
      if (detalleData?.productoId && detalleData.productoId !== productoId) {
        throw new DetalleProductoServiceError(
          "CONFLICT",
          `Detalle con ID ${detalleId} no pertenece al producto ${productoId}`,
        );
      }

      const updatePayload: { updatedAt: unknown; descripcion?: string } = {
        updatedAt: now,
      };

      if (data.descripcion !== undefined) {
        updatePayload.descripcion = data.descripcion;
      }

      await detalleRef.update(updatePayload);

      const updatedDoc = await detalleRef.get();
      return this.normalizeDetalle(updatedDoc.id, productoId, updatedDoc.data());
    } catch (error) {
      detalleProductoLogger.error("detalle_update_failed", {
        productoId,
        detalleId,
        errorCode:
          error instanceof DetalleProductoServiceError ? error.code : "INTERNAL",
        error: error instanceof Error ? error.message : "unknown_error",
      });
      if (error instanceof DetalleProductoServiceError) {
        throw error;
      }

      throw new DetalleProductoServiceError(
        "INTERNAL",
        "Error al actualizar el detalle",
      );
    }
  }

  async deleteDetalle(productoId: string, detalleId: string): Promise<void> {
    this.ensureValidIds(productoId, detalleId);
    const productoRef = this.getProductoRef(productoId);
    const detalleRef = this.getDetalleRef(productoId, detalleId);
    const now = admin.firestore.Timestamp.now();

    try {
      await firestoreTienda.runTransaction(async (transaction) => {
        const detalleDoc = await transaction.get(detalleRef);
        const productoDoc = await transaction.get(productoRef);
        const productoData = this.ensureProductoDisponible(productoId, productoDoc);

        if (!detalleDoc.exists) {
          throw new DetalleProductoServiceError(
            "NOT_FOUND",
            `Detalle con ID ${detalleId} no encontrado en el producto ${productoId}`,
          );
        }

        const detalleData = detalleDoc.data();
        if (detalleData?.productoId && detalleData.productoId !== productoId) {
          throw new DetalleProductoServiceError(
            "CONFLICT",
            `Detalle con ID ${detalleId} no pertenece al producto ${productoId}`,
          );
        }

        transaction.delete(detalleRef);

        const currentDetalleIds = Array.isArray(productoData.detalleIds)
          ? productoData.detalleIds.filter(
              (id: unknown): id is string => typeof id === "string",
            )
          : [];
        const newDetalleIds = currentDetalleIds.filter((id) => id !== detalleId);

        transaction.update(productoRef, {
          detalleIds: newDetalleIds,
          updatedAt: now,
        });
      });
    } catch (error) {
      detalleProductoLogger.error("detalle_delete_failed", {
        productoId,
        detalleId,
        errorCode:
          error instanceof DetalleProductoServiceError ? error.code : "INTERNAL",
        error: error instanceof Error ? error.message : "unknown_error",
      });
      if (error instanceof DetalleProductoServiceError) {
        throw error;
      }

      throw new DetalleProductoServiceError("INTERNAL", "Error al eliminar el detalle");
    }
  }
}

export default new DetalleProductoService();
