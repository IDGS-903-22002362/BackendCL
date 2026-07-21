jest.mock("../src/services/ai/storage/ai-storage.service", () => ({
  __esModule: true,
    default: {
    buildGcsUri: jest.fn(),
    getBucketName: jest.fn(),
    downloadGcsFile: jest.fn(),
    uploadPrivateFile: jest.fn(),
    generateSignedDownloadUrl: jest.fn(),
    copyGcsFile: jest.fn(),
    getObjectMetadata: jest.fn(),
    deleteObject: jest.fn(),
  },
}));

jest.mock("../src/services/ai/jobs/tryon-asset.service", () => ({
  __esModule: true,
  default: {
    getAssetById: jest.fn(),
    attachJob: jest.fn(),
    createAsset: jest.fn(),
    deleteAsset: jest.fn(),
  },
}));

jest.mock("../src/services/ai/jobs/tryon-job.service", () => ({
  __esModule: true,
  default: {
    createJob: jest.fn(),
    findRecentJobByIdempotencyKey: jest.fn(),
    getJobById: jest.fn(),
    claimJobForProcessing: jest.fn(),
    markProcessing: jest.fn(),
    markCompleted: jest.fn(),
    markFailed: jest.fn(),
  },
}));

jest.mock("../src/services/ai/memory/session.service", () => ({
  __esModule: true,
  default: {
    getSessionById: jest.fn(),
  },
}));

jest.mock("../src/services/ai/adapters/vertex-tryon.adapter", () => {
  class MockVertexTryOnError extends Error {
    code: string;

    constructor(code: string, message: string) {
      super(message);
      this.code = code;
      this.name = "VertexTryOnError";
    }
  }

  return {
    __esModule: true,
    VertexTryOnError: MockVertexTryOnError,
    default: {
      runTryOn: jest.fn(),
    },
  };
});

jest.mock("../src/services/ai/adapters/vertex-preview-mockup.adapter", () => ({
  __esModule: true,
  default: {
    generateMockup: jest.fn(),
  },
}));

jest.mock("../src/services/ai/jobs/product-preview-policy.service", () => ({
  __esModule: true,
  default: {
    resolvePolicy: jest.fn(),
  },
}));

jest.mock("../src/services/ai/jobs/tryon-eligibility.service", () => ({
  __esModule: true,
  default: {
    requireEnabled: jest.fn(),
    requireEligible: jest.fn(),
  },
}));

import tryOnWorkflowService from "../src/services/ai/jobs/tryon-workflow.service";
import aiStorageService from "../src/services/ai/storage/ai-storage.service";
import tryOnAssetService from "../src/services/ai/jobs/tryon-asset.service";
import tryOnJobService from "../src/services/ai/jobs/tryon-job.service";
import aiSessionService from "../src/services/ai/memory/session.service";
import vertexTryOnAdapter, {
  VertexTryOnError,
} from "../src/services/ai/adapters/vertex-tryon.adapter";
import vertexPreviewMockupAdapter from "../src/services/ai/adapters/vertex-preview-mockup.adapter";
import productPreviewPolicyService from "../src/services/ai/jobs/product-preview-policy.service";
import tryOnEligibilityService from "../src/services/ai/jobs/tryon-eligibility.service";
import { AiRuntimeError } from "../src/services/ai/ai.error";
import {
  ProductPreviewClassificationSource,
  ProductPreviewMode,
  ProductPreviewType,
  TryOnAssetKind,
  TryOnJobStatus,
} from "../src/models/ai/ai.model";
import { RolUsuario } from "../src/models/usuario.model";

const mockedStorage = aiStorageService as jest.Mocked<typeof aiStorageService>;
const mockedAssetService = tryOnAssetService as jest.Mocked<
  typeof tryOnAssetService
>;
const mockedJobService = tryOnJobService as jest.Mocked<typeof tryOnJobService>;
const mockedSessionService = aiSessionService as jest.Mocked<
  typeof aiSessionService
>;
const mockedVertexAdapter = vertexTryOnAdapter as jest.Mocked<
  typeof vertexTryOnAdapter
>;
const mockedPreviewMockupAdapter = vertexPreviewMockupAdapter as jest.Mocked<
  typeof vertexPreviewMockupAdapter
>;
const mockedPreviewPolicyService =
  productPreviewPolicyService as jest.Mocked<typeof productPreviewPolicyService>;
const mockedEligibilityService =
  tryOnEligibilityService as jest.Mocked<typeof tryOnEligibilityService>;

describe("AI try-on workflow", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    // Reset implementations and one-shot queues, not only call history. This
    // keeps policy failures isolated when tests run alone or as a suite.
    jest.resetAllMocks();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: jest
        .fn()
        .mockResolvedValue(Buffer.from("garment-image")),
      headers: {
        get: jest.fn().mockReturnValue("image/png"),
      },
    } as never);

    mockedStorage.buildGcsUri.mockImplementation(
      (objectPath: string, bucketName?: string) =>
        `gs://${bucketName || "e-comerce-leon-ai-private"}/${objectPath}`,
    );
    mockedStorage.getBucketName.mockReturnValue("e-comerce-leon-ai-private");
    mockedJobService.findRecentJobByIdempotencyKey.mockResolvedValue(null);
    mockedJobService.getJobById.mockResolvedValue(null);
    mockedAssetService.getAssetById.mockResolvedValue(null);
    mockedSessionService.getSessionById.mockResolvedValue({
      id: "session_1",
      userId: "user_1",
    } as never);
    mockedPreviewPolicyService.resolvePolicy.mockResolvedValue({
      previewMode: ProductPreviewMode.BODY_TRYON,
      productPreviewType: ProductPreviewType.APPAREL,
      classificationSource: ProductPreviewClassificationSource.CATEGORY_ID,
      productCategorySnapshot: {
        categoryId: "jersey",
        categoryName: "Jersey Oficial",
        lineId: "caballero",
        lineName: "Caballero",
        productDescription: "Jersey Oficial 2024",
      },
    });
    mockedEligibilityService.requireEligible.mockResolvedValue({
      result: {
        eligible: true,
        mode: ProductPreviewMode.BODY_TRYON,
        reason: null,
        requirements: [],
        disclaimer: "",
      },
      product: { id: "prod_1", clave: "BACKEND-SKU" },
      asset: {
        id: "asset_1",
        userId: "user_1",
        kind: TryOnAssetKind.USER_UPLOAD,
        bucket: "e-comerce-leon-ai-private",
        objectPath: "ai/uploads/user_1/photo.png",
      },
      policy: {
        previewMode: ProductPreviewMode.BODY_TRYON,
        productPreviewType: ProductPreviewType.APPAREL,
        classificationSource: ProductPreviewClassificationSource.CATEGORY_ID,
        productCategorySnapshot: {
          categoryId: "jersey",
          categoryName: "Jersey Oficial",
          lineId: "caballero",
          lineName: "Caballero",
          productDescription: "Jersey Oficial 2024",
        },
      },
      productImageGcsUri:
        "gs://e-comerce-leon.appspot.com/productos/jersey.png",
      userImageGeneration: "user-gen-1",
      productImageGeneration: "product-gen-1",
    } as never);
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it("crea job usando el mismo contexto canonico de elegibilidad", async () => {
    mockedSessionService.getSessionById.mockResolvedValue({
      id: "session_1",
      userId: "user_1",
    } as never);
    mockedJobService.createJob.mockResolvedValue({
      id: "job_1",
    } as never);

    await tryOnWorkflowService.createJob({
      userId: "user_1",
      sessionId: "session_1",
      productId: "prod_1",
      sku: "CLIENT-SKU",
      userImageAssetId: "asset_1",
      consentAccepted: true,
      requestedByRole: RolUsuario.CLIENTE,
    });

    expect(mockedEligibilityService.requireEligible).toHaveBeenCalledWith({
      userId: "user_1",
      sessionId: "session_1",
      productId: "prod_1",
      userImageAssetId: "asset_1",
    });

    expect(mockedJobService.createJob).toHaveBeenCalledWith(
      expect.objectContaining({
        inputUserImageUrl:
          "gs://e-comerce-leon-ai-private/ai/uploads/user_1/photo.png",
        inputProductImageUrl:
          "gs://e-comerce-leon.appspot.com/productos/jersey.png",
        sku: "BACKEND-SKU",
        previewMode: ProductPreviewMode.BODY_TRYON,
        productPreviewType: ProductPreviewType.APPAREL,
        classificationSource: ProductPreviewClassificationSource.CATEGORY_ID,
        inputUserImageGeneration: "user-gen-1",
        inputProductImageGeneration: "product-gen-1",
      }),
    );
    expect(mockedAssetService.attachJob).not.toHaveBeenCalled();
  });

  it("reproduce el job exacto aunque el asset posprocesado ya no exista", async () => {
    const existingJob = {
      id: "job_existing",
      userId: "user_1",
      sessionId: "session_1",
      productId: "prod_1",
      inputUserImageAssetId: "asset_1",
      consentAccepted: true,
      requestedByRole: RolUsuario.CLIENTE,
      idempotencyKey: "idem-key-123",
      status: TryOnJobStatus.COMPLETED,
    } as never;
    mockedJobService.findRecentJobByIdempotencyKey.mockResolvedValue(existingJob);
    mockedEligibilityService.requireEligible.mockRejectedValue(
      new AiRuntimeError(
        "AI_TRYON_ASSET_UNAVAILABLE",
        "Imagen de usuario no disponible para probador virtual",
        404,
      ),
    );

    const result = await tryOnWorkflowService.createJob({
      userId: "user_1",
      sessionId: "session_1",
      productId: "prod_1",
      userImageAssetId: "asset_1",
      consentAccepted: true,
      idempotencyKey: "idem-key-123",
      requestedByRole: RolUsuario.CLIENTE,
    });

    expect(result).toBe(existingJob);
    expect(mockedSessionService.getSessionById).toHaveBeenCalledWith("session_1");
    expect(mockedEligibilityService.requireEligible).not.toHaveBeenCalled();
    expect(mockedJobService.findRecentJobByIdempotencyKey).toHaveBeenCalledTimes(1);
    expect(mockedJobService.createJob).not.toHaveBeenCalled();
  });

  it("rechaza colision de idempotencia aunque pertenezca al mismo usuario", async () => {
    mockedJobService.findRecentJobByIdempotencyKey.mockResolvedValue({
      id: "job_other_payload",
      userId: "user_1",
      sessionId: "session_2",
      productId: "prod_other",
      inputUserImageAssetId: "asset_other",
      consentAccepted: true,
      requestedByRole: RolUsuario.CLIENTE,
      idempotencyKey: "idem-key-123",
      status: TryOnJobStatus.COMPLETED,
    } as never);

    await expect(
      tryOnWorkflowService.createJob({
        userId: "user_1",
        sessionId: "session_1",
        productId: "prod_1",
        userImageAssetId: "asset_1",
        consentAccepted: true,
        idempotencyKey: "idem-key-123",
        requestedByRole: RolUsuario.CLIENTE,
      }),
    ).rejects.toMatchObject({
      code: "AI_TRYON_IDEMPOTENCY_CONFLICT",
      statusCode: 409,
    });
    expect(mockedEligibilityService.requireEligible).not.toHaveBeenCalled();
    expect(mockedSessionService.getSessionById).not.toHaveBeenCalled();
    expect(mockedJobService.createJob).not.toHaveBeenCalled();
  });

  it("aplica la elegibilidad canonica a una solicitud idempotente nueva", async () => {
    mockedEligibilityService.requireEligible.mockRejectedValue(
      new AiRuntimeError(
        "PRODUCT_PREVIEW_UNAVAILABLE",
        "Producto no disponible para probador virtual",
        404,
      ),
    );

    await expect(
      tryOnWorkflowService.createJob({
        userId: "user_1",
        sessionId: "session_1",
        productId: "prod_1",
        userImageAssetId: "asset_1",
        consentAccepted: true,
        idempotencyKey: "idem-key-123",
        requestedByRole: RolUsuario.CLIENTE,
      }),
    ).rejects.toMatchObject({ code: "PRODUCT_PREVIEW_UNAVAILABLE" });
    expect(mockedJobService.findRecentJobByIdempotencyKey).toHaveBeenCalledTimes(1);
    expect(mockedEligibilityService.requireEligible).toHaveBeenCalledWith({
      userId: "user_1",
      sessionId: "session_1",
      productId: "prod_1",
      userImageAssetId: "asset_1",
    });
    expect(mockedJobService.createJob).not.toHaveBeenCalled();
  });

  it("no reproduce un job exacto si la sesion ya no pertenece al usuario", async () => {
    mockedJobService.findRecentJobByIdempotencyKey.mockResolvedValue({
      id: "job_existing",
      userId: "user_1",
      sessionId: "session_1",
      productId: "prod_1",
      inputUserImageAssetId: "asset_1",
      consentAccepted: true,
      requestedByRole: RolUsuario.CLIENTE,
      idempotencyKey: "idem-key-123",
      status: TryOnJobStatus.COMPLETED,
    } as never);
    mockedSessionService.getSessionById.mockResolvedValue({
      id: "session_1",
      userId: "other_user",
    } as never);

    await expect(
      tryOnWorkflowService.createJob({
        userId: "user_1",
        sessionId: "session_1",
        productId: "prod_1",
        userImageAssetId: "asset_1",
        consentAccepted: true,
        idempotencyKey: "idem-key-123",
        requestedByRole: RolUsuario.CLIENTE,
      }),
    ).rejects.toMatchObject({
      code: "AI_TRYON_SESSION_UNAVAILABLE",
      statusCode: 404,
    });
    expect(mockedEligibilityService.requireEligible).not.toHaveBeenCalled();
  });

  it("procesa job queued a completed y persiste referencia estable", async () => {
    mockedJobService.claimJobForProcessing.mockResolvedValue({
      id: "job_1",
      userId: "user_1",
      sessionId: "session_1",
      productId: "prod_1",
      inputUserImageAssetId: "asset_1",
      inputUserImageUrl:
        "gs://e-comerce-leon-ai-private/ai/uploads/user_1/photo.png",
      inputProductImageUrl:
        "gs://e-comerce-leon.appspot.com/productos/jersey.png",
      inputUserImageGeneration: "user-gen-1",
      inputProductImageGeneration: "product-gen-1",
      status: TryOnJobStatus.PROCESSING,
      previewMode: ProductPreviewMode.BODY_TRYON,
      productPreviewType: ProductPreviewType.APPAREL,
      classificationSource: ProductPreviewClassificationSource.CATEGORY_ID,
      productCategorySnapshot: {
        categoryId: "jersey",
        categoryName: "Jersey Oficial",
        lineId: "caballero",
        lineName: "Caballero",
        productDescription: "Jersey Oficial 2024",
      },
    } as never);
    mockedVertexAdapter.runTryOn.mockResolvedValue({
      outputImageBytesBase64: Buffer.from("fake-image").toString("base64"),
      mimeType: "image/png",
      rawResponse: {},
    });
    mockedStorage.downloadGcsFile.mockImplementation(async (uri: string) => ({
      buffer: Buffer.from(uri.includes("jersey") ? "garment-image" : "person-image"),
      mimeType: "image/png",
      sizeBytes: 12,
    }));
    mockedStorage.uploadPrivateFile.mockResolvedValue({
      bucket: "e-comerce-leon-ai-private",
      objectPath: "ai/tryon-results/user_1/session_1/result.png",
      sizeBytes: 123,
      sha256: "hash",
      gcsUri:
        "gs://e-comerce-leon-ai-private/ai/tryon-results/user_1/session_1/result.png",
    });
    mockedAssetService.createAsset.mockResolvedValue({
      id: "asset_out_1",
    } as never);

    await tryOnWorkflowService.processQueuedJob("job_1");

    expect(mockedJobService.claimJobForProcessing).toHaveBeenCalledWith("job_1");
    expect(mockedJobService.markProcessing).not.toHaveBeenCalled();
    expect(mockedStorage.downloadGcsFile).toHaveBeenCalledWith(
      "gs://e-comerce-leon-ai-private/ai/uploads/user_1/photo.png",
      "user-gen-1",
    );
    expect(mockedVertexAdapter.runTryOn).toHaveBeenCalledWith({
      personImage: {
        bytesBase64Encoded: Buffer.from("person-image").toString("base64"),
        mimeType: "image/png",
      },
      garmentImage: {
        bytesBase64Encoded: Buffer.from("garment-image").toString("base64"),
        mimeType: "image/png",
      },
    });
    expect(mockedStorage.uploadPrivateFile).toHaveBeenCalled();
    expect(mockedAssetService.createAsset).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: TryOnAssetKind.OUTPUT_IMAGE,
        bucket: "e-comerce-leon-ai-private",
        mimeType: "image/png",
      }),
    );
    expect(mockedJobService.markCompleted).toHaveBeenCalledWith(
      "job_1",
      "asset_out_1",
      "gs://e-comerce-leon-ai-private/ai/tryon-results/user_1/session_1/result.png",
    );
    expect(mockedJobService.markFailed).not.toHaveBeenCalled();
  });

  it("marca failed con errorCode estable cuando Vertex falla", async () => {
    mockedJobService.claimJobForProcessing.mockResolvedValue({
      id: "job_1",
      userId: "user_1",
      sessionId: "session_1",
      productId: "prod_1",
      inputUserImageAssetId: "asset_1",
      inputUserImageUrl: "gs://bucket/person.png",
      inputProductImageUrl: "gs://bucket/product.png",
      status: TryOnJobStatus.PROCESSING,
      previewMode: ProductPreviewMode.BODY_TRYON,
      productPreviewType: ProductPreviewType.APPAREL,
      classificationSource: ProductPreviewClassificationSource.CATEGORY_ID,
      productCategorySnapshot: {
        categoryId: "jersey",
      },
    } as never);
    mockedVertexAdapter.runTryOn.mockRejectedValue(
      new VertexTryOnError("VERTEX_TIMEOUT", "Tiempo agotado"),
    );

    await tryOnWorkflowService.processQueuedJob("job_1");

    expect(mockedJobService.claimJobForProcessing).toHaveBeenCalledWith("job_1");
    expect(mockedJobService.markFailed).toHaveBeenCalledWith(
      "job_1",
      "VERTEX_TIMEOUT",
      "La generacion tardo demasiado. Intenta de nuevo con otra foto.",
    );
    expect(mockedJobService.markCompleted).not.toHaveBeenCalled();
  });

  it("rechaza jobs legacy de mockup sin llamar a Vertex", async () => {
    mockedJobService.claimJobForProcessing.mockResolvedValue({
      id: "job_2",
      userId: "user_1",
      sessionId: "session_1",
      productId: "prod_cap",
      inputUserImageAssetId: "asset_1",
      inputUserImageUrl:
        "gs://e-comerce-leon-ai-private/ai/uploads/user_1/photo.png",
      inputProductImageUrl: "gs://e-comerce-leon.appspot.com/productos/gorra.png",
      status: TryOnJobStatus.PROCESSING,
      previewMode: ProductPreviewMode.ACCESSORY_MOCKUP,
      productPreviewType: ProductPreviewType.ACCESSORY,
      classificationSource: ProductPreviewClassificationSource.CATEGORY_ID,
      productCategorySnapshot: {
        categoryId: "gorra",
        categoryName: "Gorra",
        lineId: "souvenir",
        lineName: "Souvenir",
        productDescription: "Gorra oficial verde",
      },
    } as never);

    await tryOnWorkflowService.processQueuedJob("job_2");

    expect(mockedVertexAdapter.runTryOn).not.toHaveBeenCalled();
    expect(mockedPreviewMockupAdapter.generateMockup).not.toHaveBeenCalled();
    expect(mockedJobService.markFailed).toHaveBeenCalledWith(
      "job_2",
      "PRODUCT_PREVIEW_UNSUPPORTED",
      expect.any(String),
    );
    expect(mockedJobService.markCompleted).not.toHaveBeenCalled();
  });

  it("rechaza producto ambiguo antes de crear un job util", async () => {
    mockedSessionService.getSessionById.mockResolvedValue({
      id: "session_1",
      userId: "user_1",
    } as never);
    mockedEligibilityService.requireEligible.mockRejectedValue(
      new AiRuntimeError(
        "PRODUCT_PREVIEW_CLASSIFICATION_FAILED",
        "No se pudo clasificar el producto para una vista previa confiable",
        400,
      ),
    );

    await expect(
      tryOnWorkflowService.createJob({
        userId: "user_1",
        sessionId: "session_1",
        productId: "prod_unknown",
        userImageAssetId: "asset_1",
        consentAccepted: true,
        requestedByRole: RolUsuario.CLIENTE,
      }),
    ).rejects.toMatchObject({
      code: "PRODUCT_PREVIEW_CLASSIFICATION_FAILED",
    });

    expect(mockedJobService.createJob).not.toHaveBeenCalled();
  });

  it("firma la descarga usando el bucket persistido en el asset de salida", async () => {
    mockedJobService.getJobById.mockResolvedValue({
      id: "job_1",
      userId: "user_1",
      status: TryOnJobStatus.COMPLETED,
      outputAssetId: "asset_out_1",
    } as never);
    mockedAssetService.getAssetById.mockResolvedValue({
      id: "asset_out_1",
      userId: "user_1",
      jobId: "job_1",
      bucket: "custom-output-bucket",
      objectPath: "ai/tryon-results/user_1/session_1/job_1.png",
    } as never);
    mockedStorage.generateSignedDownloadUrl.mockResolvedValue(
      "https://signed.example/job_1",
    );

    const url = await tryOnWorkflowService.getDownloadUrl("job_1");

    expect(url).toBe("https://signed.example/job_1");
    expect(mockedStorage.generateSignedDownloadUrl).toHaveBeenCalledWith(
      "ai/tryon-results/user_1/session_1/job_1.png",
      "custom-output-bucket",
    );
  });
});
