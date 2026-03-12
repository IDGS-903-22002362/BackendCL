jest.mock("../src/services/ai/storage/ai-storage.service", () => ({
  __esModule: true,
  default: {
    buildGcsUri: jest.fn(),
    getBucketName: jest.fn(),
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

import tryOnWorkflowService from "../src/services/ai/jobs/tryon-workflow.service";
import aiStorageService from "../src/services/ai/storage/ai-storage.service";
import tryOnAssetService from "../src/services/ai/jobs/tryon-asset.service";
import tryOnJobService from "../src/services/ai/jobs/tryon-job.service";
import aiSessionService from "../src/services/ai/memory/session.service";
import productService from "../src/services/product.service";
import vertexTryOnAdapter, {
  VertexTryOnError,
} from "../src/services/ai/adapters/vertex-tryon.adapter";
import { TryOnAssetKind, TryOnJobStatus } from "../src/models/ai/ai.model";
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

describe("AI try-on workflow", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockedStorage.buildGcsUri.mockImplementation(
      (objectPath: string, bucketName?: string) =>
        `gs://${bucketName || "e-comerce-leon-ai-private"}/${objectPath}`,
    );
    mockedStorage.getBucketName.mockReturnValue("e-comerce-leon-ai-private");
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
    } as never);
    mockedVertexAdapter.runTryOn.mockResolvedValue({
      outputImageBytesBase64: Buffer.from("fake-image").toString("base64"),
      mimeType: "image/png",
      rawResponse: {},
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
});
