/**
 * Servicio de Storage
 * Maneja la subida y gestión de archivos en Firebase Storage
 */

import { storage } from "../config/firebase";
import * as path from "path";
import { v4 as uuidv4 } from "uuid";

/**
 * Clase StorageService
 * Encapsula las operaciones de Firebase Storage
 */
export class StorageService {
  private bucket = storage.bucket();

  /**
   * Sube un archivo a Firebase Storage
   * @param file - Buffer del archivo
   * @param originalName - Nombre original del archivo
   * @param folder - Carpeta donde se guardará (ej: 'productos', 'categorias')
   * @returns Promise con la URL pública del archivo
   */
  async uploadFile(
    file: Buffer,
    originalName: string,
    folder: string = "productos"
  ): Promise<string> {
    try {
      // Generar nombre único para el archivo
      const fileExtension = path.extname(originalName);
      const fileName = `${folder}/${uuidv4()}${fileExtension}`;

      // Crear referencia al archivo
      const fileUpload = this.bucket.file(fileName);

      // Determinar el tipo de contenido
      const contentType = this.getContentType(fileExtension);

      // Subir el archivo
      await fileUpload.save(file, {
        metadata: {
          contentType: contentType,
          metadata: {
            firebaseStorageDownloadTokens: uuidv4(), // Token para URL pública
          },
        },
        public: true, // Hacer el archivo público
      });

      // Obtener URL pública
      const publicUrl = `https://storage.googleapis.com/${this.bucket.name}/${fileName}`;

      console.log(`✅ Archivo subido: ${fileName}`);
      return publicUrl;
    } catch (error) {
      console.error("❌ Error al subir archivo:", error);
      throw new Error("Error al subir el archivo a Storage");
    }
  }

  /**
   * Sube múltiples archivos
   * @param files - Array de buffers y nombres de archivos
   * @param folder - Carpeta donde se guardarán
   * @returns Promise con array de URLs públicas
   */
  async uploadMultipleFiles(
    files: Array<{ buffer: Buffer; originalName: string }>,
    folder: string = "productos"
  ): Promise<string[]> {
    try {
      const uploadPromises = files.map((file) =>
        this.uploadFile(file.buffer, file.originalName, folder)
      );

      const urls = await Promise.all(uploadPromises);
      return urls;
    } catch (error) {
      console.error("❌ Error al subir múltiples archivos:", error);
      throw new Error("Error al subir los archivos");
    }
  }

  /**
   * Elimina un archivo de Storage
   * @param fileUrl - URL del archivo a eliminar
   */
  async deleteFile(fileUrl: string): Promise<void> {
    try {
      // Extraer el nombre del archivo de la URL
      const fileName = this.getFileNameFromUrl(fileUrl);

      if (!fileName) {
        throw new Error("URL de archivo inválida");
      }

      const file = this.bucket.file(fileName);
      await file.delete();

      console.log(`✅ Archivo eliminado: ${fileName}`);
    } catch (error) {
      console.error("❌ Error al eliminar archivo:", error);
      throw new Error("Error al eliminar el archivo");
    }
  }

  /**
   * Elimina múltiples archivos
   * @param fileUrls - Array de URLs de archivos a eliminar
   */
  async deleteMultipleFiles(fileUrls: string[]): Promise<void> {
    try {
      const deletePromises = fileUrls.map((url) => this.deleteFile(url));
      await Promise.all(deletePromises);
    } catch (error) {
      console.error("❌ Error al eliminar múltiples archivos:", error);
      // No lanzar error para no bloquear otras operaciones
    }
  }

  /**
   * Obtiene el tipo de contenido según la extensión del archivo
   * @param extension - Extensión del archivo (con punto)
   * @returns Tipo MIME del archivo
   */
  private getContentType(extension: string): string {
    const contentTypes: { [key: string]: string } = {
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".png": "image/png",
      ".gif": "image/gif",
      ".webp": "image/webp",
      ".svg": "image/svg+xml",
      ".pdf": "application/pdf",
      ".mp4": "video/mp4",
      ".mp3": "audio/mpeg",
    };

    return contentTypes[extension.toLowerCase()] || "application/octet-stream";
  }

  /**
   * Extrae el nombre del archivo de una URL de Storage
   * @param url - URL del archivo
   * @returns Nombre del archivo o null
   */
  private getFileNameFromUrl(url: string): string | null {
    try {
      // Formato: https://storage.googleapis.com/bucket-name/folder/file.ext
      const match = url.match(/googleapis\.com\/[^/]+\/(.+)$/);
      return match ? decodeURIComponent(match[1]) : null;
    } catch {
      return null;
    }
  }
}

// Exportar instancia única del servicio (Singleton)
export default new StorageService();
