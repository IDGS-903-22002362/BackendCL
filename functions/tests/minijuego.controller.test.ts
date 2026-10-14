import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("../src/services/minijuego.service", () => ({
  __esModule: true,
  default: {
    play: jest.fn(),
    getDetails: jest.fn(),
    getPendingPlay: jest.fn(),
    acknowledge: jest.fn(),
    createMinijuegoBeneficio: jest.fn(),
    updateMinijuegoBeneficio: jest.fn(),
    listMisBeneficios: jest.fn(),
  },
}));

import {
  acknowledge,
  getMisBeneficios,
  getPendingPlay,
  play,
} from "../src/controllers/minijuegos/minijuego.controller";
import minijuegoService from "../src/services/minijuego.service";
import { MinijuegoError } from "../src/services/minijuego.logic";

const mockedService = minijuegoService as jest.Mocked<typeof minijuegoService>;

const createMockResponse = () => {
  const res: Record<string, jest.Mock> = {
    status: jest.fn(),
    json: jest.fn(),
  };
  res.status.mockReturnValue(res);
  return res;
};

describe("minijuego play controller", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("responde 403 sin usar el correo del body", async () => {
    mockedService.play.mockRejectedValue(
      new MinijuegoError(
        "MINIGAME_ACCESS_DENIED",
        403,
        "Este minijuego ya no está disponible para tu cuenta.",
      ),
    );

    const req = {
      params: { id: "game-1" },
      header: () => "idem-key-1",
      body: { email: "jonyhdzmichaca@gmail.com" },
      user: { uid: "user-real", email: "intruso@ejemplo.com" },
    } as unknown as Parameters<typeof play>[0];
    const res = createMockResponse() as unknown as Parameters<typeof play>[1];

    await play(req, res);

    expect(mockedService.play).toHaveBeenCalledWith(
      "game-1",
      { uid: "user-real", email: "intruso@ejemplo.com" },
      "idem-key-1",
    );
    expect((res as unknown as { status: jest.Mock }).status).toHaveBeenCalledWith(
      403,
    );
    expect((res as unknown as { json: jest.Mock }).json).toHaveBeenCalledWith({
      success: false,
      code: "MINIGAME_ACCESS_DENIED",
      message: "Este minijuego ya no está disponible para tu cuenta.",
    });
  });

  it("registra la jugada con el uid del JWT y responde 200", async () => {
    mockedService.play.mockResolvedValue({
      id: "play-1",
      alreadyPlayed: false,
    } as never);

    const req = {
      params: { id: "game-1" },
      header: () => "idem-key-1",
      body: { uid: "uid-falso" },
      user: { uid: "uid-a" },
    } as unknown as Parameters<typeof play>[0];
    const res = createMockResponse() as unknown as Parameters<typeof play>[1];

    await play(req, res);

    expect(mockedService.play).toHaveBeenCalledWith(
      "game-1",
      { uid: "uid-a", email: undefined },
      "idem-key-1",
    );
    expect((res as unknown as { status: jest.Mock }).status).toHaveBeenCalledWith(
      200,
    );
  });

  it("consulta la jugada pendiente solo con el uid autenticado", async () => {
    mockedService.getPendingPlay.mockResolvedValue(null as never);
    const req = {
      params: { id: "game-1" },
      body: { uid: "uid-falso" },
      user: { uid: "uid-a", email: "a@club.com" },
    } as unknown as Parameters<typeof getPendingPlay>[0];
    const res = createMockResponse() as unknown as Parameters<typeof getPendingPlay>[1];

    await getPendingPlay(req, res);

    expect(mockedService.getPendingPlay).toHaveBeenCalledWith("game-1", {
      uid: "uid-a",
      email: "a@club.com",
    });
  });

  it("lista mis beneficios solo con el uid del JWT", async () => {
    mockedService.listMisBeneficios.mockResolvedValue([
      { playId: "play-1", premioNombre: "Boletos" },
    ] as never);
    const req = {
      params: {},
      query: { uid: "uid-ajeno" },
      user: { uid: "uid-real", email: "socio@club.com" },
    } as unknown as Parameters<typeof getMisBeneficios>[0];
    const res = createMockResponse() as unknown as Parameters<typeof getMisBeneficios>[1];

    await getMisBeneficios(req, res);

    expect(mockedService.listMisBeneficios).toHaveBeenCalledWith({
      uid: "uid-real",
      email: "socio@club.com",
    });
    expect((res as unknown as { status: jest.Mock }).status).toHaveBeenCalledWith(
      200,
    );
    expect((res as unknown as { json: jest.Mock }).json).toHaveBeenCalledWith({
      success: true,
      count: 1,
      data: [{ playId: "play-1", premioNombre: "Boletos" }],
    });
  });

  it("confirma la jugada solo con el uid autenticado", async () => {
    mockedService.acknowledge.mockRejectedValue(
      new MinijuegoError(
        "MINIGAME_ACCESS_DENIED",
        403,
        "Esta participación no está disponible para tu cuenta.",
      ),
    );
    const req = {
      params: { id: "game-1", playId: "play-de-a" },
      body: { uid: "uid-a" },
      user: { uid: "uid-b" },
    } as unknown as Parameters<typeof acknowledge>[0];
    const res = createMockResponse() as unknown as Parameters<typeof acknowledge>[1];

    await acknowledge(req, res);

    expect(mockedService.acknowledge).toHaveBeenCalledWith(
      "game-1",
      "play-de-a",
      { uid: "uid-b", email: undefined },
    );
    expect((res as unknown as { status: jest.Mock }).status).toHaveBeenCalledWith(
      403,
    );
  });
});
