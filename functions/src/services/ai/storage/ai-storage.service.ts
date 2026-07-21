import { createHash } from "crypto";
import { createReadStream } from "fs";
import { promises as fs } from "fs";
import path from "path";
import sharp from "sharp";
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

  /** Catalog uploads use the Firebase app's default bucket, not the private AI bucket. */
  getCatalogBucketName(): string {
    return storageTienda.bucket().name;
  }

  buildGcsUri(objectPath: string, bucketName = this.bucket.name): string {
    return `gs://${bucketName}/${objectPath}`;
  }

  async downloadGcsFile(
    sourceUri: string,
    expectedGeneration?: string,
  ): Promise<{ buffer: Buffer; mimeType?: string; sizeBytes: number }> {
    const match = sourceUri.match(/^gs:\/\/([^/]+)\/(.+)$/);
    if (!match) {
      throw new Error("GCS URI invalida");
    }

    const [, sourceBucket, sourceObjectPath] = match;
    const inspected = await this.inspectImageObject(sourceObjectPath, sourceBucket, expectedGeneration);
    const file = storageTienda.bucket(sourceBucket).file(sourceObjectPath, { generation: inspected.generation });
    const [buffer] = await file.download({ validation: false, decompress: false });
    const { fileTypeFromBuffer } = await import("file-type");
    const detected = await fileTypeFromBuffer(buffer);
    const cleanEnd = detected?.mime === "image/png" ? buffer.length >= 12 &&
      buffer.subarray(-12, -8).equals(Buffer.alloc(4)) && buffer.subarray(-8, -4).toString("ascii") === "IEND"
      : detected?.mime === "image/jpeg" ? buffer.length >= 2 && buffer.at(-2) === 0xff && buffer.at(-1) === 0xd9
        : detected?.mime === "image/webp" ? buffer.length >= 12 && buffer.readUInt32LE(4) + 8 === buffer.length : false;
    const decoded = await sharp(buffer, { sequentialRead: true, limitInputPixels: aiConfig.uploads.maxPixels }).metadata();
    if (detected?.mime !== inspected.mimeType || !cleanEnd ||
      decoded.width !== inspected.width || decoded.height !== inspected.height) {
      throw new Error("El contenido de la imagen GCS cambio o no es compatible");
    }

    return { buffer, mimeType: inspected.mimeType, sizeBytes: inspected.sizeBytes };
  }

  async inspectImageObject(
    objectPath: string,
    bucketName = this.bucket.name,
    expectedGeneration?: string,
  ): Promise<{ generation: string; sizeBytes: number; mimeType: string; width: number; height: number; sha256?: string }> {
    const current = storageTienda.bucket(bucketName).file(objectPath,
      expectedGeneration ? { generation: expectedGeneration } : undefined);
    const [metadata] = await current.getMetadata();
    const generation = String(metadata.generation || "");
    const sizeBytes = Number(metadata.size || 0);
    if (!generation || (expectedGeneration && generation !== expectedGeneration) ||
      !Number.isInteger(sizeBytes) || sizeBytes <= 0 || sizeBytes > aiConfig.uploads.maxBytes) {
      throw new Error("Objeto GCS no disponible para imagen AI");
    }
    const [prefix] = await storageTienda.bucket(bucketName).file(objectPath, { generation })
      .download({ start: 0, end: Math.min(sizeBytes, 256 * 1024) - 1, validation: false, decompress: false });
    const { fileTypeFromBuffer } = await import("file-type");
    const detected = await fileTypeFromBuffer(prefix);
    const image = detected && aiConfig.uploads.allowedMimeTypes.includes(detected.mime)
      ? await sharp(prefix, { sequentialRead: true, limitInputPixels: aiConfig.uploads.maxPixels }).metadata()
      : null;
    if (!detected || !image?.width || !image.height || image.width < aiConfig.uploads.minWidth ||
      image.height < aiConfig.uploads.minHeight || image.width * image.height > aiConfig.uploads.maxPixels) {
      throw new Error("Tipo o dimensiones reales de imagen GCS no permitidas");
    }
    return { generation, sizeBytes, mimeType: detected.mime, width: image.width, height: image.height,
      sha256: typeof metadata.metadata?.sha256 === "string" ? metadata.metadata.sha256 : undefined };
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

  async generateSignedDownloadUrl(
    objectPath: string,
    bucketName = this.bucket.name,
  ): Promise<string> {
    try {
      const [url] = await storageTienda.bucket(bucketName).file(objectPath).getSignedUrl({
        action: "read",
        expires: Date.now() + aiConfig.storage.signedUrlTtlSec * 1000,
        version: "v4",
      });

      return url;
    } catch (error) {
      this.baseLogger.error("ai_storage_signed_url_failed", {
        bucket: bucketName,
        objectPath,
        runtimeService: process.env.K_SERVICE || "unknown",
        functionTarget: process.env.FUNCTION_TARGET || "unknown",
        error: error instanceof Error ? error.message : "unknown_error",
      });

      throw error;
    }
  }

  async getObjectMetadata(
    objectPath: string,
    bucketName = this.bucket.name,
  ): Promise<{ sizeBytes: number; mimeType?: string; contentDisposition?: string }> {
    const [metadata] = await storageTienda.bucket(bucketName).file(objectPath).getMetadata();

    return {
      sizeBytes: Number(metadata.size || 0),
      mimeType: metadata.contentType,
      contentDisposition: metadata.contentDisposition,
    };
  }

  async deleteObject(objectPath: string, bucketName = this.bucket.name): Promise<void> {
    await storageTienda.bucket(bucketName).file(objectPath).delete({ ignoreNotFound: true });
    this.baseLogger.info("ai_storage_deleted", {
      bucket: bucketName,
      objectPath,
    });
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
