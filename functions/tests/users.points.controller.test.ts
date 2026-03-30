import { afterEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("../src/services/puntos.service", () => ({
  __esModule: true,
  default: {
    addPoints: jest.fn(),
  },
}));

import { assignPoints } from "../src/controllers/users/users.points.controller";
import pointsService from "../src/services/puntos.service";

const mockedPointsService = pointsService as jest.Mocked<typeof pointsService>;

const createMockResponse = () => {
  const res: Record<string, jest.Mock> = {
    status: jest.fn(),
    json: jest.fn(),
  };

  res.status.mockReturnValue(res);
  return res;
};

describe("users.points.controller assignPoints", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it("asigna puntos y responde con el saldo actualizado", async () => {
    mockedPointsService.addPoints.mockResolvedValue({
      id: "user_123",
      puntosActuales: 150,
    } as never);

    const req = {
      params: { id: "user_123" },
      body: { points: 50 },
    } as unknown as Parameters<typeof assignPoints>[0];
    const res = createMockResponse() as unknown as Parameters<typeof assignPoints>[1];

    await assignPoints(req, res);

    expect(mockedPointsService.addPoints).toHaveBeenCalledWith("user_123", 50, {
      origen: "admin",
      descripcion: "Asignacion manual de puntos",
    });
    expect((res as any).status).toHaveBeenCalledWith(200);
    expect((res as any).json).toHaveBeenCalledWith({
      success: true,
      message: "Puntos asignados exitosamente",
      data: {
        id: "user_123",
        puntosAsignados: 50,
        puntosActuales: 150,
      },
    });
  });

  it("responde 404 cuando el usuario no existe", async () => {
    mockedPointsService.addPoints.mockRejectedValue(
      new Error("Usuario no encontrado"),
    );

    const req = {
      params: { id: "missing_user" },
      body: { points: 50 },
    } as unknown as Parameters<typeof assignPoints>[0];
    const res = createMockResponse() as unknown as Parameters<typeof assignPoints>[1];

    await assignPoints(req, res);

    expect((res as any).status).toHaveBeenCalledWith(404);
    expect((res as any).json).toHaveBeenCalledWith({
      success: false,
      message: "Error al asignar puntos",
      error: "Usuario no encontrado",
    });
  });
});