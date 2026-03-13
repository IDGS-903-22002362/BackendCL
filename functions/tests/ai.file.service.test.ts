jest.mock("../src/services/ai/storage/ai-storage.service", () => ({
  __esModule: true,
  default: {
    uploadPrivateFileFromPath: jest.fn(),
  },
}));

jest.mock("../src/services/ai/storage/ai-upload-validator.service", () => ({
  __esModule: true,
  default: {
    validateImage: jest.fn(),
  },
}));

jest.mock("../src/services/ai/jobs/tryon-asset.service", () => ({
  __esModule: true,
  default: {
    createAsset: jest.fn(),
  },
}));

jest.mock("../src/services/ai/memory/session.service", () => ({
  __esModule: true,
  default: {
    getSessionById: jest.fn(),
  },
}));

import os from "os";
import path from "path";
import { promises as fs } from "fs";
import aiFileService from "../src/services/ai/ai-file.service";
import aiStorageService from "../src/services/ai/storage/ai-storage.service";
import aiUploadValidatorService from "../src/services/ai/storage/ai-upload-validator.service";
import tryOnAssetService from "../src/services/ai/jobs/tryon-asset.service";
import aiSessionService from "../src/services/ai/memory/session.service";

const mockedStorage = aiStorageService as jest.Mocked<typeof aiStorageService>;
const mockedValidator = aiUploadValidatorService as jest.Mocked<
  typeof aiUploadValidatorService
>;
const mockedAssetService = tryOnAssetService as jest.Mocked<
  typeof tryOnAssetService
>;
const mockedSessionService = aiSessionService as jest.Mocked<
  typeof aiSessionService
>;

describe("AI file service", () => {
  const tempFiles: string[] = [];

  afterEach(async () => {
    jest.clearAllMocks();
    await Promise.allSettled(tempFiles.map(async (filePath) => fs.unlink(filePath)));
    tempFiles.length = 0;
  });

  it("valida y sube la imagen desde un archivo temporal, limpiándolo al final", async () => {
    const tempFilePath = path.join(os.tmpdir(), `ai-file-service-${Date.now()}.png`);
    tempFiles.push(tempFilePath);
    await fs.writeFile(tempFilePath, Buffer.from("fake-image"));

    mockedSessionService.getSessionById.mockResolvedValue({
      id: "session_1",
      userId: "user_1",
    } as never);
    mockedValidator.validateImage.mockResolvedValue({
      mimeType: "image/png",
      width: 1024,
      height: 1024,
      format: "png",
    });
    mockedStorage.uploadPrivateFileFromPath.mockResolvedValue({
      bucket: "bucket",
      objectPath: "ai/uploads/user_1/test.png",
      sizeBytes: 123,
      sha256: "hash",
      gcsUri: "gs://bucket/ai/uploads/user_1/test.png",
    });
    mockedAssetService.createAsset.mockResolvedValue({
      id: "asset_1",
    } as never);

    await aiFileService.uploadUserImage({
      userId: "user_1",
      sessionId: "session_1",
      file: {
        originalname: "photo.png",
        path: tempFilePath,
      } as Express.Multer.File,
    });

    expect(mockedValidator.validateImage).toHaveBeenCalledWith(tempFilePath);
    expect(mockedStorage.uploadPrivateFileFromPath).toHaveBeenCalledWith(
      expect.objectContaining({
        filePath: tempFilePath,
        originalName: "photo.png",
      }),
    );

    await expect(fs.access(tempFilePath)).rejects.toThrow();
    tempFiles.length = 0;
  });

  it("limpia el archivo temporal si la validación falla", async () => {
    const tempFilePath = path.join(os.tmpdir(), `ai-file-service-${Date.now()}-invalid.png`);
    tempFiles.push(tempFilePath);
    await fs.writeFile(tempFilePath, Buffer.from("fake-image"));

    mockedValidator.validateImage.mockRejectedValue(new Error("invalid"));

    await expect(
      aiFileService.uploadUserImage({
        userId: "user_1",
        file: {
          originalname: "photo.png",
          path: tempFilePath,
        } as Express.Multer.File,
      }),
    ).rejects.toThrow("invalid");

    await expect(fs.access(tempFilePath)).rejects.toThrow();
    tempFiles.length = 0;
  });
});
