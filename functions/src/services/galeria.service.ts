import { firestoreApp } from "../config/app.firebase";
import { admin } from "../config/firebase.admin";
import { Galeria } from "../models/galeria.model";

const GALERIA_COLLECTION = "galeria";

class GalleryService {

    private collection = firestoreApp.collection(GALERIA_COLLECTION);
    private extractFilePathFromUrl(url: string): string | null {
        try {
            const decoded = decodeURIComponent(url);
            const match = decoded.match(/\/o\/(.*?)\?/);
            return match ? match[1] : null;
        } catch {
            return null;
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
            .where("estatus", "==", true)
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

    async deleteImage(id: string, imageUrl: string) {

        const docRef = this.collection.doc(id);
        const snapshot = await docRef.get();

        if (!snapshot.exists) {
            throw new Error("Galería no encontrada");
        }

        // borrar de storage
        const filePath = this.extractFilePathFromUrl(imageUrl);

        if (filePath) {
            await admin.storage().bucket().file(filePath).delete().catch(() => { });
        }

        // borrar del documento
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

        // borrar de storage
        const filePath = this.extractFilePathFromUrl(videoUrl);

        if (filePath) {
            await admin.storage().bucket().file(filePath).delete().catch(() => { });
        }

        // borrar del documento
        await docRef.update({
            videos: admin.firestore.FieldValue.arrayRemove(videoUrl),
            updatedAt: admin.firestore.Timestamp.now(),
        });

        return true;
    }

}

export default new GalleryService();