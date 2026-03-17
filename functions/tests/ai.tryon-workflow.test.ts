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
  },
}));

jest.mock("../src/services/ai/jobs/tryon-asset.service", () => ({
  __esModule: true,
  default: {
    getAssetById: jest.fn(),
    attachJob: jest.fn(),
    createAsset: jest.fn(),
  },
}));

jest.mock("../src/services/ai/jobs/tryon-job.service", () => ({
  __esModule: true,
  default: {
    createJob: jest.fn(),
    getJobById: jest.fn(),
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

jest.mock("../src/services/product.service", () => ({
  __esModule: true,
  default: {
    getProductById: jest.fn(),
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

import tryOnWorkflowService from "../src/services/ai/jobs/tryon-workflow.service";
import aiStorageService from "../src/services/ai/storage/ai-storage.service";
import tryOnAssetService from "../src/services/ai/jobs/tryon-asset.service";
import tryOnJobService from "../src/services/ai/jobs/tryon-job.service";
import aiSessionService from "../src/services/ai/memory/session.service";
import productService from "../src/services/product.service";
import vertexTryOnAdapter, {
  VertexTryOnError,
} from "../src/services/ai/adapters/vertex-tryon.adapter";
import vertexPreviewMockupAdapter from "../src/services/ai/adapters/vertex-preview-mockup.adapter";
import productPreviewPolicyService from "../src/services/ai/jobs/product-preview-policy.service";
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
const mockedProductService = productService as jest.Mocked<typeof productService>;
const mockedVertexAdapter = vertexTryOnAdapter as jest.Mocked<
  typeof vertexTryOnAdapter
>;
const mockedPreviewMockupAdapter = vertexPreviewMockupAdapter as jest.Mocked<
  typeof vertexPreviewMockupAdapter
>;
const mockedPreviewPolicyService =
  productPreviewPolicyService as jest.Mocked<typeof productPreviewPolicyService>;

describe("AI try-on workflow", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
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
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it("crea job y convierte firebase storage URL a gs://", async () => {
    mockedSessionService.getSessionById.mockResolvedValue({
      id: "session_1",
      userId: "user_1",
    } as never);
    mockedAssetService.getAssetById.mockResolvedValue({
      id: "asset_1",
      userId: "user_1",
      kind: TryOnAssetKind.USER_UPLOAD,
      bucket: "e-comerce-leon-ai-private",
      objectPath: "ai/uploads/user_1/photo.png",
    } as never);
    mockedProductService.getProductById.mockResolvedValue({
      id: "prod_1",
      imagenes: [
        "https://firebasestorage.googleapis.com/v0/b/e-comerce-leon.appspot.com/o/productos%2Fjersey.png?alt=media&token=abc",
      ],
    } as never);
    mockedJobService.createJob.mockResolvedValue({
      id: "job_1",
    } as never);

    await tryOnWorkflowService.createJob({
      userId: "user_1",
      sessionId: "session_1",
      productId: "prod_1",
      userImageAssetId: "asset_1",
      consentAccepted: true,
      requestedByRole: RolUsuario.CLIENTE,
    });

    expect(mockedJobService.createJob).toHaveBeenCalledWith(
      expect.objectContaining({
        inputUserImageUrl:
          "gs://e-comerce-leon-ai-private/ai/uploads/user_1/photo.png",
        inputProductImageUrl:
          "gs://e-comerce-leon.appspot.com/productos/jersey.png",
        previewMode: ProductPreviewMode.BODY_TRYON,
        productPreviewType: ProductPreviewType.APPAREL,
        classificationSource: ProductPreviewClassificationSource.CATEGORY_ID,
      }),
    );
  });

  it("procesa job queued a completed y persiste referencia estable", async () => {
    mockedJobService.getJobById.mockResolvedValue({
      id: "job_1",
      userId: "user_1",
      sessionId: "session_1",
      productId: "prod_1",
      inputUserImageAssetId: "asset_1",
      inputUserImageUrl:
        "gs://e-comerce-leon-ai-private/ai/uploads/user_1/photo.png",
      inputProductImageUrl:
        "gs://e-comerce-leon.appspot.com/productos/jersey.png",
      status: TryOnJobStatus.QUEUED,
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
    mockedStorage.downloadGcsFile.mockResolvedValue({
      buffer: Buffer.from("person-image"),
      mimeType: "image/png",
      sizeBytes: 12,
    });
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

    expect(mockedJobService.markProcessing).toHaveBeenCalledWith("job_1");
    expect(mockedStorage.downloadGcsFile).toHaveBeenCalledWith(
      "gs://e-comerce-leon-ai-private/ai/uploads/user_1/photo.png",
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
    mockedJobService.getJobById.mockResolvedValue({
      id: "job_1",
      userId: "user_1",
      sessionId: "session_1",
      productId: "prod_1",
      inputUserImageAssetId: "asset_1",
      inputUserImageUrl: "gs://bucket/person.png",
      inputProductImageUrl: "gs://bucket/product.png",
      status: TryOnJobStatus.QUEUED,
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

    expect(mockedJobService.markProcessing).toHaveBeenCalledWith("job_1");
    expect(mockedJobService.markFailed).toHaveBeenCalledWith(
      "job_1",
      "VERTEX_TIMEOUT",
      "Tiempo agotado",
    );
    expect(mockedJobService.markCompleted).not.toHaveBeenCalled();
  });

  it("envia gorra al adapter de mockup y no al try-on corporal", async () => {
    mockedJobService.getJobById.mockResolvedValue({
      id: "job_2",
      userId: "user_1",
      sessionId: "session_1",
      productId: "prod_cap",
      inputUserImageAssetId: "asset_1",
      inputUserImageUrl:
        "gs://e-comerce-leon-ai-private/ai/uploads/user_1/photo.png",
      inputProductImageUrl: "gs://e-comerce-leon.appspot.com/productos/gorra.png",
      status: TryOnJobStatus.QUEUED,
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
    mockedStorage.downloadGcsFile.mockResolvedValue({
      buffer: Buffer.from("person-image"),
      mimeType: "image/png",
      sizeBytes: 12,
    });
    mockedPreviewMockupAdapter.generateMockup.mockResolvedValue({
      outputImageBytesBase64: Buffer.from("mockup-image").toString("base64"),
      mimeType: "image/png",
      rawResponse: {},
    } as never);
    mockedStorage.uploadPrivateFile.mockResolvedValue({
      bucket: "e-comerce-leon-ai-private",
      objectPath: "ai/tryon-results/user_1/session_1/mockup.png",
      sizeBytes: 456,
      sha256: "hash",
      gcsUri:
        "gs://e-comerce-leon-ai-private/ai/tryon-results/user_1/session_1/mockup.png",
    });
    mockedAssetService.createAsset.mockResolvedValue({
      id: "asset_out_mockup",
    } as never);

    await tryOnWorkflowService.processQueuedJob("job_2");

    expect(mockedVertexAdapter.runTryOn).not.toHaveBeenCalled();
    expect(mockedPreviewMockupAdapter.generateMockup).toHaveBeenCalledWith(
      expect.objectContaining({
        previewMode: ProductPreviewMode.ACCESSORY_MOCKUP,
        productPreviewType: ProductPreviewType.ACCESSORY,
        categoryName: "Gorra",
      }),
    );
    expect(mockedJobService.markCompleted).toHaveBeenCalledWith(
      "job_2",
      "asset_out_mockup",
      "gs://e-comerce-leon-ai-private/ai/tryon-results/user_1/session_1/mockup.png",
    );
  });

  it("rechaza producto ambiguo antes de crear un job util", async () => {
    mockedSessionService.getSessionById.mockResolvedValue({
      id: "session_1",
      userId: "user_1",
    } as never);
    mockedAssetService.getAssetById.mockResolvedValue({
      id: "asset_1",
      userId: "user_1",
      kind: TryOnAssetKind.USER_UPLOAD,
      bucket: "e-comerce-leon-ai-private",
      objectPath: "ai/uploads/user_1/photo.png",
    } as never);
    mockedProductService.getProductById.mockResolvedValue({
      id: "prod_unknown",
      descripcion: "Producto misterioso",
      categoriaId: "desconocido",
      lineaId: "desconocida",
      imagenes: [
        "https://firebasestorage.googleapis.com/v0/b/e-comerce-leon.appspot.com/o/productos%2Funknown.png?alt=media",
      ],
    } as never);
    mockedPreviewPolicyService.resolvePolicy.mockResolvedValue({
      previewMode: ProductPreviewMode.UNSUPPORTED,
      productPreviewType: ProductPreviewType.UNKNOWN,
      classificationSource: ProductPreviewClassificationSource.UNCLASSIFIED,
      productCategorySnapshot: {
        categoryId: "desconocido",
        productDescription: "Producto misterioso",
      },
    });

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
      status: TryOnJobStatus.COMPLETED,
      outputAssetId: "asset_out_1",
    } as never);
    mockedAssetService.getAssetById.mockResolvedValue({
      id: "asset_out_1",
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
