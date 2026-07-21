import path from "path";
import aiConfig from "../../../config/ai.config";
import { admin } from "../../../config/firebase.admin";
import {
  AiSessionStatus,
  ProductPreviewMode,
  TryOnAssetKind,
  TryOnJob,
  TryOnJobStatus,
} from "../../../models/ai/ai.model";
import logger from "../../../utils/logger";
import {
  AiRuntimeError,
  AI_TRYON_IDEMPOTENCY_CONFLICT_CODE,
  AI_TRYON_SESSION_UNAVAILABLE_CODE,
  PRODUCT_PREVIEW_UNSUPPORTED_CODE,
} from "../ai.error";
import vertexTryOnAdapter, {
  VertexTryOnError,
} from "../adapters/vertex-tryon.adapter";
import aiSessionService from "../memory/session.service";
import aiStorageService from "../storage/ai-storage.service";
import tryOnAssetService from "./tryon-asset.service";
import tryOnEligibilityService from "./tryon-eligibility.service";
import tryOnJobService from "./tryon-job.service";

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
  generation?: string,
): Promise<{ bytesBase64Encoded: string; mimeType?: string }> => {
  if (uri.startsWith("gs://")) {
    const match = uri.match(/^gs:\/\/([^/]+)\/(.+)$/);
    if (!match) {
      throw new Error("GCS URI invalida para try-on");
    }

    const [, bucketName, objectPath] = match;
    if (generation || bucketName === aiStorageService.getBucketName()) {
      const downloaded = generation ? await aiStorageService.downloadGcsFile(uri, generation) : await aiStorageService.downloadGcsFile(uri);
      return { bytesBase64Encoded: downloaded.buffer.toString("base64"), mimeType: downloaded.mimeType };
    }
    return downloadHttpImage(`https://storage.googleapis.com/${bucketName}/${objectPath.split("/").map(encodeURIComponent).join("/")}`);
  }

  if (/^https?:\/\//.test(uri)) {
    return downloadHttpImage(uri);
  }

  throw new Error("Fuente de imagen no compatible para try-on");
};

type ProviderImageResult = {
  outputImageBytesBase64?: string;
  outputGcsUri?: string;
  mimeType?: string;
};

class TryOnWorkflowService {
  private readonly baseLogger = logger.child({ component: "tryon-workflow-service" });

  private async cleanupUserUploadAsset(job: TryOnJob): Promise<void> {
    const asset = await tryOnAssetService.getAssetById(job.inputUserImageAssetId);
    if (!asset || asset.kind !== TryOnAssetKind.USER_UPLOAD) {
      return;
    }

    try {
      await aiStorageService.deleteObject(asset.objectPath, asset.bucket);
      await tryOnAssetService.deleteAsset(asset.id!);
    } catch (error) {
      this.baseLogger.warn("tryon_user_upload_cleanup_failed", {
        jobId: job.id,
        assetId: asset.id,
        error: error instanceof Error ? error.message : "unknown_error",
      });
    }
  }

  private mapProviderErrorMessage(error: unknown): string {
    if (error instanceof VertexTryOnError) {
      if (error.code === "VERTEX_QUOTA_EXCEEDED") {
        return "El probador virtual esta temporalmente saturado. Intenta mas tarde.";
      }
      if (error.code === "VERTEX_PERMISSION_DENIED" || error.code === "VERTEX_AUTH_FAILED") {
        return "No se pudo procesar la imagen en este momento.";
      }
      if (error.code === "VERTEX_INVALID_ARGUMENT") {
        return "La imagen no cumple los requisitos para generar la vista previa.";
      }
      if (error.code === "VERTEX_TIMEOUT") {
        return "La generacion tardo demasiado. Intenta de nuevo con otra foto.";
      }
    }

    if (error instanceof AiRuntimeError) {
      return error.message;
    }

    return "No se pudo generar la vista previa. Intenta con otra foto.";
  }

  private async persistProviderOutput(input: {
    job: TryOnJob;
    jobId: string;
    result: ProviderImageResult;
  }) {
    const resultFolder = `${aiConfig.storage.resultFolder}/${input.job.userId}/${input.job.sessionId}`;
    const destinationPath = `${resultFolder}/${input.jobId}.png`;

    let finalBucket = aiStorageService.getBucketName();
    let finalObjectPath = destinationPath;
    let finalMimeType = input.result.mimeType || "image/png";
    let finalSizeBytes = 0;
    let stableOutputUri = aiStorageService.buildGcsUri(destinationPath);

    if (input.result.outputImageBytesBase64) {
      const outputBuffer = Buffer.from(input.result.outputImageBytesBase64, "base64");
      const uploadResult = await aiStorageService.uploadPrivateFile({
        buffer: outputBuffer,
        originalName: `${input.jobId}.png`,
        mimeType: finalMimeType,
        folder: resultFolder,
      });

      finalBucket = uploadResult.bucket;
      finalObjectPath = uploadResult.objectPath;
      finalSizeBytes = uploadResult.sizeBytes;
      stableOutputUri = uploadResult.gcsUri;
    } else if (input.result.outputGcsUri) {
      const outputMatch = input.result.outputGcsUri.match(/^gs:\/\/([^/]+)\/(.+)$/);
      if (!outputMatch) {
        throw new Error("El proveedor devolvio una GCS URI invalida");
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
          input.result.outputGcsUri,
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
      throw new Error("El proveedor de preview no devolvio salida utilizable");
    }

    const outputAsset = await tryOnAssetService.createAsset({
      userId: input.job.userId,
      sessionId: input.job.sessionId,
      jobId: input.jobId,
      productId: input.job.productId,
      variantId: input.job.variantId,
      sku: input.job.sku,
      kind: TryOnAssetKind.OUTPUT_IMAGE,
      bucket: finalBucket,
      objectPath: finalObjectPath,
      mimeType: finalMimeType,
      fileName: path.basename(finalObjectPath),
      sizeBytes: finalSizeBytes,
    });

    await tryOnJobService.markCompleted(input.jobId, outputAsset.id!, stableOutputUri);
    return {
      outputAsset,
      stableOutputUri,
    };
  }

  async createJob(input: {
    userId: string;
    sessionId: string;
    productId: string;
    variantId?: string;
    sku?: string;
    userImageAssetId: string;
    consentAccepted: boolean;
    idempotencyKey?: string;
    requestedByRole: TryOnJob["requestedByRole"];
  }): Promise<TryOnJob> {
    if (input.idempotencyKey) {
      const since = admin.firestore.Timestamp.fromMillis(
        Date.now() - aiConfig.tryOn.idempotencyWindowMs,
      );
      const existingJob = await tryOnJobService.findRecentJobByIdempotencyKey(
        input.userId,
        input.idempotencyKey,
        since,
      );

      if (existingJob) {
        const exactPayloadMatch =
          existingJob.userId === input.userId &&
          existingJob.sessionId === input.sessionId &&
          existingJob.productId === input.productId &&
          existingJob.inputUserImageAssetId === input.userImageAssetId &&
          (existingJob.variantId ?? undefined) === (input.variantId ?? undefined) &&
          existingJob.consentAccepted === input.consentAccepted &&
          existingJob.requestedByRole === input.requestedByRole &&
          existingJob.idempotencyKey === input.idempotencyKey;

        if (!exactPayloadMatch) {
          throw new AiRuntimeError(
            AI_TRYON_IDEMPOTENCY_CONFLICT_CODE,
            "La llave de idempotencia ya fue utilizada con otra solicitud",
            409,
          );
        }

        const session = await aiSessionService.getSessionById(input.sessionId);
        if (!session || session.userId !== input.userId || (session.status && session.status !== AiSessionStatus.ACTIVE)) {
          throw new AiRuntimeError(
            AI_TRYON_SESSION_UNAVAILABLE_CODE,
            "Sesion AI no disponible para probador virtual",
            404,
          );
        }

        // This is a replay of an operation already admitted and persisted,
        // not a new policy decision. The worker may have intentionally deleted
        // the input upload after completion, so re-reading that asset here
        // would make an exact idempotent replay impossible.
        return existingJob;
      }
    }

    // Every initial job creation is admitted by the canonical policy. No
    // idempotency lookup may create a fresh job or bypass this gate.
    const eligibility = await tryOnEligibilityService.requireEligible({
      userId: input.userId,
      sessionId: input.sessionId,
      productId: input.productId,
      userImageAssetId: input.userImageAssetId,
    });

    const job = await tryOnJobService.createJob({
      ...input,
      // The catalog is authoritative for commercial identifiers; never persist
      // a client-authored SKU as product truth.
      sku: eligibility.product.clave || undefined,
      inputUserImageAssetId: eligibility.asset.id!,
      inputUserImageUrl: aiStorageService.buildGcsUri(
        eligibility.asset.objectPath,
        eligibility.asset.bucket,
      ),
      inputProductImageUrl: eligibility.productImageGcsUri,
      inputUserImageGeneration: eligibility.userImageGeneration,
      inputProductImageGeneration: eligibility.productImageGeneration,
      consentVersion: aiConfig.tryOn.consentVersion,
      consentAcceptedAt: admin.firestore.Timestamp.now(),
      previewMode: eligibility.policy.previewMode,
      productPreviewType: eligibility.policy.productPreviewType,
      classificationSource: eligibility.policy.classificationSource,
      productCategorySnapshot: eligibility.policy.productCategorySnapshot,
    });

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
    if (!asset || asset.userId !== job.userId || asset.jobId !== job.id) {
      return null;
    }

    return asset;
  }

  async processQueuedJob(jobId: string): Promise<void> {
    const job = await tryOnJobService.claimJobForProcessing(jobId);
    if (!job) {
      const latestJob = await tryOnJobService.getJobById(jobId);
      this.baseLogger.info("tryon_job_skipped", {
        jobId,
        status: latestJob?.status ?? "missing",
      });
      return;
    }

    this.baseLogger.info("tryon_job_transition", {
      jobId,
      fromStatus: TryOnJobStatus.QUEUED,
      toStatus: TryOnJobStatus.PROCESSING,
    });

    try {
      if (job.previewMode !== ProductPreviewMode.BODY_TRYON) {
        throw new AiRuntimeError(
          PRODUCT_PREVIEW_UNSUPPORTED_CODE,
          "El job no es compatible con probador virtual de ropa adulta",
          400,
        );
      }

      const [personImage, productImage] = await Promise.all([
        resolveVertexImageInput(job.inputUserImageUrl!, job.inputUserImageGeneration),
        resolveVertexImageInput(job.inputProductImageUrl, job.inputProductImageGeneration),
      ]);
      const providerResult = await vertexTryOnAdapter.runTryOn({
        personImage,
        garmentImage: productImage,
      });

      const { outputAsset } = await this.persistProviderOutput({
        job,
        jobId,
        result: providerResult,
      });
      this.baseLogger.info("tryon_job_transition", {
        jobId,
        fromStatus: TryOnJobStatus.PROCESSING,
        toStatus: TryOnJobStatus.COMPLETED,
      });
      this.baseLogger.info("tryon_job_completed", {
        jobId,
        outputAssetId: outputAsset.id,
        previewMode: job.previewMode,
      });
    } catch (error) {
      const errorCode =
        error instanceof VertexTryOnError
          ? error.code
          : error instanceof AiRuntimeError
            ? error.code
            : "TRYON_FAILED";
      const message = this.mapProviderErrorMessage(error);

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
    } finally {
      const latestJob = await tryOnJobService.getJobById(jobId);
      if (latestJob) {
        await this.cleanupUserUploadAsset(latestJob);
      }
    }
  }

  async cleanupExpiredAssets(limit = 100): Promise<{ deleted: number }> {
    const cutoff = admin.firestore.Timestamp.fromMillis(
      Date.now() - aiConfig.storage.retentionHours * 60 * 60 * 1000,
    );
    const expiredAssets = await tryOnAssetService.listExpiredAssets(cutoff, limit);
    let deleted = 0;

    for (const asset of expiredAssets) {
      try {
        await aiStorageService.deleteObject(asset.objectPath, asset.bucket);
        if (asset.id) {
          await tryOnAssetService.deleteAsset(asset.id);
        }
        deleted += 1;
      } catch (error) {
        this.baseLogger.warn("tryon_asset_retention_cleanup_failed", {
          assetId: asset.id,
          error: error instanceof Error ? error.message : "unknown_error",
        });
      }
    }

    return { deleted };
  }
}

export const tryOnWorkflowService = new TryOnWorkflowService();
export default tryOnWorkflowService;
