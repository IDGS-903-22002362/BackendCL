/**
 * Servicio de Líneas
 * Maneja toda la lógica de negocio relacionada con el catálogo de líneas
 */

import { firestore, admin } from "../config/firebase";
import { Linea } from "../models/catalogo.model";

const LINEAS_COLLECTION = "lineas";

class LineService {
    /**
     * Obtiene todas las líneas
     * (si no existe "activo", se asume true)
     */
    async getAllLines(): Promise<Linea[]> {
        try {
            const snapshot = await firestore
                .collection(LINEAS_COLLECTION)
                .get();

            if (snapshot.empty) {
                return [];
            }

            const lineas: Linea[] = snapshot.docs
                .map((doc) => {
                    const data = doc.data();

                    return {
                        id: doc.id,
                        codigo: data.codigo,
                        nombre: data.nombre,
                        activo: data.activo ?? true,
                        createdAt: data.createdAt,
                        updatedAt: data.updatedAt,
                    };
                })
                .filter((linea) => linea.activo); // 👈 soft delete compatible

            // Ordenar por código
            //lineas.sort((a, b) => a.codigo - b.codigo);

            return lineas;
        } catch (error) {
            console.error("Error al obtener líneas:", error);
            throw new Error("Error al obtener las líneas");
        }
    }

    /**
     * Obtiene una línea por ID
     */
    async getLineById(id: string): Promise<Linea | null> {
        try {
            const doc = await firestore
                .collection(LINEAS_COLLECTION)
                .doc(id)
                .get();

            if (!doc.exists) {
                return null;
            }

            const data = doc.data()!;

            // Si está inactiva, se considera eliminada
            if (data.activo === false) {
                return null;
            }

            return {
                id: doc.id,
                codigo: data.codigo,
                nombre: data.nombre,
                activo: data.activo ?? true,
                createdAt: data.createdAt,
                updatedAt: data.updatedAt,
            };
        } catch (error) {
            console.error(`Error al obtener línea ${id}:`, error);
            throw new Error("Error al obtener la línea");
        }
    }

    /**
     * Busca líneas por nombre (búsqueda simple)
     */
    async searchLines(termino: string): Promise<Linea[]> {
        try {
            const term = termino.toLowerCase();

            const snapshot = await firestore
                .collection(LINEAS_COLLECTION)
                .get();

            return snapshot.docs
                .map((doc) => {
                    const data = doc.data();

                    return {
                        id: doc.id,
                        codigo: data.codigo,
                        nombre: data.nombre,
                        activo: data.activo ?? true,
                    };
                })
                .filter(
                    (linea) =>
                        linea.activo &&
                        linea.nombre.toLowerCase().includes(term)
                );
        } catch (error) {
            console.error("Error al buscar líneas:", error);
            throw new Error("Error al buscar líneas");
        }
    }

    /**
     * Crea una nueva línea
     * Usa ID semántico basado en el nombre
     */
    async createLine(linea: Pick<Linea, "codigo" | "nombre">): Promise<Linea> {
        try {
            const now = admin.firestore.Timestamp.now();

            // Validar código único
            const snapshot = await firestore
                .collection(LINEAS_COLLECTION)
                .where("codigo", "==", linea.codigo)
                .limit(1)
                .get();

            if (!snapshot.empty) {
                throw new Error(
                    `Ya existe una línea con el código ${linea.codigo}`
                );
            }

            // Generar ID semántico
            const docId = linea.nombre
                .toLowerCase()
                .trim()
                .replace(/\s+/g, "_");

            const docRef = firestore
                .collection(LINEAS_COLLECTION)
                .doc(docId);

            const existingDoc = await docRef.get();
            if (existingDoc.exists) {
                throw new Error(
                    `Ya existe una línea con el nombre ${linea.nombre}`
                );
            }

            await docRef.set({
                codigo: linea.codigo,
                nombre: linea.nombre,
                activo: true,
                createdAt: now,
                updatedAt: now,
            });

            return {
                id: docId,
                codigo: linea.codigo,
                nombre: linea.nombre,
                activo: true,
                createdAt: now,
                updatedAt: now,
            };
        } catch (error) {
            console.error("Error al crear línea:", error);
            throw new Error(
                error instanceof Error ? error.message : "Error al crear la línea"
            );
        }
    }

    /**
     * Actualiza una línea existente
     */
    async updateLine(
        id: string,
        updateData: Partial<Pick<Linea, "codigo" | "nombre">>
    ): Promise<Linea> {
        try {
            const docRef = firestore
                .collection(LINEAS_COLLECTION)
                .doc(id);

            const doc = await docRef.get();

            if (!doc.exists) {
                throw new Error(`Línea con ID ${id} no encontrada`);
            }

            // Validar código único si se actualiza
            if (updateData.codigo !== undefined) {
                const snapshot = await firestore
                    .collection(LINEAS_COLLECTION)
                    .where("codigo", "==", updateData.codigo)
                    .limit(1)
                    .get();

                if (!snapshot.empty && snapshot.docs[0].id !== id) {
                    throw new Error(
                        `Ya existe otra línea con el código ${updateData.codigo}`
                    );
                }
            }

            const now = admin.firestore.Timestamp.now();

            await docRef.update({
                ...updateData,
                updatedAt: now,
            });

            const updatedDoc = await docRef.get();
            const data = updatedDoc.data()!;

            return {
                id: updatedDoc.id,
                codigo: data.codigo,
                nombre: data.nombre,
                activo: data.activo ?? true,
                createdAt: data.createdAt,
                updatedAt: data.updatedAt,
            };
        } catch (error) {
            console.error("Error al actualizar línea:", error);
            throw new Error(
                error instanceof Error
                    ? error.message
                    : "Error al actualizar la línea"
            );
        }
    }

    /**
     * Elimina una línea (soft delete)
     */
    async deleteLine(id: string): Promise<void> {
        try {
            const docRef = firestore
                .collection(LINEAS_COLLECTION)
                .doc(id);

            const doc = await docRef.get();

            if (!doc.exists) {
                throw new Error(`Línea con ID ${id} no encontrada`);
            }

            await docRef.update({
                activo: false,
                updatedAt: admin.firestore.Timestamp.now(),
            });
        } catch (error) {
            console.error("Error al eliminar línea:", error);
            throw new Error(
                error instanceof Error
                    ? error.message
                    : "Error al eliminar la línea"
            );
        }
    }
}

export default new LineService();
