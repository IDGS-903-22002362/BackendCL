/**
 * Servicio de Productos
 * Maneja toda la lógica de negocio relacionada con productos
 */

import { firestoreApp } from "../config/app.firebase";
import { admin } from "../config/firebase.admin";
import { ActualizarNoticiaDTO, CrearNoticiaDTO } from "../models/noticias.dto";
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
    private collection = firestoreApp.collection(NOTICIAS_COLLECTION);

    // ===============================
    // 🔹 Helpers privados
    // ===============================

    private mapDocToNoticia(doc: FirebaseFirestore.DocumentSnapshot): Noticia {
        const data = doc.data()!;

        // Función interna para normalizar la fecha sin que truene
        const normalizarFecha = (fecha: any): Date => {
            if (!fecha) return new Date();
            // Si es un Timestamp de Firebase (tiene el método toDate)
            if (typeof fecha.toDate === 'function') return fecha.toDate();
            // Si ya es un objeto Date
            if (fecha instanceof Date) return fecha;
            // Si es un String (como los de Instagram) o un número
            return new Date(fecha);
        };

        return {
            id: doc.id,
            titulo: data.titulo,
            descripcion: data.descripcion,
            contenido: data.contenido,
            imagenes: data.imagenes ?? [],
            origen: data.origen,
            usuarioId: data.usuarioId,
            autorNombre: data.autorNombre,
            estatus: data.estatus,
            createdAt: normalizarFecha(data.createdAt),
            updatedAt: normalizarFecha(data.updatedAt),
            // Asegúrate de incluir los campos nuevos si los necesitas en el modelo
            ...data
        } as Noticia;
    }

    private convertDatesToTimestamp(data: any) {
        const converted = { ...data };
        if (data.createdAt instanceof Date) {
            converted.createdAt = admin.firestore.Timestamp.fromDate(data.createdAt);
        }
        if (data.updatedAt instanceof Date) {
            converted.updatedAt = admin.firestore.Timestamp.fromDate(data.updatedAt);
        }
        return converted;
    }

    async getAllNews(): Promise<Noticia[]> {
        const snapshot = await this.collection
            .where("estatus", "==", true)
            .get();

        return snapshot.docs.map(doc => this.mapDocToNoticia(doc));
    }

    async getNewsById(id: string): Promise<Noticia | null> {
        const doc = await this.collection.doc(id).get();
        if (!doc.exists) return null;
        return this.mapDocToNoticia(doc);
    }

    async searchNews(searchTerm: string): Promise<Noticia[]> {
        try {
            const searchTermLower = searchTerm.toLowerCase();
            const snapshot = await this.collection // Usar this.collection es más limpio
                .where("estatus", "==", true)
                .get();

            // CORRECCIÓN AQUÍ: Usamos mapDocToNoticia para que las fechas no rompan
            return snapshot.docs
                .map(doc => this.mapDocToNoticia(doc))
                .filter(
                    (noticia) =>
                        noticia.descripcion?.toLowerCase().includes(searchTermLower) ||
                        noticia.titulo?.toLowerCase().includes(searchTermLower)
                );
        } catch (error) {
            console.error("❌ Error al buscar noticias:", error);
            throw new Error("Error al buscar noticias");
        }
    }

    /**
     * Crea una nueva noticia
     * @param noticiaData - Datos de la noticia a crear
     * @returns Promise con la noticia creado incluyendo su ID
     */
    async createNew(dto: CrearNoticiaDTO): Promise<Noticia> {
        const now = new Date();

        const noticia: Noticia = {
            id: "",
            titulo: dto.titulo,
            descripcion: dto.descripcion,
            contenido: dto.contenido,
            imagenes: dto.imagenes ?? [],
            origen: "app",
            estatus: true,
            createdAt: now,
            updatedAt: now,
        };

        const docRef = await this.collection.add(
            this.convertDatesToTimestamp(noticia)
        );

        return {
            ...noticia,
            id: docRef.id,
        };
    }


    /**
 * Actualiza una noticia existente
 * @param id - ID de la noticia a actualizar (doc.id)
 * @param updateData - Datos parciales a actualizar
 * @returns Promise con la noticia actualizada
 */
    async updateNew(
        id: string,
        dto: ActualizarNoticiaDTO
    ): Promise<Noticia> {

        const docRef = this.collection.doc(id);
        const snapshot = await docRef.get();

        if (!snapshot.exists) {
            throw new Error(`Noticia con ID ${id} no encontrada`);
        }

        const updateData = {
            ...dto,
            updatedAt: new Date(),
        };

        await docRef.update(
            this.convertDatesToTimestamp(updateData)
        );

        const updatedDoc = await docRef.get();

        return this.mapDocToNoticia(updatedDoc);
    }


    /**
     * Elimina una noticia (soft delete - marca como inactivo)
     * @param id - ID de la noticia a eliminar
     * @returns Promise<void>
     */
    async deleteNew(id: string): Promise<void> {
        const docRef = this.collection.doc(id);
        const snapshot = await docRef.get();

        if (!snapshot.exists) {
            throw new Error(`Noticia con ID ${id} no encontrada`);
        }

        await docRef.update({
            estatus: false,
            updatedAt: admin.firestore.Timestamp.now(),
        });
    }

    async generarIAParaNoticia(id: string): Promise<void> {
        const docRef = this.collection.doc(id);
        const snapshot = await docRef.get();

        if (!snapshot.exists) {
            throw new Error("Noticia no encontrada");
        }

        const noticia = this.mapDocToNoticia(snapshot);

        if (!noticia.contenido) {
            throw new Error("La noticia no tiene contenido");
        }

        const ia = await iaService.generarContenidoIA(noticia.contenido);

        await docRef.update({
            ia,
            updatedAt: admin.firestore.Timestamp.now(),
        });
    }
}

// Exportar instancia única del servicio (Singleton)
export default new NewService();
