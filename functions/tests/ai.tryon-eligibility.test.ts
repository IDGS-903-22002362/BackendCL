jest.mock("../src/services/product.service", () => ({
  __esModule: true,
  default: { getProductById: jest.fn() },
}));

jest.mock("../src/services/ai/jobs/tryon-asset.service", () => ({
  __esModule: true,
  default: { getAssetById: jest.fn() },
}));

jest.mock("../src/services/ai/jobs/product-preview-policy.service", () => ({
  __esModule: true,
  default: { resolvePolicy: jest.fn() },
}));

jest.mock("../src/services/ai/memory/session.service", () => ({
  __esModule: true,
  default: { getSessionById: jest.fn() },
}));

jest.mock("../src/services/ai/storage/ai-storage.service", () => ({
  __esModule: true,
  default: {
    getBucketName: jest.fn(),
    getCatalogBucketName: jest.fn(),
    getObjectMetadata: jest.fn(),
    inspectImageObject: jest.fn(),
  },
}));

import aiConfig from "../src/config/ai.config";
import {
  ProductPreviewClassificationSource,
  ProductPreviewMode,
  ProductPreviewType,
  TryOnAssetKind,
  TryOnEligibilityReason,
} from "../src/models/ai/ai.model";
import productService from "../src/services/product.service";
import aiSessionService from "../src/services/ai/memory/session.service";
import productPreviewPolicyService from "../src/services/ai/jobs/product-preview-policy.service";
import tryOnAssetService from "../src/services/ai/jobs/tryon-asset.service";
import tryOnEligibilityService, {
  normalizeProductImageToGcsUri,
} from "../src/services/ai/jobs/tryon-eligibility.service";
import aiStorageService from "../src/services/ai/storage/ai-storage.service";

const mockedProductService = productService as jest.Mocked<typeof productService>;
const mockedSessionService = aiSessionService as jest.Mocked<typeof aiSessionService>;
const mockedPolicyService = productPreviewPolicyService as jest.Mocked<
  typeof productPreviewPolicyService
>;
const mockedAssetService = tryOnAssetService as jest.Mocked<
  typeof tryOnAssetService
>;
const mockedStorageService = aiStorageService as jest.Mocked<
  typeof aiStorageService
>;

const publicProduct = (overrides: Record<string, unknown> = {}) =>
  ({
    id: "prod_1",
    clave: "JER-001",
    descripcion: "Jersey oficial",
    categoriaId: "jersey",
    lineaId: "caballero",
    imagenes: [
      "https://storage.googleapis.com/e-comerce-leon.firebasestorage.app/productos/jersey.png",
    ],
    activo: true,
    disponible: true,
    existencias: 4,
    ...overrides,
  }) as never;

const ownedAsset = (overrides: Record<string, unknown> = {}) =>
  ({
    id: "asset_1",
    userId: "user_1",
    sessionId: "session_1",
    kind: TryOnAssetKind.USER_UPLOAD,
    bucket: "e-comerce-leon-ai-private",
    objectPath: "ai/uploads/user_1/photo.png",
    mimeType: "image/png",
    sizeBytes: 4096,
    width: 1024,
    height: 1024,
    createdAt: { toMillis: () => Date.now() - 1_000 },
    ...overrides,
  }) as never;

describe("canonical try-on eligibility", () => {
  const originalEnabled = aiConfig.tryOn.enabled;

  beforeEach(() => {
    jest.clearAllMocks();
    aiConfig.tryOn.enabled = true;
    mockedProductService.getProductById.mockResolvedValue(publicProduct());
    mockedSessionService.getSessionById.mockResolvedValue({
      id: "session_1",
      userId: "user_1",
      status: "active",
    } as never);
    mockedPolicyService.resolvePolicy.mockResolvedValue({
      previewMode: ProductPreviewMode.BODY_TRYON,
      productPreviewType: ProductPreviewType.APPAREL,
      classificationSource: ProductPreviewClassificationSource.CATEGORY_ID,
      productCategorySnapshot: {
        categoryId: "jersey",
        categoryName: "Jersey",
        lineId: "caballero",
        lineName: "Caballero",
      },
    });
    mockedAssetService.getAssetById.mockResolvedValue(ownedAsset());
    mockedStorageService.getBucketName.mockReturnValue(
      "e-comerce-leon-ai-private",
    );
    mockedStorageService.getCatalogBucketName.mockReturnValue(
      "e-comerce-leon.firebasestorage.app",
    );
    mockedStorageService.getObjectMetadata.mockImplementation(
      async (objectPath: string) =>
        objectPath.startsWith("ai/uploads/")
          ? { mimeType: "image/png", sizeBytes: 4096 }
          : { mimeType: "image/png", sizeBytes: 8192 },
    );
    mockedStorageService.inspectImageObject.mockImplementation(async (objectPath: string, bucketName?: string) => ({
      ...(await mockedStorageService.getObjectMetadata(objectPath, bucketName)),
      generation: "1", width: 1024, height: 1024,
    }) as never);
  });

  afterAll(() => {
    aiConfig.tryOn.enabled = originalEnabled;
  });

  it("returns the exact bounded success contract", async () => {
    const result = await tryOnEligibilityService.getEligibility({
      userId: "user_1",
      productId: "prod_1",
    });

    expect(result).toEqual({
      eligible: true,
      mode: "body_tryon",
      reason: null,
      requirements: [],
      disclaimer: "",
    });
    expect(Object.keys(result).sort()).toEqual(
      ["disclaimer", "eligible", "mode", "reason", "requirements"].sort(),
    );
    expect(mockedStorageService.getObjectMetadata).toHaveBeenCalledWith(
      "productos/jersey.png",
      "e-comerce-leon.firebasestorage.app",
    );
  });

  it("validates persisted upload data against real Storage metadata", async () => {
    const resolved = await tryOnEligibilityService.requireEligible({
      userId: "user_1",
      sessionId: "session_1",
      productId: "prod_1",
      userImageAssetId: "asset_1",
    });

    expect(resolved.result).toEqual({
      eligible: true,
      mode: "body_tryon",
      reason: null,
      requirements: [],
      disclaimer: "",
    });
    expect(mockedStorageService.getObjectMetadata).toHaveBeenCalledWith(
      "ai/uploads/user_1/photo.png",
      "e-comerce-leon-ai-private",
    );
    expect(resolved.asset.id).toBe("asset_1");
  });

  it.each([
    ["persisted MIME", { mimeType: "image/gif" }, { mimeType: "image/gif", sizeBytes: 4096 }],
    ["metadata MIME", {}, { mimeType: "image/gif", sizeBytes: 4096 }],
    ["zero size", { sizeBytes: 0 }, { mimeType: "image/png", sizeBytes: 0 }],
    ["size mismatch", {}, { mimeType: "image/png", sizeBytes: 4095 }],
    ["zero width", { width: 0 }, { mimeType: "image/png", sizeBytes: 4096 }],
    ["small dimensions", { width: 511 }, { mimeType: "image/png", sizeBytes: 4096 }],
    ["excess pixels", { width: 5000, height: 5000 }, { mimeType: "image/png", sizeBytes: 4096 }],
  ])("fails closed for invalid user-image %s", async (_label, assetPatch, metadata) => {
    mockedAssetService.getAssetById.mockResolvedValueOnce(ownedAsset(assetPatch));
    mockedStorageService.getObjectMetadata.mockImplementation(
      async (objectPath: string) =>
        objectPath.startsWith("ai/uploads/")
          ? metadata
          : { mimeType: "image/png", sizeBytes: 8192 },
    );

    const result = await tryOnEligibilityService.getEligibility({
      userId: "user_1",
      sessionId: "session_1",
      productId: "prod_1",
      userImageAssetId: "asset_1",
    });

    expect(result).toEqual({
      eligible: false,
      mode: "unsupported",
      reason: TryOnEligibilityReason.USER_IMAGE_UNAVAILABLE,
      requirements: [],
      disclaimer: "",
    });
    expect(mockedPolicyService.resolvePolicy).not.toHaveBeenCalled();
  });

  it("collapses missing, foreign, and cross-session assets", async () => {
    for (const asset of [
      null,
      ownedAsset({ userId: "other_user" }),
      ownedAsset({ sessionId: "session_2" }),
    ]) {
      mockedAssetService.getAssetById.mockResolvedValueOnce(asset);
      const result = await tryOnEligibilityService.getEligibility({
        userId: "user_1",
        sessionId: "session_1",
        productId: "prod_1",
        userImageAssetId: "asset_unknown",
      });
      expect(result.reason).toBe(TryOnEligibilityReason.USER_IMAGE_UNAVAILABLE);
    }
  });

  it("rejects closed sessions", async () => {
    mockedSessionService.getSessionById.mockResolvedValueOnce({ userId: "user_1", status: "closed" } as never);
    const result = await tryOnEligibilityService.getEligibility({ userId: "user_1", sessionId: "session_1",
      productId: "prod_1", userImageAssetId: "asset_1" });
    expect(result.reason).toBe(TryOnEligibilityReason.USER_IMAGE_UNAVAILABLE);
  });

  it("uses one anti-enumeration result and runtime status for missing and inactive products", async () => {
    mockedProductService.getProductById.mockResolvedValueOnce(null);
    const missing = await tryOnEligibilityService.getEligibility({
      userId: "user_1",
      productId: "missing",
    });
    mockedProductService.getProductById.mockResolvedValueOnce(
      publicProduct({ activo: false }),
    );
    const inactive = await tryOnEligibilityService.getEligibility({
      userId: "user_1",
      productId: "inactive",
    });

    expect(missing).toEqual(inactive);
    expect(missing.reason).toBe(TryOnEligibilityReason.PRODUCT_UNAVAILABLE);
    expect(tryOnEligibilityService.toRuntimeError(missing)).toMatchObject({
      code: "PRODUCT_PREVIEW_UNAVAILABLE",
      statusCode: 404,
    });
    expect(tryOnEligibilityService.toRuntimeError(inactive)).toMatchObject({
      code: "PRODUCT_PREVIEW_UNAVAILABLE",
      statusCode: 404,
    });
  });

  it("rejects a missing or unusable product-image object without leaking internals", async () => {
    mockedStorageService.getObjectMetadata.mockRejectedValueOnce(
      new Error("private bucket topology"),
    );
    const missingObject = await tryOnEligibilityService.getEligibility({
      userId: "user_1",
      productId: "prod_1",
    });

    mockedStorageService.getObjectMetadata.mockResolvedValueOnce({
      mimeType: "text/html",
      sizeBytes: 8192,
    });
    const invalidMime = await tryOnEligibilityService.getEligibility({
      userId: "user_1",
      productId: "prod_1",
    });

    expect(missingObject).toEqual(invalidMime);
    expect(missingObject.reason).toBe(
      TryOnEligibilityReason.PRODUCT_IMAGE_UNAVAILABLE,
    );
    expect(JSON.stringify(missingObject)).not.toContain("topology");
  });

  it("rejects product images outside the canonical catalog bucket and path", async () => {
    mockedProductService.getProductById.mockResolvedValueOnce(
      publicProduct({
        imagenes: ["https://storage.googleapis.com/other-bucket/productos/x.png"],
      }),
    );
    const wrongBucket = await tryOnEligibilityService.getEligibility({
      userId: "user_1",
      productId: "prod_1",
    });

    mockedProductService.getProductById.mockResolvedValueOnce(
      publicProduct({
        imagenes: [
          "https://storage.googleapis.com/e-comerce-leon.firebasestorage.app/usuarios/x.png",
        ],
      }),
    );
    const wrongPath = await tryOnEligibilityService.getEligibility({
      userId: "user_1",
      productId: "prod_1",
    });

    expect(wrongBucket.reason).toBe(
      TryOnEligibilityReason.PRODUCT_IMAGE_UNAVAILABLE,
    );
    expect(wrongPath).toEqual(wrongBucket);
    expect(mockedStorageService.getObjectMetadata).not.toHaveBeenCalled();
  });

  it("fails closed when the feature flag is disabled", async () => {
    aiConfig.tryOn.enabled = false;
    const result = await tryOnEligibilityService.getEligibility({
      userId: "user_1",
      productId: "prod_1",
    });

    expect(result.reason).toBe(TryOnEligibilityReason.TRYON_DISABLED);
    expect(mockedProductService.getProductById).not.toHaveBeenCalled();
  });

  it("normalizes only supported Storage URL forms", () => {
    expect(
      normalizeProductImageToGcsUri(
        "https://storage.googleapis.com/catalog-bucket/productos/jersey%20local.png",
      ),
    ).toBe("gs://catalog-bucket/productos/jersey local.png");
    expect(normalizeProductImageToGcsUri("https://example.com/jersey.png")).toBeNull();
  });
});
