import { afterEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("../src/services/beneficio.service", () => ({
  __esModule: true,
  default: {
    getAllBeneficios: jest.fn(),
    getBeneficioById: jest.fn(),
    createBeneficio: jest.fn(),
    updateBeneficio: jest.fn(),
    deleteBeneficio: jest.fn(),
  },
}));

import * as commandController from "../src/controllers/beneficios/beneficio.command.controller";
import * as queryController from "../src/controllers/beneficios/beneficio.query.controller";
import beneficioService from "../src/services/beneficio.service";

const mockedBeneficioService = beneficioService as jest.Mocked<
  typeof beneficioService
>;

const createMockResponse = () => {
  const res: Record<string, jest.Mock> = {
    status: jest.fn(),
    json: jest.fn(),
  };

  res.status.mockReturnValue(res);
  return res;
};

describe("beneficio controllers", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it("getAll responde con beneficios", async () => {
    mockedBeneficioService.getAllBeneficios.mockResolvedValue([
      {
        id: "benefit-1",
        titulo: "Descuento especial",
        descripcion: "Descripcion del beneficio",
        estatus: true,
        createdAt: new Date("2026-04-30T12:00:00Z"),
        updatedAt: new Date("2026-04-30T12:00:00Z"),
      },
    ] as never);

    const req = {} as unknown as Parameters<typeof queryController.getAll>[0];
    const res = createMockResponse() as unknown as Parameters<typeof queryController.getAll>[1];

    await queryController.getAll(req, res);

    expect(mockedBeneficioService.getAllBeneficios).toHaveBeenCalled();
    expect((res as any).status).toHaveBeenCalledWith(200);
    expect((res as any).json).toHaveBeenCalledWith({
      success: true,
      count: 1,
      data: expect.any(Array),
    });
  });

  it("create crea un beneficio", async () => {
    mockedBeneficioService.createBeneficio.mockResolvedValue({
      id: "benefit-1",
      titulo: "Descuento especial",
      descripcion: "Descripcion del beneficio",
      estatus: true,
      createdAt: new Date("2026-04-30T12:00:00Z"),
      updatedAt: new Date("2026-04-30T12:00:00Z"),
    } as never);

    const req = {
      body: {
        titulo: "Descuento especial",
        descripcion: "Descripcion del beneficio",
        estatus: true,
      },
    } as unknown as Parameters<typeof commandController.create>[0];
    const res = createMockResponse() as unknown as Parameters<typeof commandController.create>[1];

    await commandController.create(req, res);

    expect(mockedBeneficioService.createBeneficio).toHaveBeenCalledWith({
      titulo: "Descuento especial",
      descripcion: "Descripcion del beneficio",
      estatus: true,
    });
    expect((res as any).status).toHaveBeenCalledWith(201);
  });

  it("update actualiza un beneficio", async () => {
    mockedBeneficioService.updateBeneficio.mockResolvedValue({
      id: "benefit-1",
      titulo: "Descuento actualizado",
      descripcion: "Nueva descripcion",
      estatus: true,
      createdAt: new Date("2026-04-30T12:00:00Z"),
      updatedAt: new Date("2026-04-30T12:30:00Z"),
    } as never);

    const req = {
      params: { id: "benefit-1" },
      body: {
        titulo: "Descuento actualizado",
        descripcion: "Nueva descripcion",
      },
    } as unknown as Parameters<typeof commandController.update>[0];
    const res = createMockResponse() as unknown as Parameters<typeof commandController.update>[1];

    await commandController.update(req, res);

    expect(mockedBeneficioService.updateBeneficio).toHaveBeenCalledWith(
      "benefit-1",
      {
        titulo: "Descuento actualizado",
        descripcion: "Nueva descripcion",
      },
    );
    expect((res as any).status).toHaveBeenCalledWith(200);
  });

  it("remove elimina un beneficio", async () => {
    mockedBeneficioService.deleteBeneficio.mockResolvedValue(undefined as never);

    const req = {
      params: { id: "benefit-1" },
    } as unknown as Parameters<typeof commandController.remove>[0];
    const res = createMockResponse() as unknown as Parameters<typeof commandController.remove>[1];

    await commandController.remove(req, res);

    expect(mockedBeneficioService.deleteBeneficio).toHaveBeenCalledWith(
      "benefit-1",
    );
    expect((res as any).status).toHaveBeenCalledWith(200);
  });
});