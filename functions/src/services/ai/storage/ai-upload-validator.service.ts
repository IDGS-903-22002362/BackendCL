import sharp from "sharp";
import { promises as fs } from "fs";
import aiConfig from "../../../config/ai.config";

export interface ValidatedAiImage {
  mimeType: string;
  width: number;
  height: number;
  format: string;
}

class AiUploadValidatorService {
  constructor() {
    sharp.cache({ memory: 10, files: 0, items: 0 });
    sharp.concurrency(1);
  }

  async validateImage(filePath: string): Promise<ValidatedAiImage> {
    const { fileTypeFromBuffer } = await import("file-type");
    const fileHandle = await fs.open(filePath, "r");
    const headerBuffer = Buffer.alloc(4100);
    const { bytesRead } = await fileHandle.read(headerBuffer, 0, headerBuffer.length, 0);
    await fileHandle.close();

    const detected = await fileTypeFromBuffer(headerBuffer.subarray(0, bytesRead));
    const mimeType = detected?.mime;

    if (!mimeType || !aiConfig.uploads.allowedMimeTypes.includes(mimeType)) {
      throw new Error("Tipo de archivo no permitido para uploads AI");
    }

    let metadata;
    try {
      metadata = await sharp(filePath, {
        sequentialRead: true,
        limitInputPixels: aiConfig.uploads.maxPixels,
      }).metadata();
    } catch (error) {
      if (error instanceof Error && error.message.toLowerCase().includes("pixel limit")) {
        throw new Error("La imagen excede el límite máximo de pixeles permitido");
      }
      throw new Error("La imagen esta corrupta o no se puede procesar");
    }

    if (!metadata.width || !metadata.height) {
      throw new Error("No se pudo determinar el tamano de la imagen");
    }

    if (metadata.width < aiConfig.uploads.minWidth || metadata.height < aiConfig.uploads.minHeight) {
      throw new Error("La imagen es demasiado pequena para try-on");
    }

    if (metadata.width * metadata.height > aiConfig.uploads.maxPixels) {
      throw new Error("La imagen excede el límite máximo de pixeles permitido");
    }

    return {
      mimeType,
      width: metadata.width,
      height: metadata.height,
      format: metadata.format || "unknown",
    };
  }
}

export const aiUploadValidatorService = new AiUploadValidatorService();
export default aiUploadValidatorService;
