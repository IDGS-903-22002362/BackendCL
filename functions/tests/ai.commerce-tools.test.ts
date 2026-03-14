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

import aiToolDefinitions from "../src/services/ai/tools/definitions";
import storeAiBusinessService from "../src/services/ai/knowledge/store-business.service";
import { RolUsuario } from "../src/models/usuario.model";

const mockedStoreAiBusinessService = storeAiBusinessService as jest.Mocked<
  typeof storeAiBusinessService
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
});
