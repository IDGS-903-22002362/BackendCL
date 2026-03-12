import aiStorageService from "./storage/ai-storage.service";
import aiUploadValidatorService from "./storage/ai-upload-validator.service";
import tryOnAssetService from "./jobs/tryon-asset.service";
import aiConfig from "../../config/ai.config";
import { TryOnAsset, TryOnAssetKind } from "../../models/ai/ai.model";
import aiSessionService from "./memory/session.service";

class AiFileService {
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

    const validated = await aiUploadValidatorService.validateImage(input.file.buffer);
    const folder = `${aiConfig.storage.uploadFolder}/${input.userId}`;
    const uploaded = await aiStorageService.uploadPrivateFile({
      buffer: input.file.buffer,
      originalName: input.file.originalname,
      mimeType: validated.mimeType,
      folder,
    });

    return tryOnAssetService.createAsset({
      userId: input.userId,
      sessionId: input.sessionId,
      kind: TryOnAssetKind.USER_UPLOAD,
      bucket: uploaded.bucket,
      objectPath: uploaded.objectPath,
      mimeType: validated.mimeType,
      fileName: input.file.originalname,
      sizeBytes: uploaded.sizeBytes,
      width: validated.width,
      height: validated.height,
      sha256: uploaded.sha256,
    });
  }
}

export const aiFileService = new AiFileService();
export default aiFileService;
