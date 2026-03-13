import { createHash } from "crypto";
import { createReadStream } from "fs";
import { promises as fs } from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import aiConfig from "../../../config/ai.config";
import { storageTienda } from "../../../config/firebase";
import logger from "../../../utils/logger";

class AiStorageService {
  private readonly bucket = storageTienda.bucket(aiConfig.storage.bucket);
  private readonly baseLogger = logger.child({ component: "ai-storage-service" });

  private async hashFile(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = createHash("sha256");
      const stream = createReadStream(filePath);

      stream.on("data", (chunk: string | Buffer) => {
        hash.update(chunk);
      });
      stream.on("error", reject);
      stream.on("end", () => {
        resolve(hash.digest("hex"));
      });
    });
  }

  getBucketName(): string {
    return this.bucket.name;
  }

  buildGcsUri(objectPath: string, bucketName = this.bucket.name): string {
    return `gs://${bucketName}/${objectPath}`;
  }

  async downloadGcsFile(
    sourceUri: string,
  ): Promise<{ buffer: Buffer; mimeType?: string; sizeBytes: number }> {
    const match = sourceUri.match(/^gs:\/\/([^/]+)\/(.+)$/);
    if (!match) {
      throw new Error("GCS URI invalida");
    }

    const [, sourceBucket, sourceObjectPath] = match;
    const file = storageTienda.bucket(sourceBucket).file(sourceObjectPath);
    const [[buffer], [metadata]] = await Promise.all([
      file.download(),
      file.getMetadata(),
    ]);

    return {
      buffer,
      mimeType: metadata.contentType,
      sizeBytes: Number(metadata.size || buffer.length),
    };
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

  async uploadPrivateFileFromPath(input: {
    filePath: string;
    originalName: string;
    mimeType: string;
    folder: string;
  }): Promise<{ bucket: string; objectPath: string; sizeBytes: number; sha256: string; gcsUri: string }> {
    const ext = path.extname(input.originalName) || path.extname(input.filePath) || ".bin";
    const objectPath = `${input.folder}/${uuidv4()}${ext}`;
    const file = this.bucket.file(objectPath);
    const [fileStat, sha256] = await Promise.all([
      fs.stat(input.filePath),
      this.hashFile(input.filePath),
    ]);

    await this.bucket.upload(input.filePath, {
      destination: objectPath,
      resumable: false,
      metadata: {
        contentType: input.mimeType,
        cacheControl: "private, max-age=0, no-transform",
        metadata: {
          sha256,
        },
      },
      validation: false,
    });

    if (aiConfig.storage.makePublic) {
      await file.makePublic();
    }

    this.baseLogger.info("ai_storage_uploaded", {
      bucket: this.bucket.name,
      objectPath,
      sizeBytes: fileStat.size,
    });

    return {
      bucket: this.bucket.name,
      objectPath,
      sizeBytes: fileStat.size,
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
