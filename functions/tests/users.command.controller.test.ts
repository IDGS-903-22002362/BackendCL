import { afterEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("../src/services/user.service", () => ({
  __esModule: true,
  default: {
    updateByUid: jest.fn(),
  },
}));

jest.mock("../src/services/puntos.service", () => ({
  __esModule: true,
  default: {},
}));

import {
  actualizarPerfil,
  completarPerfil,
} from "../src/controllers/users/users.command.controller";
import userAppService from "../src/services/user.service";

const mockedUserAppService = userAppService as jest.Mocked<typeof userAppService>;

const createMockResponse = () => {
  const res: Record<string, jest.Mock> = {
    status: jest.fn(),
    json: jest.fn(),
  };

  res.status.mockReturnValue(res);
  return res;
};

describe("users.command.controller profile handlers", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it("actualizarPerfil envia nombre y telefono al servicio", async () => {
    mockedUserAppService.updateByUid.mockResolvedValue({
      id: "user-1",
      nombre: "Juan Perez",
      telefono: "4771234567",
    } as never);

    const req = {
      user: { uid: "uid-123" },
      body: {
        nombre: "Juan Perez",
        telefono: "4771234567",
      },
    } as unknown as Parameters<typeof actualizarPerfil>[0];
    const res = createMockResponse() as unknown as Parameters<typeof actualizarPerfil>[1];

    await actualizarPerfil(req, res);

    expect(mockedUserAppService.updateByUid).toHaveBeenCalledWith("uid-123", {
      nombre: "Juan Perez",
      telefono: "4771234567",
    });
    expect((res as any).status).toHaveBeenCalledWith(200);
  });

  it("completarPerfil envia nombre junto con el resto del perfil", async () => {
    mockedUserAppService.updateByUid.mockResolvedValue({
      id: "user-1",
      nombre: "Juan Perez",
      telefono: "4771234567",
      genero: "M",
    } as never);

    const req = {
      user: { uid: "uid-123" },
      body: {
        nombre: "Juan Perez",
        telefono: "4771234567",
        fechaNacimiento: "2000-04-15",
        genero: "M",
      },
    } as unknown as Parameters<typeof completarPerfil>[0];
    const res = createMockResponse() as unknown as Parameters<typeof completarPerfil>[1];

    await completarPerfil(req, res);

    expect(mockedUserAppService.updateByUid).toHaveBeenCalledWith("uid-123", {
      nombre: "Juan Perez",
      telefono: "4771234567",
      fechaNacimiento: "2000-04-15",
      genero: "M",
      edad: expect.any(Number),
      perfilCompleto: true,
    });
    expect((res as any).status).toHaveBeenCalledWith(200);
  });
});