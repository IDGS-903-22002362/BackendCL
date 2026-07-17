jest.mock("../src/services/ai/knowledge/store-business.service", () => ({
  __esModule: true,
  default: {
    searchProducts: jest.fn(),
    getPromotions: jest.fn(),
    getStoreInfo: jest.fn(),
    getPaymentMethods: jest.fn(),
    getOrderStatus: jest.fn(),
    detectImageReferencedProduct: jest.fn(),
    handoffToHuman: jest.fn(),
    listCategories: jest.fn(),
    listLines: jest.fn(),
    listCollections: jest.fn(),
    getProductDetail: jest.fn(),
    getProductPrice: jest.fn(),
    getProductStock: jest.fn(),
    getProductVariants: jest.fn(),
    getRelatedProducts: jest.fn(),
    getProductLink: jest.fn(),
    searchFaq: jest.fn(),
    getKnowledgeBundle: jest.fn(),
    getShippingInfo: jest.fn(),
    getReturnPolicy: jest.fn(),
    createCart: jest.fn(),
    addToCart: jest.fn(),
    removeFromCart: jest.fn(),
    adminUpdateStock: jest.fn(),
    adminViewPrivateInventory: jest.fn(),
    adminUpdatePrice: jest.fn(),
    adminPublishProduct: jest.fn(),
    adminHideProduct: jest.fn(),
  },
}));

jest.mock("../src/services/ai/jobs/tryon-workflow.service", () => ({
  __esModule: true,
  default: {
    createJob: jest.fn(),
    getJobStatus: jest.fn(),
    getDownloadUrl: jest.fn(),
  },
}));

import aiToolDefinitions from "../src/services/ai/tools/definitions";
import storeAiBusinessService from "../src/services/ai/knowledge/store-business.service";
import tryOnWorkflowService from "../src/services/ai/jobs/tryon-workflow.service";
import { AiAgentType } from "../src/models/ai/ai.model";
import { RolUsuario } from "../src/models/usuario.model";

const mockedStoreAiBusinessService = storeAiBusinessService as jest.Mocked<
  typeof storeAiBusinessService
>;
const mockedTryOnWorkflowService = tryOnWorkflowService as jest.Mocked<
  typeof tryOnWorkflowService
>;

describe("AI commerce tools", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("search_products delega la busqueda filtrada al servicio de negocio", async () => {
    const tool = aiToolDefinitions.find((item) => item.name === "search_products");
    mockedStoreAiBusinessService.searchProducts.mockResolvedValue([
      { id: "prod_1" },
    ] as never);

    const result = await tool!.execute(
      {
        query: "jersey local",
        filters: { categoryIds: ["jersey"] },
      },
      {
        userId: "user-1",
        role: RolUsuario.CLIENTE,
        capabilities: ["customer"],
        agentType: AiAgentType.SHOPPING,
        sessionMode: "authenticated",
      },
    );

    expect(mockedStoreAiBusinessService.searchProducts).toHaveBeenCalledWith(
      "jersey local",
      { categoryIds: ["jersey"] },
    );
    expect(result).toEqual({
      products: [{ id: "prod_1" }],
    });
  });

  it("detect_image_referenced_product propaga el uid autenticado para validar ownership", async () => {
    const tool = aiToolDefinitions.find(
      (item) => item.name === "detect_image_referenced_product",
    );
    mockedStoreAiBusinessService.detectImageReferencedProduct.mockResolvedValue(
      null,
    );

    await tool!.execute(
      {},
      {
        userId: "user-1",
        role: RolUsuario.CLIENTE,
        capabilities: ["customer"],
        agentType: AiAgentType.SHOPPING,
        sessionId: "session-1",
        sessionMode: "authenticated",
        attachments: [
          {
            assetId: "asset-user-2",
            mimeType: "image/jpeg",
            kind: "user_upload" as never,
          },
        ],
      },
    );

    expect(
      mockedStoreAiBusinessService.detectImageReferencedProduct,
    ).toHaveBeenCalledWith({
      userId: "user-1",
      sessionId: "session-1",
      attachments: [{ assetId: "asset-user-2" }],
    });
  });

  it("oculta por igual un job de try-on ajeno y uno inexistente al pedir descarga", async () => {
    const tool = aiToolDefinitions.find(
      (item) => item.name === "get_tryon_download_link",
    );
    const context = {
      userId: "user-1",
      role: RolUsuario.CLIENTE,
      capabilities: ["customer"],
      agentType: AiAgentType.SHOPPING,
      sessionMode: "authenticated" as const,
    };

    mockedTryOnWorkflowService.getJobStatus
      .mockResolvedValueOnce({
        id: "job-user-2",
        userId: "user-2",
        status: "completed",
      } as never)
      .mockResolvedValueOnce(null);

    const foreign = await tool!.execute({ jobId: "job-user-2" }, context);
    const missing = await tool!.execute({ jobId: "job-missing" }, context);

    expect(foreign).toEqual({
      jobId: "job-user-2",
      status: null,
      downloadUrl: null,
    });
    expect(missing).toEqual({
      jobId: "job-missing",
      status: null,
      downloadUrl: null,
    });
    expect(mockedTryOnWorkflowService.getDownloadUrl).not.toHaveBeenCalled();
  });
});
