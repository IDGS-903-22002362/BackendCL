jest.mock("../src/services/product.service", () => ({
  __esModule: true,
  CatalogQueryError: class CatalogQueryError extends Error {
    statusCode = 400;
  },
  default: {
    getProductById: jest.fn(),
    listCatalogProducts: jest.fn(),
    getAdminProducts: jest.fn(),
  },
}));

jest.mock("../src/services/favorito.service", () => ({
  __esModule: true,
  default: {
    isFavorito: jest.fn(),
  },
}));

jest.mock("../src/services/product-rating.service", () => ({
  __esModule: true,
  default: {
    getRatingEligibility: jest.fn(),
    getUserRating: jest.fn(),
  },
}));

import {
  getAdminProducts,
  getById,
  getCatalog,
} from "../src/controllers/products/products.query.controller";
import favoritoService from "../src/services/favorito.service";
import productService, { CatalogQueryError } from "../src/services/product.service";
import productRatingService from "../src/services/product-rating.service";

const mockedProductService = productService as jest.Mocked<typeof productService>;
const mockedFavoritoService = favoritoService as jest.Mocked<typeof favoritoService>;
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
    expect(mockedFavoritoService.isFavorito).not.toHaveBeenCalled();
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
    mockedFavoritoService.isFavorito.mockResolvedValue(true);

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
    expect(mockedFavoritoService.isFavorito).toHaveBeenCalledWith("uid_2", "prod_2");
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
        isFavorito: true,
      },
    });
  });

  it("responde 500 si falla la consulta de favoritos del usuario autenticado", async () => {
    mockedProductService.getProductById.mockResolvedValue({
      id: "prod_3",
      descripcion: "Balon Oficial",
      ratingSummary: {
        average: 4.2,
        count: 11,
      },
    } as never);
    mockedProductRatingService.getRatingEligibility.mockResolvedValue({
      canRate: false,
      reason: "eligible",
    });
    mockedProductRatingService.getUserRating.mockResolvedValue(null as never);
    mockedFavoritoService.isFavorito.mockRejectedValue(
      new Error("favorite lookup failed"),
    );

    const req = {
      params: { id: "prod_3" },
      user: { uid: "uid_3" },
    } as unknown as Parameters<typeof getById>[0];
    const res = createMockResponse() as unknown as Parameters<typeof getById>[1];

    await getById(req, res);

    expect((res as any).status).toHaveBeenCalledWith(500);
    expect((res as any).json).toHaveBeenCalledWith({
      success: false,
      message: "Error al obtener el producto",
      error: "favorite lookup failed",
    });
  });
});

describe("products.query.controller getCatalog", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("retorna la respuesta exacta del catalogo publico", async () => {
    mockedProductService.listCatalogProducts.mockResolvedValue({
      items: [],
      nextCursor: null,
      hasMore: false,
    });

    const req = {
      query: { limit: 24 },
    } as unknown as Parameters<typeof getCatalog>[0];
    const res = createMockResponse() as unknown as Parameters<typeof getCatalog>[1];

    await getCatalog(req, res);

    expect(mockedProductService.listCatalogProducts).toHaveBeenCalledWith({
      limit: 24,
    });
    expect((res as any).status).toHaveBeenCalledWith(200);
    expect((res as any).json).toHaveBeenCalledWith({
      items: [],
      nextCursor: null,
      hasMore: false,
    });
  });

  it("responde 400 cuando el servicio rechaza filtros o cursor", async () => {
    const error = new CatalogQueryError("cursor invalido");
    mockedProductService.listCatalogProducts.mockRejectedValue(error);

    const req = {
      query: { cursor: "bad" },
    } as unknown as Parameters<typeof getCatalog>[0];
    const res = createMockResponse() as unknown as Parameters<typeof getCatalog>[1];

    await getCatalog(req, res);

    expect((res as any).status).toHaveBeenCalledWith(400);
    expect((res as any).json).toHaveBeenCalledWith({
      success: false,
      message: "cursor invalido",
    });
  });
});

describe("products.query.controller getAdminProducts", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("retorna productos activos e inactivos para admin", async () => {
    mockedProductService.getAdminProducts.mockResolvedValue([
      {
        id: "prod_1",
        clave: "SKU-1",
        descripcion: "Jersey",
        slug: "jersey",
        lineaId: "hombre",
        categoriaId: "jerseys",
        precioPublico: 1200,
        existencias: 5,
        disponible: true,
        destacado: false,
        activo: false,
        imagenPrincipal: null,
      },
    ]);

    const req = {
      query: { estado: "todos" },
    } as unknown as Parameters<typeof getAdminProducts>[0];
    const res = createMockResponse() as unknown as Parameters<typeof getAdminProducts>[1];

    await getAdminProducts(req, res);

    expect(mockedProductService.getAdminProducts).toHaveBeenCalledWith({
      estado: "todos",
    });
    expect((res as any).status).toHaveBeenCalledWith(200);
    expect((res as any).json).toHaveBeenCalledWith({
      success: true,
      count: 1,
      data: [
        expect.objectContaining({
          id: "prod_1",
          activo: false,
        }),
      ],
    });
  });
});
