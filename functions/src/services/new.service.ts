/**
 * Servicio de Productos
 * Maneja toda la lógica de negocio relacionada con productos
 */

import { firestoreApp } from "../config/app.firebase";
import { admin } from "../config/firebase.admin";
import { Noticia } from "../models/noticias.model";
import iaService from "./ai.service";

/**
 * Colección de productos en Firestore
 */
const NOTICIAS_COLLECTION = "noticias";

/**
 * Clase ProductService
 * Encapsula las operaciones CRUD y consultas de productos
 */
export class NewService {
    /**
     * Obtiene todos los productos activos
     * @returns Promise con array de productos activos ordenados alfabéticamente
     */
    async getAllNews(): Promise<Noticia[]> {
        try {
            // Consultar colección de productos (sin orderBy para evitar índice compuesto)
            const snapshot = await firestoreApp
                .collection(NOTICIAS_COLLECTION)
                .where("estatus", "==", true) // Filtrar solo productos activos
                .get();

            // Si no hay productos, retornar array vacío
            if (snapshot.empty) {
                console.log("No se encontraron noticias activas");
                return [];
            }

            // Mapear documentos a objetos Producto
            const noticias: Noticia[] = snapshot.docs.map((doc) => {
                const data = doc.data();

                return {
                    id: doc.id,
                    titulo: data.titulo,
                    descripcion: data.descripcion,
                    contenido: data.contenido,
                    usuarioId: data.usuarioId,
                    autorNombre: data.autorNombre,
                    imagenes: data.imagenes || [],
                    likes: data.likes || 0,
                    enlaceExterno: data.enlaceExterno,
                    estatus: data.estatus,
                    createdAt: data.createdAt,
                    updatedAt: data.updatedAt,
                } as Noticia;
            });

            // Ordenar alfabéticamente en memoria
            noticias.sort((a, b) => a.descripcion.localeCompare(b.descripcion));

            console.log(`Se obtuvieron ${noticias.length} productos activos`);
            return noticias;
        } catch (error) {
            console.error("Error al obtener productos:", error);
            throw new Error("Error al obtener productos de la base de datos");
        }
    }

    /**
     * Obtiene un producto por su ID
     * @param id - ID del documento en Firestore
     * @returns Promise con el producto o null si no existe
     */
    async getNewsById(id: string): Promise<Noticia | null> {
        try {
            const doc = await firestoreApp
                .collection(NOTICIAS_COLLECTION)
                .doc(id)
                .get();

            if (!doc.exists) {
                console.log(`Noticia con ID ${id} no encontrada`);
                return null;
            }

            const data = doc.data()!;
            return {
                id: doc.id,
                titulo: data.titulo,
                descripcion: data.descripcion,
                contenido: data.contenido,
                usuarioId: data.usuarioId,
                autorNombre: data.autorNombre,
                imagenes: data.imagenes || [],
                likes: data.likes || 0,
                enlaceExterno: data.enlaceExterno,
                estatus: data.estatus,
                createdAt: data.createdAt,
                updatedAt: data.updatedAt,
            } as Noticia;
        } catch (error) {
            console.error(`❌ Error al obtener noticia ${id}:`, error);
            throw new Error("Error al obtener la noticia");
        }
    }



    /**
     * Busca noticias por texto en descripción o clave
     * @param searchTerm - Término de búsqueda
     * @returns Promise con array de productos que coinciden
     */
    async searchNews(searchTerm: string): Promise<Noticia[]> {
        try {
            // Nota: Firestore no tiene búsqueda full-text nativa
            // Esta es una implementación básica que busca por inicio de descripción
            // Para búsqueda más avanzada, considerar usar Algolia o similar

            const searchTermLower = searchTerm.toLowerCase();

            const snapshot = await firestoreApp
                .collection(NOTICIAS_COLLECTION)
                .where("estatus", "==", true)
                .get();

            const noticias: Noticia[] = snapshot.docs
                .map(
                    (doc) =>
                    ({
                        id: doc.id,
                        ...doc.data(),
                    } as Noticia)
                )
                .filter(
                    (producto) =>
                        producto.descripcion.toLowerCase().includes(searchTermLower) ||
                        producto.titulo.toLowerCase().includes(searchTermLower)
                );

            return noticias;
        } catch (error) {
            console.error("❌ Error al buscar productos:", error);
            throw new Error("Error al buscar productos");
        }
    }

    /**
     * Crea una nueva noticia
     * @param noticiaData - Datos de la noticia a crear
     * @returns Promise con el producto creado incluyendo su ID
     */
    async createNew(
        noticiaData: Omit<Noticia, "id" | "createdAt" | "updatedAt">
    ): Promise<Noticia> {
        try {
            const now = admin.firestore.Timestamp.now();

            const docRef = await firestoreApp.collection(NOTICIAS_COLLECTION).add({
                ...noticiaData,
                createdAt: now,
                updatedAt: now,
            });

            const docSnapshot = await docRef.get();

            return {
                id: docRef.id,
                ...(docSnapshot.data() as Omit<Noticia, "id">),
            };
        } catch (error) {
            console.error("❌ Error al crear noticia:", error);
            throw new Error("Error al crear la noticia");
        }
    }


    /**
 * Actualiza una noticia existente
 * @param id - ID de la noticia a actualizar (doc.id)
 * @param updateData - Datos parciales a actualizar
 * @returns Promise con la noticia actualizada
 */
    async updateNew(
        id: string,
        updateData: Partial<Omit<Noticia, "id" | "createdAt" | "updatedAt">>
    ): Promise<Noticia> {
        try {
            const docRef = firestoreApp
                .collection(NOTICIAS_COLLECTION)
                .doc(id);

            const snapshot = await docRef.get();

            if (!snapshot.exists) {
                throw new Error(`Noticia con ID ${id} no encontrada`);
            }

            const now = admin.firestore.Timestamp.now();

            await docRef.update({
                ...updateData,
                updatedAt: now,
            });

            const updatedSnapshot = await docRef.get();

            return {
                id: updatedSnapshot.id,
                ...(updatedSnapshot.data() as Omit<Noticia, "id">),
            };
        } catch (error) {
            console.error("❌ Error al actualizar noticia:", error);
            throw new Error(
                error instanceof Error
                    ? error.message
                    : "Error al actualizar la noticia"
            );
        }
    }


    /**
     * Elimina una noticia (soft delete - marca como inactivo)
     * @param id - ID de la noticia a eliminar
     * @returns Promise<void>
     */
    async deleteNew(id: string): Promise<void> {
        try {
            const docRef = firestoreApp.collection(NOTICIAS_COLLECTION).doc(id);
            const doc = await docRef.get();

            if (!doc.exists) {
                throw new Error(`Noticia con ID ${id} no encontrado`);
            }

            // Soft delete: marcar como inactivo
            const now = admin.firestore.Timestamp.now();
            await docRef.update({
                estatus: false,
                updatedAt: now,
            });

            console.log(`Noticia eliminada (inactivo): ID ${id}`);
        } catch (error) {
            console.error("Error al eliminar noticia:", error);
            throw new Error(
                error instanceof Error ? error.message : "Error al eliminar la noticia"
            );
        }
    }

    async generarIAParaNoticia(id: string): Promise<void> {
        const docRef = firestoreApp
            .collection(NOTICIAS_COLLECTION)
            .doc(id);

        const snapshot = await docRef.get();

        if (!snapshot.exists) {
            throw new Error("Noticia no encontrada");
        }

        const data = snapshot.data() as Noticia;

        if (!data.contenido) {
            throw new Error("La noticia no tiene contenido");
        }

        const ia = await iaService.generarContenidoIA(data.contenido);

        await docRef.update({
            ia,
            updatedAt: admin.firestore.Timestamp.now(),
        });
    }
}

// Exportar instancia única del servicio (Singleton)
export default new NewService();
