jest.mock("../src/services/favorito.service", () => ({
  __esModule: true,
  FavoritoServiceError: class FavoritoServiceError extends Error {
    constructor(public readonly code: string, message: string) {
      super(message);
    }
  },
  default: {
    createFavorito: jest.fn(),
    deleteFavorito: jest.fn(),
    getFavoritos: jest.fn(),
    isFavorito: jest.fn(),
  },
}));

import {
  createFavorito,
  deleteFavorito,
} from "../src/controllers/favoritos/favorito.command.controller";
import {
  checkFavorito,
  getFavoritos,
} from "../src/controllers/favoritos/favorito.query.controller";
import favoritoService, {
  FavoritoServiceError,
} from "../src/services/favorito.service";

const mockedFavoritoService = favoritoService as jest.Mocked<typeof favoritoService>;

const createMockResponse = () => {
  const res: Record<string, jest.Mock> = {
    status: jest.fn(),
    json: jest.fn(),
  };

  res.status.mockReturnValue(res);
  return res;
};

describe("favorito controllers", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("retorna 401 en listado cuando no hay usuario", async () => {
    const req = { query: {} } as never;
    const res = createMockResponse() as never;

    await getFavoritos(req, res);

    expect((res as any).status).toHaveBeenCalledWith(401);
  });

  it("retorna listado con meta", async () => {
    mockedFavoritoService.getFavoritos.mockResolvedValue([
      {
        id: "fav_1",
        usuarioId: "uid_1",
        createdAt: "ts-1",
        producto: {
          id: "prod_1",
          clave: "JER-1",
          descripcion: "Jersey",
          precioPublico: 1000,
          imagenes: ["img-1"],
        },
      },
    ] as never);

    const req = {
      user: { uid: "uid_1" },
      query: { limit: "10", offset: "5" },
    } as never;
    const res = createMockResponse() as never;

    await getFavoritos(req, res);

    expect((res as any).status).toHaveBeenCalledWith(200);
    expect((res as any).json).toHaveBeenCalledWith({
      success: true,
      count: 1,
      meta: {
        limit: 10,
        offset: 5,
        returned: 1,
      },
      data: expect.any(Array),
    });
  });

  it("retorna 201 al crear un favorito nuevo", async () => {
    mockedFavoritoService.createFavorito.mockResolvedValue({
      created: true,
      favorito: {
        id: "uid_1__prod_1",
        usuarioId: "uid_1",
        productoId: "prod_1",
        createdAt: "ts-now",
      },
    } as never);

    const req = {
      user: { uid: "uid_1" },
      body: { productoId: "prod_1" },
    } as never;
    const res = createMockResponse() as never;

    await createFavorito(req, res);

    expect((res as any).status).toHaveBeenCalledWith(201);
  });

  it("retorna 404 al eliminar un favorito inexistente", async () => {
    mockedFavoritoService.deleteFavorito.mockRejectedValue(
      new FavoritoServiceError("NOT_FOUND", "missing favorite"),
    );

    const req = {
      user: { uid: "uid_1" },
      params: { productoId: "prod_9" },
    } as never;
    const res = createMockResponse() as never;

    await deleteFavorito(req, res);

    expect((res as any).status).toHaveBeenCalledWith(404);
    expect((res as any).json).toHaveBeenCalledWith({
      success: false,
      error: {
        code: "NOT_FOUND",
        message: "missing favorite",
      },
    });
  });

  it("retorna 200 al verificar favorito", async () => {
    mockedFavoritoService.isFavorito.mockResolvedValue(true);

    const req = {
      user: { uid: "uid_1" },
      params: { productoId: "prod_1" },
    } as never;
    const res = createMockResponse() as never;

    await checkFavorito(req, res);

    expect((res as any).status).toHaveBeenCalledWith(200);
    expect((res as any).json).toHaveBeenCalledWith({
      success: true,
      data: { esFavorito: true },
    });
  });
});
