jest.mock("../src/services/product.service", () => ({
  __esModule: true,
  default: {
    getProductById: jest.fn(),
  },
}));

jest.mock("../src/services/product-rating.service", () => ({
  __esModule: true,
  default: {
    getRatingEligibility: jest.fn(),
    getUserRating: jest.fn(),
  },
}));

import { getById } from "../src/controllers/products/products.query.controller";
import productService from "../src/services/product.service";
import productRatingService from "../src/services/product-rating.service";

const mockedProductService = productService as jest.Mocked<typeof productService>;
const mockedProductRatingService =
  productRatingService as jest.Mocked<typeof productRatingService>;

const createMockResponse = () => {
  const res: Record<string, jest.Mock> = {
    status: jest.fn(),
    json: jest.fn(),
  };

  res.status.mockReturnValue(res);
  return res;
};

describe("products.query.controller getById", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("retorna producto publico sin contexto de rating cuando no hay usuario", async () => {
    mockedProductService.getProductById.mockResolvedValue({
      id: "prod_1",
      descripcion: "Jersey Oficial",
      ratingSummary: {
        average: 4.5,
        count: 8,
      },
    } as never);

    const req = {
      params: { id: "prod_1" },
    } as unknown as Parameters<typeof getById>[0];
    const res = createMockResponse() as unknown as Parameters<typeof getById>[1];

    await getById(req, res);

    expect(mockedProductRatingService.getRatingEligibility).not.toHaveBeenCalled();
    expect(mockedProductRatingService.getUserRating).not.toHaveBeenCalled();
    expect((res as any).status).toHaveBeenCalledWith(200);
    expect((res as any).json).toHaveBeenCalledWith({
      success: true,
      data: {
        id: "prod_1",
        descripcion: "Jersey Oficial",
        ratingSummary: {
          average: 4.5,
          count: 8,
        },
      },
    });
  });

  it("agrega ratingEligibility y myRating cuando el usuario esta autenticado", async () => {
    mockedProductService.getProductById.mockResolvedValue({
      id: "prod_2",
      descripcion: "Gorra Oficial",
      ratingSummary: {
        average: 5,
        count: 2,
      },
    } as never);
    mockedProductRatingService.getRatingEligibility.mockResolvedValue({
      canRate: true,
      reason: "eligible",
    });
    mockedProductRatingService.getUserRating.mockResolvedValue({
      score: 5,
      updatedAt: "ts" as never,
    });

    const req = {
      params: { id: "prod_2" },
      user: { uid: "uid_2" },
    } as unknown as Parameters<typeof getById>[0];
    const res = createMockResponse() as unknown as Parameters<typeof getById>[1];

    await getById(req, res);

    expect(mockedProductRatingService.getRatingEligibility).toHaveBeenCalledWith(
      "prod_2",
      "uid_2",
    );
    expect(mockedProductRatingService.getUserRating).toHaveBeenCalledWith(
      "prod_2",
      "uid_2",
    );
    expect((res as any).status).toHaveBeenCalledWith(200);
    expect((res as any).json).toHaveBeenCalledWith({
      success: true,
      data: {
        id: "prod_2",
        descripcion: "Gorra Oficial",
        ratingSummary: {
          average: 5,
          count: 2,
        },
        ratingEligibility: {
          canRate: true,
          reason: "eligible",
        },
        myRating: {
          score: 5,
          updatedAt: "ts",
        },
      },
    });
  });
});
