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

    private extractStoragePath(urlOrPath: string): string | null {
        const value = urlOrPath.trim();
        if (!value) return null;

        if (!value.startsWith("http://") && !value.startsWith("https://")) {
            return value.replace(/^\/+/, "");
        }

        try {
            const parsed = new URL(value);

            if (parsed.hostname === "storage.googleapis.com") {
                const parts = parsed.pathname.split("/").filter(Boolean);
                return parts.length > 1 ? decodeURIComponent(parts.slice(1).join("/")) : null;
            }

            if (parsed.hostname === "firebasestorage.googleapis.com") {
                const match = parsed.pathname.match(/\/o\/(.+)$/);
                return match ? decodeURIComponent(match[1]) : null;
            }
        } catch {
            return null;
        }

        return null;
    }

    private async deleteStorageObject(urlOrPath: string): Promise<void> {
        const filePath = this.extractStoragePath(urlOrPath);
        if (!filePath) return;

        try {
            await storageAppOficial.bucket().file(filePath).delete();
        } catch (error: any) {
            if (error?.code === 404) return;
            console.warn("No se pudo eliminar archivo de storage:", error?.message || error);
        }
    }

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

        await this.deleteStorageObject(imageUrl);

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

        await this.deleteStorageObject(videoUrl);

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

    async permanentlyDelete(id: string): Promise<{ deletedMediaCount: number }> {
        const docRef = this.collection.doc(id);
        const snapshot = await docRef.get();

        if (!snapshot.exists) {
            throw new Error("Galería no encontrada");
        }

        const gallery = this.mapDoc(snapshot);
        const mediaSnapshot = await docRef.collection("media").get();
        const mediaUrls = new Set<string>();
        const storagePaths = new Set<string>();

        for (const url of [...gallery.imagenes, ...gallery.videos]) {
            if (url) mediaUrls.add(url);
        }

        for (const mediaDoc of mediaSnapshot.docs) {
            const data = mediaDoc.data() as { url?: string; storagePath?: string };
            if (data.url) mediaUrls.add(data.url);
            if (data.storagePath) storagePaths.add(data.storagePath);
        }

        const bucket = storageAppOficial.bucket();

        await Promise.all([
            ...[...mediaUrls].map((url) => this.deleteStorageObject(url)),
            ...[...storagePaths].map((path) => this.deleteStorageObject(path)),
            bucket.deleteFiles({ prefix: `galeria/${id}/` }).catch(() => undefined),
            bucket.deleteFiles({ prefix: `reels/${id}/` }).catch(() => undefined),
        ]);

        const refsToDelete = [
            ...mediaSnapshot.docs.map((doc) => doc.ref),
            docRef,
        ];

        for (let index = 0; index < refsToDelete.length; index += 450) {
            const batch = firestoreApp.batch();
            refsToDelete.slice(index, index + 450).forEach((ref) => batch.delete(ref));
            await batch.commit();
        }

        return { deletedMediaCount: mediaUrls.size };
    }

}

export default new GalleryService();
