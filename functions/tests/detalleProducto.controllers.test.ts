jest.mock("../src/services/detalleProducto.service", () => ({
  __esModule: true,
  DetalleProductoServiceError: class DetalleProductoServiceError extends Error {
    constructor(public readonly code: string, message: string) {
      super(message);
    }
  },
  default: {
    getDetallesByProducto: jest.fn(),
    getDetalleById: jest.fn(),
    createDetalle: jest.fn(),
    updateDetalle: jest.fn(),
    deleteDetalle: jest.fn(),
  },
}));

import {
  createDetalle,
  deleteDetalle,
  updateDetalle,
} from "../src/controllers/detalleProducto/detalleProducto.command.controller";
import {
  getDetalleById,
  getDetallesByProducto,
} from "../src/controllers/detalleProducto/detalleProducto.query.controller";
import detalleProductoService, {
  DetalleProductoServiceError,
} from "../src/services/detalleProducto.service";

const mockedDetalleProductoService =
  detalleProductoService as jest.Mocked<typeof detalleProductoService>;

const createMockResponse = () => {
  const res: Record<string, jest.Mock> = {
    status: jest.fn(),
    json: jest.fn(),
  };

  res.status.mockReturnValue(res);
  return res;
};

describe("detalleProducto controllers", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("lista detalles correctamente", async () => {
    mockedDetalleProductoService.getDetallesByProducto.mockResolvedValue([
      {
        id: "det_1",
        descripcion: "Tela dry-fit",
        productoId: "prod_1",
      },
    ] as never);

    const req = { params: { productoId: "prod_1" } } as never;
    const res = createMockResponse() as never;

    await getDetallesByProducto(req, res);

    expect((res as any).status).toHaveBeenCalledWith(200);
  });

  it("retorna 404 al obtener un detalle inexistente", async () => {
    mockedDetalleProductoService.getDetalleById.mockResolvedValue(null as never);

    const req = {
      params: { productoId: "prod_1", detalleId: "missing" },
    } as never;
    const res = createMockResponse() as never;

    await getDetalleById(req, res);

    expect((res as any).status).toHaveBeenCalledWith(404);
  });

  it("crea un detalle correctamente", async () => {
    mockedDetalleProductoService.createDetalle.mockResolvedValue({
      id: "det_1",
      descripcion: "Nueva tecnologia",
      productoId: "prod_1",
    } as never);

    const req = {
      params: { productoId: "prod_1" },
      body: { descripcion: "Nueva tecnologia" },
    } as never;
    const res = createMockResponse() as never;

    await createDetalle(req, res);

    expect((res as any).status).toHaveBeenCalledWith(201);
  });

  it("retorna 404 cuando el service reporta no encontrado", async () => {
    mockedDetalleProductoService.updateDetalle.mockRejectedValue(
      new DetalleProductoServiceError("NOT_FOUND", "missing detail"),
    );

    const req = {
      params: { productoId: "prod_1", detalleId: "missing" },
      body: { descripcion: "Cambio" },
    } as never;
    const res = createMockResponse() as never;

    await updateDetalle(req, res);

    expect((res as any).status).toHaveBeenCalledWith(404);
    expect((res as any).json).toHaveBeenCalledWith({
      success: false,
      error: {
        code: "NOT_FOUND",
        message: "missing detail",
      },
    });
  });

  it("elimina un detalle correctamente", async () => {
    mockedDetalleProductoService.deleteDetalle.mockResolvedValue(undefined as never);

    const req = {
      params: { productoId: "prod_1", detalleId: "det_1" },
    } as never;
    const res = createMockResponse() as never;

    await deleteDetalle(req, res);

    expect((res as any).status).toHaveBeenCalledWith(200);
  });
});
