// services/storageNoticias.service.ts
import { storageAppOficial } from "../config/app.firebase";
import * as path from "path";
import { v4 as uuidv4 } from "uuid";

//apunta hacia el proyecto de app-oficial-leon, para almacenar las imagenes de noticias, galería, etc.
export class StorageNoticiasService {
    private bucket = storageAppOficial.bucket();

    async uploadFile(
        file: Buffer,
        originalName: string,
        folder: string = "noticias",
        mimeType?: string,
    ): Promise<string> {
        try {
            const fileExtension = path.extname(originalName);
            const fileName = `${folder}/${uuidv4()}${fileExtension}`;
            const fileUpload = this.bucket.file(fileName);
            const contentType = this.getContentType(fileExtension, mimeType);

            await fileUpload.save(file, {
                metadata: {
                    contentType,
                    metadata: { firebaseStorageDownloadTokens: uuidv4() },
                },
                public: true,
            });

            return `https://storage.googleapis.com/${this.bucket.name}/${fileName}`;
        } catch (error) {
            console.error("❌ Error al subir archivo a noticias:", error);
            throw new Error("Error al subir el archivo a Storage (noticias)");
        }
    }

    async uploadMultipleFiles(
        files: Array<{ buffer: Buffer; originalName: string; mimeType?: string }>,
        folder: string = "noticias",
    ): Promise<string[]> {
        try {
            const uploadPromises = files.map((file) =>
                this.uploadFile(file.buffer, file.originalName, folder, file.mimeType)
            );
            return await Promise.all(uploadPromises);
        } catch (error) {
            console.error("❌ Error al subir múltiples archivos a noticias:", error);
            throw new Error("Error al subir los archivos (noticias)");
        }
    }

    async deleteFile(fileUrl: string): Promise<void> {
        try {
            const fileName = this.getFileNameFromUrl(fileUrl);
            if (!fileName) throw new Error("URL de archivo inválida");
            const file = this.bucket.file(fileName);
            await file.delete();
            console.log(`✅ Archivo eliminado de noticias: ${fileName}`);
        } catch (error: any) {
            if (error.code === 404) {
                console.log("Archivo no encontrado en noticias, se omite eliminación");
                return;
            }
            console.error("❌ Error al eliminar archivo de noticias:", error);
            throw new Error("Error al eliminar el archivo (noticias)");
        }
    }

    async deleteMultipleFiles(fileUrls: string[]): Promise<void> {
        try {
            await Promise.all(fileUrls.map(url => this.deleteFile(url)));
        } catch (error) {
            console.error("❌ Error al eliminar múltiples archivos de noticias:", error);
        }
    }

    private getContentType(extension: string, mimeType?: string): string {
        if (mimeType) return mimeType;
        const types: Record<string, string> = {
            ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
            ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml",
            ".pdf": "application/pdf", ".mp4": "video/mp4", ".mp3": "audio/mpeg",
        };
        return types[extension.toLowerCase()] || "application/octet-stream";
    }

    private getFileNameFromUrl(url: string): string | null {
        try {
            const match = url.match(/googleapis\.com\/[^/]+\/(.+)$/);
            return match ? decodeURIComponent(match[1]) : null;
        } catch {
            return null;
        }
    }
}

export default new StorageNoticiasService();