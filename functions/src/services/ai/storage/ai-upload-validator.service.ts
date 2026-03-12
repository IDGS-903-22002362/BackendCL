import sharp from "sharp";
import aiConfig from "../../../config/ai.config";

export interface ValidatedAiImage {
  mimeType: string;
  width: number;
  height: number;
  format: string;
}

class AiUploadValidatorService {
  async validateImage(buffer: Buffer): Promise<ValidatedAiImage> {
    const { fileTypeFromBuffer } = await import("file-type");
    const detected = await fileTypeFromBuffer(buffer);
    const mimeType = detected?.mime;

    if (!mimeType || !aiConfig.uploads.allowedMimeTypes.includes(mimeType)) {
      throw new Error("Tipo de archivo no permitido para uploads AI");
    }

    let metadata;
    try {
      metadata = await sharp(buffer).metadata();
    } catch {
      throw new Error("La imagen esta corrupta o no se puede procesar");
    }

    if (!metadata.width || !metadata.height) {
      throw new Error("No se pudo determinar el tamano de la imagen");
    }

    if (metadata.width < aiConfig.uploads.minWidth || metadata.height < aiConfig.uploads.minHeight) {
      throw new Error("La imagen es demasiado pequena para try-on");
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
