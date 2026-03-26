// services/detalleProducto.service.ts
import { firestoreTienda } from "../config/firebase";
import { admin } from "../config/firebase.admin";
import { DetalleProducto } from "../models/producto.model";

const PRODUCTOS_COLLECTION = "productos";

/**
 * Servicio para manejar la subcolección de detalles de un producto.
 * Cada detalle se almacena en: productos/{productoId}/detalles/{detalleId}
 * El array detalleIds en el producto padre se mantiene sincronizado.
 */
export class DetalleProductoService {
    /**
     * Obtiene todos los detalles de un producto.
     * @param productoId - ID del producto padre.
     * @returns Lista de detalles ordenados por fecha de creación (descendente).
     */
    async getDetallesByProducto(productoId: string): Promise<DetalleProducto[]> {
        try {
            const snapshot = await firestoreTienda
                .collection(PRODUCTOS_COLLECTION)
                .doc(productoId)
                .collection("detalles")
                .orderBy("createdAt", "desc") // asumiendo que agregamos createdAt
                .get();

            const detalles: DetalleProducto[] = snapshot.docs.map((doc) => ({
                id: doc.id,
                ...doc.data(),
            })) as DetalleProducto[];

            return detalles;
        } catch (error) {
            console.error(`Error al obtener detalles del producto ${productoId}:`, error);
            throw new Error("Error al obtener detalles del producto");
        }
    }

    /**
     * Obtiene un detalle específico por ID.
     * @param productoId - ID del producto padre.
     * @param detalleId - ID del detalle.
     * @returns El detalle o null si no existe.
     */
    async getDetalleById(productoId: string, detalleId: string): Promise<DetalleProducto | null> {
        try {
            const doc = await firestoreTienda
                .collection(PRODUCTOS_COLLECTION)
                .doc(productoId)
                .collection("detalles")
                .doc(detalleId)
                .get();

            if (!doc.exists) {
                return null;
            }

            return {
                id: doc.id,
                ...doc.data(),
            } as DetalleProducto;
        } catch (error) {
            console.error(`Error al obtener detalle ${detalleId} del producto ${productoId}:`, error);
            throw new Error("Error al obtener el detalle");
        }
    }

    /**
     * Crea un nuevo detalle para un producto.
     * Se ejecuta en una transacción para asegurar que el producto exista y se actualice el array detalleIds.
     * @param productoId - ID del producto padre.
     * @param data - Datos del detalle (descripción).
     * @returns El detalle creado con su ID.
     */
    async createDetalle(
        productoId: string,
        data: { descripcion: string }
    ): Promise<DetalleProducto> {
        const productoRef = firestoreTienda.collection(PRODUCTOS_COLLECTION).doc(productoId);
        const now = admin.firestore.Timestamp.now();

        try {
            const result = await firestoreTienda.runTransaction(async (transaction) => {
                // Verificar que el producto existe y está activo
                const productoDoc = await transaction.get(productoRef);
                if (!productoDoc.exists) {
                    throw new Error(`Producto con ID ${productoId} no encontrado`);
                }
                const productoData = productoDoc.data();
                if (productoData?.activo === false) {
                    throw new Error(`El producto con ID ${productoId} está inactivo y no puede recibir detalles`);
                }

                // Crear referencia al nuevo detalle (subcolección)
                const detalleRef = productoRef.collection("detalles").doc();
                const nuevoDetalle: Omit<DetalleProducto, "id"> = {
                    descripcion: data.descripcion,
                    productoId,
                    createdAt: now,
                    updatedAt: now,
                };

                transaction.set(detalleRef, nuevoDetalle);

                // Actualizar el array detalleIds en el producto
                const currentDetalleIds = productoData?.detalleIds || [];
                const newDetalleIds = [...currentDetalleIds, detalleRef.id];
                transaction.update(productoRef, {
                    detalleIds: newDetalleIds,
                    updatedAt: now,
                });

                return {
                    id: detalleRef.id,
                    ...nuevoDetalle,
                } as DetalleProducto;
            });

            return result;
        } catch (error) {
            console.error(`Error al crear detalle para producto ${productoId}:`, error);
            throw new Error(
                error instanceof Error ? error.message : "Error al crear el detalle"
            );
        }
    }

    /**
     * Actualiza un detalle existente.
     * No modifica el array detalleIds del producto, solo la descripción.
     * @param productoId - ID del producto padre.
     * @param detalleId - ID del detalle.
     * @param data - Datos a actualizar (descripción opcional).
     * @returns El detalle actualizado.
     */
    async updateDetalle(
        productoId: string,
        detalleId: string,
        data: { descripcion?: string }
    ): Promise<DetalleProducto> {
        const detalleRef = firestoreTienda
            .collection(PRODUCTOS_COLLECTION)
            .doc(productoId)
            .collection("detalles")
            .doc(detalleId);

        const now = admin.firestore.Timestamp.now();

        try {
            const detalleDoc = await detalleRef.get();
            if (!detalleDoc.exists) {
                throw new Error(`Detalle con ID ${detalleId} no encontrado en el producto ${productoId}`);
            }

            const updatePayload: any = {
                updatedAt: now,
            };
            if (data.descripcion !== undefined) {
                updatePayload.descripcion = data.descripcion;
            }

            await detalleRef.update(updatePayload);

            const updatedDoc = await detalleRef.get();
            return {
                id: updatedDoc.id,
                ...updatedDoc.data(),
            } as DetalleProducto;
        } catch (error) {
            console.error(`Error al actualizar detalle ${detalleId}:`, error);
            throw new Error(
                error instanceof Error ? error.message : "Error al actualizar el detalle"
            );
        }
    }

    /**
     * Elimina un detalle y actualiza el array detalleIds del producto.
     * Se ejecuta en transacción.
     * @param productoId - ID del producto padre.
     * @param detalleId - ID del detalle.
     */
    async deleteDetalle(productoId: string, detalleId: string): Promise<void> {
        const productoRef = firestoreTienda.collection(PRODUCTOS_COLLECTION).doc(productoId);
        const detalleRef = productoRef.collection("detalles").doc(detalleId);
        const now = admin.firestore.Timestamp.now();

        try {
            await firestoreTienda.runTransaction(async (transaction) => {
                // 1 Lecturas: obtener ambos documentos primero
                const detalleDoc = await transaction.get(detalleRef);
                const productoDoc = await transaction.get(productoRef);

                // Validar existencia
                if (!detalleDoc.exists) {
                    throw new Error(`Detalle con ID ${detalleId} no encontrado en el producto ${productoId}`);
                }
                if (!productoDoc.exists) {
                    throw new Error(`Producto con ID ${productoId} no encontrado`);
                }

                // 2 Escrituras: eliminar detalle y actualizar producto
                transaction.delete(detalleRef);

                const productoData = productoDoc.data();
                const currentDetalleIds = productoData?.detalleIds || [];
                const newDetalleIds = currentDetalleIds.filter((id: string) => id !== detalleId);
                transaction.update(productoRef, {
                    detalleIds: newDetalleIds,
                    updatedAt: now,
                });
            });
        } catch (error) {
            console.error(`Error al eliminar detalle ${detalleId}:`, error);
            throw new Error(
                error instanceof Error ? error.message : "Error al eliminar el detalle"
            );
        }
    }
}

export default new DetalleProductoService();