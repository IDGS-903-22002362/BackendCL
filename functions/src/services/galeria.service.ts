import { firestoreApp, storageAppOficial } from "../config/app.firebase";
import { admin } from "../config/firebase.admin";
import {
    CreateGaleriaMediaMetadata,
    Galeria,
    GaleriaMediaMetadata,
} from "../models/galeria.model";

const GALERIA_COLLECTION = "galeria";

export class GalleryServiceError extends Error {
    constructor(public readonly code: "NOT_FOUND", message: string) {
        super(message);
    }
}

class GalleryService {

    private collection = firestoreApp.collection(GALERIA_COLLECTION);
    //private extractFilePathFromUrl(url: string): string | null {
    //try {
    // const decoded = decodeURIComponent(url);
    // const match = decoded.match(/\/o\/(.*?)\?/);
    // return match ? match[1] : null;
    //} catch {
    //return null;
    //}
    //}

    private mapDoc(doc: FirebaseFirestore.DocumentSnapshot): Galeria {

        const data = doc.data()!;

        const normalize = (date: any): Date => {
            if (!date) return new Date();
            if (typeof date.toDate === "function") return date.toDate();
            if (date instanceof Date) return date;
            return new Date(date);
        };

        return {
            id: doc.id,
            descripcion: data.descripcion,
            imagenes: data.imagenes ?? [],
            videos: data.videos ?? [],
            usuarioId: data.usuarioId,
            autorNombre: data.autorNombre,
            estatus: data.estatus,
            createdAt: normalize(data.createdAt),
            updatedAt: normalize(data.updatedAt),
        };
    }

    convertDates(data: any) {
        const converted = { ...data };

        if (data.createdAt instanceof Date) {
            converted.createdAt = admin.firestore.Timestamp.fromDate(data.createdAt);
        }

        if (data.updatedAt instanceof Date) {
            converted.updatedAt = admin.firestore.Timestamp.fromDate(data.updatedAt);
        }

        return converted;
    }

    async getAll(): Promise<Galeria[]> {

        const snapshot = await this.collection
            .get();

        return snapshot.docs.map(doc => this.mapDoc(doc));
    }

    async getById(id: string): Promise<Galeria | null> {

        const doc = await this.collection.doc(id).get();

        if (!doc.exists) return null;

        return this.mapDoc(doc);
    }

    async create(data: Partial<Galeria>, userId: string, autorNombre?: string) {

        const now = new Date();

        const docRef = this.collection.doc();

        const gallery: Galeria = {
            id: docRef.id,
            descripcion: data.descripcion ?? "",
            imagenes: [],
            videos: [],
            usuarioId: userId,
            autorNombre,
            estatus: true,
            createdAt: now,
            updatedAt: now,
        };

        await docRef.set(this.convertDates(gallery));

        return gallery;
    }

    async addMediaMetadata(
        galeriaId: string,
        input: CreateGaleriaMediaMetadata,
    ): Promise<GaleriaMediaMetadata> {
        const docRef = this.collection.doc(galeriaId);
        const snapshot = await docRef.get();

        if (!snapshot.exists) {
            throw new GalleryServiceError("NOT_FOUND", "Galeria no encontrada");
        }

        console.log("Guardando metadata de Galeria:", {
            galeriaId,
            tipo: input.tipo,
            contentType: input.contentType,
            size: input.size,
            storagePath: input.storagePath,
        });

        const mediaRef = docRef.collection("media").doc();
        const now = admin.firestore.Timestamp.now();
        const mediaData = {
            ...input,
            id: mediaRef.id,
            galeriaId,
            estado: true,
            creadoEn: now,
            actualizadoEn: now,
        };

        const arrayField = input.tipo === "imagen" ? "imagenes" : "videos";
        const batch = firestoreApp.batch();
        batch.set(mediaRef, mediaData);
        batch.update(docRef, {
            [arrayField]: admin.firestore.FieldValue.arrayUnion(input.url),
            updatedAt: now,
        });

        await batch.commit();

        return {
            ...input,
            id: mediaRef.id,
            galeriaId,
            estado: true,
            creadoEn: now.toDate(),
            actualizadoEn: now.toDate(),
        };
    }


    async deleteImage(id: string, imageUrl: string) {
        const docRef = this.collection.doc(id);
        const snapshot = await docRef.get();

        if (!snapshot.exists) {
            throw new Error("Galería no encontrada");
        }

        // 🔑 Extraer el path del archivo desde la URL de Firebase Storage
        try {
            const bucket = storageAppOficial.bucket();
            const urlObj = new URL(imageUrl);
            const pathParts = urlObj.pathname.split('/');
            // La URL es: https://storage.googleapis.com/BUCKET_NAME/ruta/al/archivo
            const filePath = pathParts.slice(2).join('/'); // Remover /BUCKET_NAME/

            if (filePath) {
                const file = bucket.file(filePath);
                await file.delete().catch(err => {
                    console.warn("No se pudo eliminar archivo de storage:", err.message);
                });
            }
        } catch (error) {
            console.warn("Error al extraer path de URL:", error);
        }

        // Eliminar del documento
        await docRef.update({
            imagenes: admin.firestore.FieldValue.arrayRemove(imageUrl),
            updatedAt: admin.firestore.Timestamp.now(),
        });

        return true;
    }

    async deleteVideo(id: string, videoUrl: string) {
        const docRef = this.collection.doc(id);
        const snapshot = await docRef.get();

        if (!snapshot.exists) {
            throw new Error("Galería no encontrada");
        }

        // 🔑 Extraer el path del archivo desde la URL
        try {
            const bucket = storageAppOficial.bucket();
            const urlObj = new URL(videoUrl);
            const pathParts = urlObj.pathname.split('/');
            const filePath = pathParts.slice(2).join('/');

            if (filePath) {
                const file = bucket.file(filePath);
                await file.delete().catch(err => {
                    console.warn("No se pudo eliminar archivo de storage:", err.message);
                });
            }
        } catch (error) {
            console.warn("Error al extraer path de URL:", error);
        }

        // Eliminar del documento
        await docRef.update({
            videos: admin.firestore.FieldValue.arrayRemove(videoUrl),
            updatedAt: admin.firestore.Timestamp.now(),
        });

        return true;
    }

    async reactivateGallery(id: string): Promise<Galeria> {
        try {
            const docRef = this.collection.doc(id);
            const doc = await docRef.get();

            if (!doc.exists) {
                throw new Error(`Galeria con ID ${id} no encontrada`);
            }

            // Usamos el mapper para obtener la noticia con el formato correcto
            const galeria = this.mapDoc(doc);

            // Si ya está activa, la devolvemos directamente
            if (galeria.estatus) {
                return galeria;
            }

            const now = admin.firestore.Timestamp.now();
            await docRef.update({
                estatus: true,
                updatedAt: now,
            });

            const updatedDoc = await docRef.get();
            return this.mapDoc(updatedDoc);
        } catch (error) {
            console.error('Error al reactivar galeria:', error);
            throw new Error(error instanceof Error ? error.message : 'Error al reactivar la galeria');
        }
    }

    async delete(id: string) {
        const docRef = this.collection.doc(id);
        const snapshot = await docRef.get();
        if (!snapshot.exists) {
            throw new Error("Galería no encontrada");
        }
        await docRef.update({
            estatus: false,
            updatedAt: admin.firestore.Timestamp.now()
        });
    }

}

export default new GalleryService();
