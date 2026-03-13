import path from "path";
import aiConfig from "../../../config/ai.config";
import { TryOnAssetKind, TryOnJob, TryOnJobStatus } from "../../../models/ai/ai.model";
import productService from "../../../services/product.service";
import logger from "../../../utils/logger";
import vertexTryOnAdapter, {
  VertexTryOnError,
} from "../adapters/vertex-tryon.adapter";
import aiSessionService from "../memory/session.service";
import aiStorageService from "../storage/ai-storage.service";
import tryOnAssetService from "./tryon-asset.service";
import tryOnJobService from "./tryon-job.service";

const normalizeToGcsUri = (url: string): string | null => {
  const gsMatch = url.match(/^gs:\/\/([^/]+)\/(.+)$/);
  if (gsMatch) {
    return url;
  }

  const publicMatch = url.match(/^https:\/\/storage.googleapis.com\/([^/]+)\/(.+)$/);
  if (publicMatch) {
    return `gs://${publicMatch[1]}/${decodeURI(publicMatch[2])}`;
  }

  if (url.startsWith("https://firebasestorage.googleapis.com/")) {
    try {
      const parsed = new URL(url);
      const pathMatch = parsed.pathname.match(/\/v0\/b\/([^/]+)\/o\/(.+)$/);
      if (!pathMatch) {
        return null;
      }

      return `gs://${pathMatch[1]}/${decodeURIComponent(pathMatch[2])}`;
    } catch {
      return null;
    }
  }

  return null;
};

const encodeObjectPathForPublicUrl = (objectPath: string): string =>
  objectPath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");

const downloadHttpImage = async (
  url: string,
): Promise<{ bytesBase64Encoded: string; mimeType?: string }> => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`No se pudo descargar imagen remota para try-on (${response.status})`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return {
    bytesBase64Encoded: Buffer.from(arrayBuffer).toString("base64"),
    mimeType: response.headers.get("content-type") || undefined,
  };
};

const resolveVertexImageInput = async (
  uri: string,
): Promise<{ bytesBase64Encoded: string; mimeType?: string }> => {
  if (uri.startsWith("gs://")) {
    const match = uri.match(/^gs:\/\/([^/]+)\/(.+)$/);
    if (!match) {
      throw new Error("GCS URI invalida para try-on");
    }

    const [, bucketName, objectPath] = match;
    if (bucketName === aiStorageService.getBucketName()) {
      const downloaded = await aiStorageService.downloadGcsFile(uri);
      return {
        bytesBase64Encoded: downloaded.buffer.toString("base64"),
        mimeType: downloaded.mimeType,
      };
    }

    const publicUrl = `https://storage.googleapis.com/${bucketName}/${encodeObjectPathForPublicUrl(objectPath)}`;
    return downloadHttpImage(publicUrl);
  }

  if (/^https?:\/\//.test(uri)) {
    return downloadHttpImage(uri);
  }

  throw new Error("Fuente de imagen no compatible para try-on");
};

class TryOnWorkflowService {
  private readonly baseLogger = logger.child({ component: "tryon-workflow-service" });

  async createJob(input: {
    userId: string;
    sessionId: string;
    productId: string;
    variantId?: string;
    sku?: string;
    userImageAssetId: string;
    consentAccepted: boolean;
    requestedByRole: TryOnJob["requestedByRole"];
  }): Promise<TryOnJob> {
    const [session, asset, product] = await Promise.all([
      aiSessionService.getSessionById(input.sessionId),
      tryOnAssetService.getAssetById(input.userImageAssetId),
      productService.getProductById(input.productId),
    ]);

    if (!session || session.userId !== input.userId) {
      throw new Error("Sesion AI invalida para crear try-on");
    }

    if (!asset || asset.userId !== input.userId) {
      throw new Error("Asset de usuario invalido para crear try-on");
    }

    if (asset.kind !== TryOnAssetKind.USER_UPLOAD) {
      throw new Error("El asset seleccionado no es una foto de usuario valida para try-on");
    }

    if (!product || !Array.isArray(product.imagenes) || product.imagenes.length === 0) {
      throw new Error("El producto seleccionado no tiene imagen oficial utilizable para try-on");
    }

    const productImageUrl = product.imagenes[0];
    const productImageGcsUri = normalizeToGcsUri(productImageUrl);
    if (!productImageGcsUri) {
      throw new Error("La imagen oficial del producto no es compatible con el flujo de try-on");
    }

    const job = await tryOnJobService.createJob({
      ...input,
      inputUserImageAssetId: asset.id!,
      inputUserImageUrl: aiStorageService.buildGcsUri(asset.objectPath, asset.bucket),
      inputProductImageUrl: productImageGcsUri,
    });

    await tryOnAssetService.attachJob(asset.id!, job.id!);
    return job;
  }

  async getJobStatus(jobId: string): Promise<TryOnJob | null> {
    return tryOnJobService.getJobById(jobId);
  }

  async getDownloadUrl(jobId: string): Promise<string | null> {
    const asset = await this.getDownloadAsset(jobId);
    if (!asset) {
      return null;
    }

    return aiStorageService.generateSignedDownloadUrl(asset.objectPath, asset.bucket);
  }

  async getDownloadAsset(jobId: string) {
    const job = await tryOnJobService.getJobById(jobId);
    if (!job || job.status !== TryOnJobStatus.COMPLETED || !job.outputAssetId) {
      return null;
    }

    const asset = await tryOnAssetService.getAssetById(job.outputAssetId);
    return asset || null;
  }

  async processQueuedJob(jobId: string): Promise<void> {
    const job = await tryOnJobService.getJobById(jobId);
    if (!job || job.status !== TryOnJobStatus.QUEUED) {
      this.baseLogger.info("tryon_job_skipped", {
        jobId,
        status: job?.status ?? "missing",
      });
      return;
    }

    this.baseLogger.info("tryon_job_transition", {
      jobId,
      fromStatus: TryOnJobStatus.QUEUED,
      toStatus: TryOnJobStatus.PROCESSING,
    });
    await tryOnJobService.markProcessing(jobId);

    try {
      const resultFolder = `${aiConfig.storage.resultFolder}/${job.userId}/${job.sessionId}`;
      const destinationPath = `${resultFolder}/${jobId}.png`;
      const [personImage, garmentImage] = await Promise.all([
        resolveVertexImageInput(job.inputUserImageUrl!),
        resolveVertexImageInput(job.inputProductImageUrl),
      ]);
      const vertexResult = await vertexTryOnAdapter.runTryOn({
        personImage,
        garmentImage,
      });

      let finalBucket = aiStorageService.getBucketName();
      let finalObjectPath = destinationPath;
      let finalMimeType = vertexResult.mimeType || "image/png";
      let finalSizeBytes = 0;
      let stableOutputUri = aiStorageService.buildGcsUri(destinationPath);

      if (vertexResult.outputImageBytesBase64) {
        const outputBuffer = Buffer.from(vertexResult.outputImageBytesBase64, "base64");
        const uploadResult = await aiStorageService.uploadPrivateFile({
          buffer: outputBuffer,
          originalName: `${jobId}.png`,
          mimeType: finalMimeType,
          folder: resultFolder,
        });

        finalBucket = uploadResult.bucket;
        finalObjectPath = uploadResult.objectPath;
        finalSizeBytes = uploadResult.sizeBytes;
        stableOutputUri = uploadResult.gcsUri;
      } else if (vertexResult.outputGcsUri) {
        const outputMatch = vertexResult.outputGcsUri.match(/^gs:\/\/([^/]+)\/(.+)$/);
        if (!outputMatch) {
          throw new Error("Vertex Try-On devolvio una GCS URI invalida");
        }

        const [, outputBucket, outputPath] = outputMatch;
        const isAlreadyInPrivateBucket =
          outputBucket === aiStorageService.getBucketName() &&
          outputPath.startsWith(`${resultFolder}/`);

        if (isAlreadyInPrivateBucket) {
          finalBucket = outputBucket;
          finalObjectPath = outputPath;
        } else {
          const copied = await aiStorageService.copyGcsFile(
            vertexResult.outputGcsUri,
            destinationPath,
          );
          finalBucket = copied.bucket;
          finalObjectPath = copied.objectPath;
        }

        const metadata = await aiStorageService.getObjectMetadata(finalObjectPath, finalBucket);
        finalMimeType = metadata.mimeType || finalMimeType;
        finalSizeBytes = metadata.sizeBytes;
        stableOutputUri = aiStorageService.buildGcsUri(finalObjectPath, finalBucket);
      } else {
        throw new Error("Vertex Try-On no devolvio salida utilizable");
      }

      const outputAsset = await tryOnAssetService.createAsset({
        userId: job.userId,
        sessionId: job.sessionId,
        jobId,
        productId: job.productId,
        variantId: job.variantId,
        sku: job.sku,
        kind: TryOnAssetKind.OUTPUT_IMAGE,
        bucket: finalBucket,
        objectPath: finalObjectPath,
        mimeType: finalMimeType,
        fileName: path.basename(finalObjectPath),
        sizeBytes: finalSizeBytes,
      });

      await tryOnJobService.markCompleted(jobId, outputAsset.id!, stableOutputUri);
      this.baseLogger.info("tryon_job_transition", {
        jobId,
        fromStatus: TryOnJobStatus.PROCESSING,
        toStatus: TryOnJobStatus.COMPLETED,
      });
      this.baseLogger.info("tryon_job_completed", {
        jobId,
        providerJobId: vertexResult.providerJobId,
        outputAssetId: outputAsset.id,
        outputImageUrl: stableOutputUri,
      });
    } catch (error) {
      const errorCode =
        error instanceof VertexTryOnError
          ? error.code
          : "TRYON_FAILED";
      const message = error instanceof Error ? error.message : "Error procesando try-on";

      this.baseLogger.error("tryon_job_failed", {
        jobId,
        errorCode,
        error: message,
      });
      await tryOnJobService.markFailed(jobId, errorCode, message);
      this.baseLogger.info("tryon_job_transition", {
        jobId,
        fromStatus: TryOnJobStatus.PROCESSING,
        toStatus: TryOnJobStatus.FAILED,
        errorCode,
      });
    }
  }
}

export const tryOnWorkflowService = new TryOnWorkflowService();
export default tryOnWorkflowService;
