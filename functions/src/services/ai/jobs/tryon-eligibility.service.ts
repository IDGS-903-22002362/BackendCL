import aiConfig from "../../../config/ai.config";
import {
  AiSessionStatus,
  ProductPreviewClassificationSource,
  ProductPreviewMode,
  TryOnAsset,
  TryOnAssetKind,
  TryOnEligibility,
  TryOnEligibilityReason,
} from "../../../models/ai/ai.model";
import { Producto } from "../../../models/producto.model";
import productService from "../../../services/product.service";
import {
  AiRuntimeError,
  AI_TRYON_ASSET_UNAVAILABLE_CODE,
  AI_TRYON_DISABLED_CODE,
  PRODUCT_PREVIEW_CLASSIFICATION_FAILED_CODE,
  PRODUCT_PREVIEW_IMAGE_INVALID_CODE,
  PRODUCT_PREVIEW_OUT_OF_STOCK_CODE,
  PRODUCT_PREVIEW_UNAVAILABLE_CODE,
  PRODUCT_PREVIEW_UNSUPPORTED_CODE,
} from "../ai.error";
import aiSessionService from "../memory/session.service";
import aiStorageService from "../storage/ai-storage.service";
import productPreviewPolicyService, {
  ResolvedProductPreviewPolicy,
} from "./product-preview-policy.service";
import tryOnAssetService from "./tryon-asset.service";

// TAREA 12 intentionally exposes no legal/commercial copy or pending client
// requirements in the success contract. Consent remains enforced by createJob.
export const TRY_ON_DISCLAIMER = "";

type TimestampLike = {
  toMillis?: () => number;
  seconds?: number;
  _seconds?: number;
};

type LifecycleAwareAsset = TryOnAsset & {
  expiresAt?: TimestampLike | Date | string | number | null;
  deletedAt?: unknown;
  deletionStatus?: string;
  referenceState?: string;
};

type GcsObjectReference = {
  bucket: string;
  objectPath: string;
  uri: string;
};

export interface ResolvedTryOnEligibility {
  result: TryOnEligibility;
  product?: Producto;
  asset?: TryOnAsset;
  policy?: ResolvedProductPreviewPolicy;
  productImageGcsUri?: string;
  userImageGeneration?: string;
  productImageGeneration?: string;
}

const decodeObjectPath = (value: string): string | null => {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
};

const parseProductImageReference = (url: string): GcsObjectReference | null => {
  const gsMatch = url.match(/^gs:\/\/([^/]+)\/(.+)$/);
  if (gsMatch) {
    const objectPath = decodeObjectPath(gsMatch[2]);
    return objectPath
      ? { bucket: gsMatch[1], objectPath, uri: `gs://${gsMatch[1]}/${objectPath}` }
      : null;
  }

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") {
      return null;
    }

    if (parsed.hostname === "storage.googleapis.com") {
      const parts = parsed.pathname.replace(/^\/+/, "").split("/");
      const bucket = parts.shift();
      const objectPath = decodeObjectPath(parts.join("/"));
      return bucket && objectPath
        ? { bucket, objectPath, uri: `gs://${bucket}/${objectPath}` }
        : null;
    }

    if (parsed.hostname === "firebasestorage.googleapis.com") {
      const pathMatch = parsed.pathname.match(/^\/v0\/b\/([^/]+)\/o\/(.+)$/);
      const objectPath = pathMatch ? decodeObjectPath(pathMatch[2]) : null;
      return pathMatch && objectPath
        ? {
            bucket: pathMatch[1],
            objectPath,
            uri: `gs://${pathMatch[1]}/${objectPath}`,
          }
        : null;
    }
  } catch {
    return null;
  }

  return null;
};

export const normalizeProductImageToGcsUri = (url: string): string | null =>
  parseProductImageReference(url)?.uri ?? null;

const isSafeObjectPath = (objectPath: string, requiredPrefix: string): boolean => {
  if (
    !objectPath.startsWith(requiredPrefix) ||
    objectPath.startsWith("/") ||
    objectPath.includes("\\")
  ) {
    return false;
  }

  return objectPath
    .split("/")
    .every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
};

const toMillis = (value: unknown): number | null => {
  if (value instanceof Date) {
    const millis = value.getTime();
    return Number.isFinite(millis) ? millis : null;
  }

  if (typeof value === "string" || typeof value === "number") {
    const millis = typeof value === "number" ? value : Date.parse(value);
    return Number.isFinite(millis) ? millis : null;
  }

  if (value && typeof value === "object") {
    const timestamp = value as TimestampLike;
    if (typeof timestamp.toMillis === "function") {
      const millis = timestamp.toMillis();
      return Number.isFinite(millis) ? millis : null;
    }

    const seconds = Number(timestamp.seconds ?? timestamp._seconds);
    return Number.isFinite(seconds) ? seconds * 1000 : null;
  }

  return null;
};

const unavailableResult = (reason: TryOnEligibilityReason): TryOnEligibility => ({
  eligible: false,
  mode: ProductPreviewMode.UNSUPPORTED,
  reason,
  requirements: [],
  disclaimer: "",
});

const eligibleResult = (): TryOnEligibility => ({
  eligible: true,
  mode: ProductPreviewMode.BODY_TRYON,
  reason: null,
  requirements: [],
  disclaimer: "",
});

const isPositiveBoundedDimension = (value: unknown): value is number =>
  Number.isInteger(value) && Number(value) > 0;

const isAssetLifecycleUsable = (asset: TryOnAsset): boolean => {
  const lifecycleAsset = asset as LifecycleAwareAsset;
  const deletionStatus = lifecycleAsset.deletionStatus?.trim().toLowerCase();
  if (
    lifecycleAsset.deletedAt ||
    (deletionStatus && deletionStatus !== "active") ||
    lifecycleAsset.referenceState?.trim().toLowerCase() === "unknown"
  ) {
    return false;
  }

  const now = Date.now();
  if (lifecycleAsset.expiresAt !== undefined && lifecycleAsset.expiresAt !== null) {
    const expiresAtMs = toMillis(lifecycleAsset.expiresAt);
    return expiresAtMs !== null && expiresAtMs > now;
  }

  const createdAtMs = toMillis(asset.createdAt);
  if (createdAtMs === null) {
    return false;
  }

  const retentionMs = Math.max(1, aiConfig.storage.retentionHours) * 60 * 60 * 1000;
  return createdAtMs + retentionMs > now;
};

const hasAvailableInventory = (product: Producto): boolean => {
  const available = Number(product.existencias);
  return product.disponible !== false && Number.isFinite(available) && available > 0;
};

class TryOnEligibilityService {
  requireEnabled(): void {
    if (!aiConfig.tryOn.enabled) {
      throw this.toRuntimeError(
        unavailableResult(TryOnEligibilityReason.TRYON_DISABLED),
      );
    }
  }

  private async loadUsableAsset(input: {
    userId: string;
    sessionId?: string;
    assetId: string;
  }): Promise<{ asset: TryOnAsset; generation: string } | null> {
    if (!input.sessionId) {
      return null;
    }

    const [session, asset] = await Promise.all([
      aiSessionService.getSessionById(input.sessionId),
      tryOnAssetService.getAssetById(input.assetId),
    ]);
    if (
      !session ||
      session.userId !== input.userId ||
      (session.status && session.status !== AiSessionStatus.ACTIVE) ||
      !asset ||
      asset.userId !== input.userId ||
      asset.sessionId !== input.sessionId ||
      asset.kind !== TryOnAssetKind.USER_UPLOAD ||
      asset.jobId ||
      !isAssetLifecycleUsable(asset)
    ) {
      return null;
    }

    const expectedBucket = aiStorageService.getBucketName();
    const expectedPrefix = `${aiConfig.storage.uploadFolder.replace(/\/+$/, "")}/${input.userId}/`;
    const persistedMimeType = asset.mimeType?.trim().toLowerCase();
    const persistedSize = asset.sizeBytes;
    const width = asset.width;
    const height = asset.height;
    if (
      asset.bucket !== expectedBucket ||
      !isSafeObjectPath(asset.objectPath, expectedPrefix) ||
      !aiConfig.uploads.allowedMimeTypes.includes(persistedMimeType) ||
      !Number.isInteger(persistedSize) ||
      persistedSize <= 0 ||
      persistedSize > aiConfig.uploads.maxBytes ||
      !isPositiveBoundedDimension(width) ||
      !isPositiveBoundedDimension(height) ||
      width < aiConfig.uploads.minWidth ||
      height < aiConfig.uploads.minHeight ||
      width * height > aiConfig.uploads.maxPixels
    ) {
      return null;
    }

    try {
      const inspected = await aiStorageService.inspectImageObject(
        asset.objectPath,
        asset.bucket,
      );
      const metadata = { mimeType: inspected.mimeType, sizeBytes: inspected.sizeBytes };
      const metadataMimeType = metadata.mimeType?.trim().toLowerCase();
      return metadataMimeType &&
        aiConfig.uploads.allowedMimeTypes.includes(metadataMimeType) &&
        metadataMimeType === persistedMimeType &&
        Number.isInteger(metadata.sizeBytes) &&
        metadata.sizeBytes > 0 &&
        metadata.sizeBytes <= aiConfig.uploads.maxBytes &&
        metadata.sizeBytes === persistedSize &&
        inspected.width === width && inspected.height === height &&
        (!asset.sha256 || inspected.sha256 === asset.sha256)
        ? { asset, generation: inspected.generation }
        : null;
    } catch {
      return null;
    }
  }

  private async resolveUsableProductImage(product: Producto): Promise<{ uri: string; generation: string } | null> {
    const productImageUrl = Array.isArray(product.imagenes)
      ? product.imagenes[0]
      : undefined;
    const reference = productImageUrl
      ? parseProductImageReference(productImageUrl)
      : null;
    if (
      !reference ||
      reference.bucket !== aiStorageService.getCatalogBucketName() ||
      !isSafeObjectPath(reference.objectPath, "productos/")
    ) {
      return null;
    }

    try {
      const inspected = await aiStorageService.inspectImageObject(
        reference.objectPath,
        reference.bucket,
      );
      const metadata = { mimeType: inspected.mimeType, sizeBytes: inspected.sizeBytes };
      const mimeType = metadata.mimeType?.trim().toLowerCase();
      if (
        !mimeType ||
        !aiConfig.uploads.allowedMimeTypes.includes(mimeType) ||
        !Number.isInteger(metadata.sizeBytes) ||
        metadata.sizeBytes <= 0 ||
        metadata.sizeBytes > aiConfig.uploads.maxBytes
      ) {
        return null;
      }

      return { uri: reference.uri, generation: inspected.generation };
    } catch {
      return null;
    }
  }

  async resolve(input: {
    userId: string;
    productId: string;
    userImageAssetId?: string;
    sessionId?: string;
  }): Promise<ResolvedTryOnEligibility> {
    if (!aiConfig.tryOn.enabled) {
      return {
        result: unavailableResult(TryOnEligibilityReason.TRYON_DISABLED),
      };
    }

    const [product, requestedAsset] = await Promise.all([
      productService.getProductById(input.productId),
      input.userImageAssetId
        ? this.loadUsableAsset({
            userId: input.userId,
            sessionId: input.sessionId,
            assetId: input.userImageAssetId,
          })
        : Promise.resolve(undefined),
    ]);

    if (input.userImageAssetId && !requestedAsset) {
      return {
        result: unavailableResult(TryOnEligibilityReason.USER_IMAGE_UNAVAILABLE),
      };
    }
    const asset = requestedAsset?.asset;

    // Missing, soft-deleted, and non-public products intentionally collapse to
    // the same public result so the endpoint is not a catalog enumeration API.
    if (!product || product.activo !== true) {
      return {
        result: unavailableResult(TryOnEligibilityReason.PRODUCT_UNAVAILABLE),
      };
    }

    if (!hasAvailableInventory(product)) {
      return {
        product,
        asset,
        result: unavailableResult(TryOnEligibilityReason.PRODUCT_OUT_OF_STOCK),
      };
    }

    const policy = await productPreviewPolicyService.resolvePolicy(product);
    if (policy.previewMode !== ProductPreviewMode.BODY_TRYON) {
      const reason =
        policy.classificationSource === ProductPreviewClassificationSource.UNCLASSIFIED
          ? TryOnEligibilityReason.PRODUCT_UNCLASSIFIED
          : TryOnEligibilityReason.PRODUCT_UNSUPPORTED;
      return {
        product,
        asset,
        policy,
        result: unavailableResult(reason),
      };
    }

    const productImage = await this.resolveUsableProductImage(product);
    if (!productImage) {
      return {
        product,
        asset,
        policy,
        result: unavailableResult(TryOnEligibilityReason.PRODUCT_IMAGE_UNAVAILABLE),
      };
    }

    return {
      product,
      asset,
      policy,
      productImageGcsUri: productImage.uri,
      userImageGeneration: requestedAsset?.generation,
      productImageGeneration: productImage.generation,
      result: eligibleResult(),
    };
  }

  async getEligibility(input: {
    userId: string;
    productId: string;
    userImageAssetId?: string;
    sessionId?: string;
  }): Promise<TryOnEligibility> {
    return (await this.resolve(input)).result;
  }

  async requireEligible(input: {
    userId: string;
    productId: string;
    userImageAssetId: string;
    sessionId: string;
  }): Promise<{
    result: TryOnEligibility;
    product: Producto;
    asset: TryOnAsset;
    policy: ResolvedProductPreviewPolicy;
    productImageGcsUri: string;
    userImageGeneration: string;
    productImageGeneration: string;
  }> {
    const resolved = await this.resolve(input);
    if (
      resolved.result.eligible &&
      resolved.result.reason === null &&
      resolved.product &&
      resolved.asset &&
      resolved.policy &&
      resolved.productImageGcsUri
      && resolved.userImageGeneration
      && resolved.productImageGeneration
    ) {
      return {
        result: resolved.result,
        product: resolved.product,
        asset: resolved.asset,
        policy: resolved.policy,
        productImageGcsUri: resolved.productImageGcsUri,
        userImageGeneration: resolved.userImageGeneration,
        productImageGeneration: resolved.productImageGeneration,
      };
    }

    throw this.toRuntimeError(resolved.result);
  }

  toRuntimeError(result: TryOnEligibility): AiRuntimeError {
    switch (result.reason) {
      case TryOnEligibilityReason.TRYON_DISABLED:
        return new AiRuntimeError(
          AI_TRYON_DISABLED_CODE,
          "El probador virtual no esta disponible temporalmente",
          503,
        );
      case TryOnEligibilityReason.PRODUCT_UNAVAILABLE:
        return new AiRuntimeError(
          PRODUCT_PREVIEW_UNAVAILABLE_CODE,
          "Producto no disponible para probador virtual",
          404,
        );
      case TryOnEligibilityReason.PRODUCT_OUT_OF_STOCK:
        return new AiRuntimeError(
          PRODUCT_PREVIEW_OUT_OF_STOCK_CODE,
          "El producto no tiene inventario disponible para probador virtual",
          400,
        );
      case TryOnEligibilityReason.PRODUCT_IMAGE_UNAVAILABLE:
        return new AiRuntimeError(
          PRODUCT_PREVIEW_IMAGE_INVALID_CODE,
          "El producto no tiene una imagen oficial compatible con el probador virtual",
          400,
        );
      case TryOnEligibilityReason.PRODUCT_UNCLASSIFIED:
        return new AiRuntimeError(
          PRODUCT_PREVIEW_CLASSIFICATION_FAILED_CODE,
          "No se pudo clasificar el producto para una vista previa confiable",
          400,
        );
      case TryOnEligibilityReason.USER_IMAGE_UNAVAILABLE:
        return new AiRuntimeError(
          AI_TRYON_ASSET_UNAVAILABLE_CODE,
          "Imagen de usuario no disponible para probador virtual",
          404,
        );
      case TryOnEligibilityReason.PRODUCT_UNSUPPORTED:
      case null:
      default:
        return new AiRuntimeError(
          PRODUCT_PREVIEW_UNSUPPORTED_CODE,
          "El producto no es compatible con el probador virtual",
          400,
        );
    }
  }
}

export const tryOnEligibilityService = new TryOnEligibilityService();
export default tryOnEligibilityService;
