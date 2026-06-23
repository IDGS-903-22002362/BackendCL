import aiStorageService from "./storage/ai-storage.service";
import aiUploadValidatorService from "./storage/ai-upload-validator.service";
import tryOnAssetService from "./jobs/tryon-asset.service";
import aiConfig from "../../config/ai.config";
import { TryOnAsset, TryOnAssetKind } from "../../models/ai/ai.model";
import aiSessionService from "./memory/session.service";
import { promises as fs } from "fs";

class AiFileService {
  async deleteUserImage(input: {
    userId: string;
    assetId: string;
  }): Promise<void> {
    const asset = await tryOnAssetService.getAssetById(input.assetId);
    if (!asset || asset.userId !== input.userId) {
      throw new Error("Imagen no encontrada");
    }

    if (asset.kind !== TryOnAssetKind.USER_UPLOAD) {
      throw new Error("Solo puedes eliminar fotos personales subidas para try-on");
    }

    await aiStorageService.deleteObject(asset.objectPath, asset.bucket);
    await tryOnAssetService.deleteAsset(input.assetId);
  }

  async uploadUserImage(input: {
    userId: string;
    sessionId?: string;
    file: Express.Multer.File;
  }): Promise<TryOnAsset> {
    if (input.sessionId) {
      const session = await aiSessionService.getSessionById(input.sessionId);
      if (!session || session.userId !== input.userId) {
        throw new Error("La sesion AI no pertenece al usuario autenticado");
      }
    }

    if (!input.file.path) {
      throw new Error("La imagen cargada no tiene una ruta temporal válida");
    }

    try {
      const validated = await aiUploadValidatorService.validateImage(input.file.path);
      const sanitized = await aiUploadValidatorService.sanitizeImage(
        input.file.path,
        validated,
      );
      const folder = `${aiConfig.storage.uploadFolder}/${input.userId}`;
      const uploaded = await aiStorageService.uploadPrivateFileFromPath({
        filePath: sanitized.outputPath,
        originalName: `user-upload.${sanitized.mimeType === "image/png" ? "png" : "jpg"}`,
        mimeType: sanitized.mimeType,
        folder,
      });

      return tryOnAssetService.createAsset({
        userId: input.userId,
        sessionId: input.sessionId,
        kind: TryOnAssetKind.USER_UPLOAD,
        bucket: uploaded.bucket,
        objectPath: uploaded.objectPath,
        mimeType: sanitized.mimeType,
        fileName: "user-upload",
        sizeBytes: uploaded.sizeBytes,
        width: validated.width,
        height: validated.height,
        sha256: uploaded.sha256,
      });
    } finally {
      await fs.unlink(input.file.path).catch(() => undefined);
      const sanitizedPath = `${input.file.path}.sanitized.jpg`;
      await fs.unlink(sanitizedPath).catch(() => undefined);
    }
  }
}

export const aiFileService = new AiFileService();
export default aiFileService;
