import multer from "multer";
import aiConfig from "../../../config/ai.config";
import { ApiError } from "../../../utils/error-handler";

export const aiUploadMiddleware = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: aiConfig.uploads.maxBytes,
    files: aiConfig.uploads.maxFiles,
  },
  fileFilter: (_req, file, callback) => {
    if (!aiConfig.uploads.allowedMimeTypes.includes(file.mimetype)) {
      callback(new ApiError(400, "Tipo de archivo no permitido para uploads AI"));
      return;
    }

    callback(null, true);
  },
});

export default aiUploadMiddleware;
