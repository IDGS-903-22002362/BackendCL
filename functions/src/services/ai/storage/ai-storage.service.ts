import { createHash } from "crypto";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import aiConfig from "../../../config/ai.config";
import { storageTienda } from "../../../config/firebase";
import logger from "../../../utils/logger";

class AiStorageService {
  private readonly bucket = storageTienda.bucket(aiConfig.storage.bucket);
  private readonly baseLogger = logger.child({ component: "ai-storage-service" });

  getBucketName(): string {
    return this.bucket.name;
  }

  buildGcsUri(objectPath: string, bucketName = this.bucket.name): string {
    return `gs://${bucketName}/${objectPath}`;
  }

  async uploadPrivateFile(input: {
    buffer: Buffer;
    originalName: string;
    mimeType: string;
    folder: string;
  }): Promise<{ bucket: string; objectPath: string; sizeBytes: number; sha256: string; gcsUri: string }> {
    const ext = path.extname(input.originalName) || ".bin";
    const objectPath = `${input.folder}/${uuidv4()}${ext}`;
    const file = this.bucket.file(objectPath);
    const sha256 = createHash("sha256").update(input.buffer).digest("hex");

    await file.save(input.buffer, {
      resumable: false,
      metadata: {
        contentType: input.mimeType,
        cacheControl: "private, max-age=0, no-transform",
        metadata: {
          sha256,
        },
      },
      public: aiConfig.storage.makePublic,
      validation: false,
    });

    this.baseLogger.info("ai_storage_uploaded", {
      bucket: this.bucket.name,
      objectPath,
      sizeBytes: input.buffer.length,
    });

    return {
      bucket: this.bucket.name,
      objectPath,
      sizeBytes: input.buffer.length,
      sha256,
      gcsUri: `gs://${this.bucket.name}/${objectPath}`,
    };
  }

  async generateSignedDownloadUrl(objectPath: string): Promise<string> {
    const [url] = await this.bucket.file(objectPath).getSignedUrl({
      action: "read",
      expires: Date.now() + aiConfig.storage.signedUrlTtlSec * 1000,
      version: "v4",
    });

    return url;
  }

  async getObjectMetadata(
    objectPath: string,
    bucketName = this.bucket.name,
  ): Promise<{ sizeBytes: number; mimeType?: string }> {
    const [metadata] = await storageTienda.bucket(bucketName).file(objectPath).getMetadata();

    return {
      sizeBytes: Number(metadata.size || 0),
      mimeType: metadata.contentType,
    };
  }

  async copyGcsFile(sourceUri: string, destinationPath: string): Promise<{ bucket: string; objectPath: string; gcsUri: string }> {
    const match = sourceUri.match(/^gs:\/\/([^/]+)\/(.+)$/);
    if (!match) {
      throw new Error("GCS URI invalida");
    }

    const [, sourceBucket, sourceObjectPath] = match;
    const sourceFile = storageTienda.bucket(sourceBucket).file(sourceObjectPath);
    await sourceFile.copy(this.bucket.file(destinationPath));

    return {
      bucket: this.bucket.name,
      objectPath: destinationPath,
      gcsUri: `gs://${this.bucket.name}/${destinationPath}`,
    };
  }
}

export const aiStorageService = new AiStorageService();
export default aiStorageService;
