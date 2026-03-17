import path from "path";
import aiConfig from "../../../config/ai.config";
import {
  ProductPreviewClassificationSource,
  ProductPreviewMode,
  TryOnAssetKind,
  TryOnJob,
  TryOnJobStatus,
} from "../../../models/ai/ai.model";
import productService from "../../../services/product.service";
import logger from "../../../utils/logger";
import {
  AiRuntimeError,
  PRODUCT_PREVIEW_CLASSIFICATION_FAILED_CODE,
  PRODUCT_PREVIEW_IMAGE_INVALID_CODE,
  PRODUCT_PREVIEW_UNSUPPORTED_CODE,
} from "../ai.error";
import vertexPreviewMockupAdapter, {
  VertexPreviewMockupError,
} from "../adapters/vertex-preview-mockup.adapter";
import vertexTryOnAdapter, {
  VertexTryOnError,
} from "../adapters/vertex-tryon.adapter";
import aiSessionService from "../memory/session.service";
import aiStorageService from "../storage/ai-storage.service";
import productPreviewPolicyService from "./product-preview-policy.service";
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

const resolvePreviewClassificationError = (
  classificationSource: ProductPreviewClassificationSource,
  categoryName?: string | null,
  lineName?: string | null,
) =>
  classificationSource === ProductPreviewClassificationSource.UNCLASSIFIED &&
  !categoryName &&
  !lineName
    ? new AiRuntimeError(
        PRODUCT_PREVIEW_CLASSIFICATION_FAILED_CODE,
        "No se pudo clasificar el producto para generar una vista previa confiable",
        400,
      )
    : new AiRuntimeError(
        PRODUCT_PREVIEW_UNSUPPORTED_CODE,
        "El producto seleccionado no es compatible con una vista previa AI confiable",
        400,
      );

type ProviderImageResult = {
  outputImageBytesBase64?: string;
  outputGcsUri?: string;
  mimeType?: string;
};

class TryOnWorkflowService {
  private readonly baseLogger = logger.child({ component: "tryon-workflow-service" });

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
      throw new AiRuntimeError(
        PRODUCT_PREVIEW_IMAGE_INVALID_CODE,
        "El producto seleccionado no tiene imagen oficial utilizable para generar preview",
        400,
      );
    }

    const previewPolicy = await productPreviewPolicyService.resolvePolicy(product);
    if (previewPolicy.previewMode === ProductPreviewMode.UNSUPPORTED) {
      throw resolvePreviewClassificationError(
        previewPolicy.classificationSource,
        previewPolicy.productCategorySnapshot.categoryName,
        previewPolicy.productCategorySnapshot.lineName,
      );
    }

    const productImageUrl = product.imagenes[0];
    const productImageGcsUri = normalizeToGcsUri(productImageUrl);
    if (!productImageGcsUri) {
      throw new AiRuntimeError(
        PRODUCT_PREVIEW_IMAGE_INVALID_CODE,
        "La imagen oficial del producto no es compatible con el flujo de preview",
        400,
      );
    }

    const job = await tryOnJobService.createJob({
      ...input,
      inputUserImageAssetId: asset.id!,
      inputUserImageUrl: aiStorageService.buildGcsUri(asset.objectPath, asset.bucket),
      inputProductImageUrl: productImageGcsUri,
      previewMode: previewPolicy.previewMode,
      productPreviewType: previewPolicy.productPreviewType,
      classificationSource: previewPolicy.classificationSource,
      productCategorySnapshot: previewPolicy.productCategorySnapshot,
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
      if (job.previewMode === ProductPreviewMode.UNSUPPORTED) {
        throw new AiRuntimeError(
          PRODUCT_PREVIEW_UNSUPPORTED_CODE,
          "El job no es compatible con un preview AI confiable",
          400,
        );
      }

      const [personImage, productImage] = await Promise.all([
        resolveVertexImageInput(job.inputUserImageUrl!),
        resolveVertexImageInput(job.inputProductImageUrl),
      ]);
      const providerResult =
        job.previewMode === ProductPreviewMode.BODY_TRYON
          ? await vertexTryOnAdapter.runTryOn({
              personImage,
              garmentImage: productImage,
            })
          : await vertexPreviewMockupAdapter.generateMockup({
              personImage,
              productImage,
              previewMode: job.previewMode,
              productPreviewType: job.productPreviewType,
              productDescription: job.productCategorySnapshot.productDescription,
              categoryName: job.productCategorySnapshot.categoryName,
              lineName: job.productCategorySnapshot.lineName,
            });

      const { outputAsset, stableOutputUri } = await this.persistProviderOutput({
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
        outputImageUrl: stableOutputUri,
        previewMode: job.previewMode,
      });
    } catch (error) {
      const errorCode =
        error instanceof VertexTryOnError
          ? error.code
          : error instanceof VertexPreviewMockupError
            ? error.code
            : error instanceof AiRuntimeError
              ? error.code
          : "TRYON_FAILED";
      const message =
        error instanceof Error ? error.message : "Error procesando preview AI";

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
