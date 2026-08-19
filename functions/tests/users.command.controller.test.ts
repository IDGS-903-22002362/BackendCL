import { afterEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("../src/services/user.service", () => ({
  __esModule: true,
  default: {
    updateByUid: jest.fn(),
    getUserByUid: jest.fn(),
  },
}));

jest.mock("../src/services/puntos.service", () => ({
  __esModule: true,
  default: {
    addPoints: jest.fn(),
  },
}));

jest.mock("../src/config/firebase.admin", () => ({
  admin: {
    initializeApp: jest.fn(),
    credential: { cert: jest.fn() },
    firestore: {
      Timestamp: {
        now: jest.fn(() => ({ seconds: 1, nanoseconds: 0 })),
      },
      FieldValue: {
        serverTimestamp: jest.fn(() => "SERVER_TIMESTAMP"),
      },
    },
  },
}));

jest.mock("../src/config/app.firebase", () => ({
  firestoreApp: {},
  authAppOficial: {},
}));

jest.mock("../src/services/season-pass-verification.service", () => ({
  __esModule: true,
  default: {},
  SeasonPassVerificationError: class SeasonPassVerificationError extends Error {},
}));

jest.mock("../src/modules/loyalty/services/loyalty-engine.service", () => ({
  __esModule: true,
  default: {
    applyProfileCompletionBonus: jest.fn(),
    applySocialSignupBonus: jest.fn(),
  },
}));

jest.mock("../src/utils/middlewares", () => ({
  verifyClientAppCheckToken: jest.fn(),
}));

import {
  actualizarPerfil,
  completarDatosPerfil,
  completarPerfil,
} from "../src/controllers/users/users.command.controller";
import userAppService from "../src/services/user.service";
import pointsService from "../src/services/puntos.service";
import loyaltyEngineService from "../src/modules/loyalty/services/loyalty-engine.service";
import {
  canClaimProfileBonus,
  shouldAwardSocialSignupBonus,
  validateRequiredDemographics,
} from "../src/utils/profile-completion.util";

const mockedUserAppService = userAppService as jest.Mocked<typeof userAppService>;
const mockedPointsService = pointsService as jest.Mocked<typeof pointsService>;
const mockedLoyaltyEngine = loyaltyEngineService as jest.Mocked<
  typeof loyaltyEngineService
>;

const createMockResponse = () => {
  const res: Record<string, jest.Mock> = {
    status: jest.fn(),
    json: jest.fn(),
  };

  res.status.mockReturnValue(res);
  return res;
};

describe("profile-completion.util", () => {
  it("canClaimProfileBonus solo para email sin bono y datos incompletos", () => {
    expect(
      canClaimProfileBonus({
        provider: "email",
        telefono: "",
        fechaNacimiento: null,
        genero: "",
      }),
    ).toBe(true);

    expect(
      canClaimProfileBonus({
        provider: "google",
        telefono: "",
        fechaNacimiento: null,
        genero: "",
      }),
    ).toBe(false);

    expect(
      canClaimProfileBonus({
        provider: "email",
        bonoPerfilCompletadoAt: { seconds: 1 },
        telefono: "4771234567",
        fechaNacimiento: "2000-01-01",
        genero: "masculino",
      }),
    ).toBe(false);
  });

  it("shouldAwardSocialSignupBonus solo google/apple sin bono previo", () => {
    expect(shouldAwardSocialSignupBonus({ provider: "google" })).toBe(true);
    expect(shouldAwardSocialSignupBonus({ provider: "apple" })).toBe(true);
    expect(shouldAwardSocialSignupBonus({ provider: "email" })).toBe(false);
    expect(
      shouldAwardSocialSignupBonus({
        provider: "google",
        bonoSocialRegistroAt: { seconds: 1 },
      }),
    ).toBe(false);

    expect(
      canClaimProfileBonus({
        provider: "email",
        telefono: "4771234567",
        fechaNacimiento: "2000-01-01",
        genero: "masculino",
      }),
    ).toBe(false);
  });

  it("validateRequiredDemographics exige telefono fecha y genero", () => {
    expect(
      validateRequiredDemographics({
        telefono: "477",
        fechaNacimiento: "2000-01-01",
        genero: "M",
      }).ok,
    ).toBe(false);

    const ok = validateRequiredDemographics({
      nombre: "Ana",
      telefono: "4771234567",
      fechaNacimiento: "2000-01-01",
      genero: "F",
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.data.genero).toBe("femenino");
      expect(ok.data.telefono).toBe("4771234567");
    }
  });
});

describe("users.command.controller profile handlers", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it("actualizarPerfil solo actualiza el genero", async () => {
    mockedUserAppService.updateByUid.mockResolvedValue({
      id: "user-1",
      genero: "femenino",
    } as never);

    const req = {
      user: { uid: "uid-123" },
      body: {
        nombre: "Juan Perez",
        telefono: "4771234567",
        genero: "F",
      },
    } as unknown as Parameters<typeof actualizarPerfil>[0];
    const res = createMockResponse() as unknown as Parameters<
      typeof actualizarPerfil
    >[1];

    await actualizarPerfil(req, res);

    expect(mockedUserAppService.updateByUid).toHaveBeenCalledWith("uid-123", {
      genero: "femenino",
    });
    expect((res as any).status).toHaveBeenCalledWith(200);
  });

  it("completarPerfil otorga bono social a google y no el de email", async () => {
    mockedUserAppService.getUserByUid
      .mockResolvedValueOnce({
        id: "user-1",
        uid: "uid-123",
        provider: "google",
        perfilCompleto: false,
      } as never)
      .mockResolvedValueOnce({
        id: "user-1",
        nombre: "Juan Perez",
        telefono: "4771234567",
        genero: "masculino",
        perfilCompleto: true,
      } as never);
    mockedUserAppService.updateByUid.mockResolvedValue({} as never);
    mockedLoyaltyEngine.applySocialSignupBonus.mockResolvedValue({} as never);

    const req = {
      user: { uid: "uid-123" },
      body: {
        nombre: "Juan Perez",
        telefono: "4771234567",
        fechaNacimiento: "2000-04-15",
        genero: "M",
      },
    } as unknown as Parameters<typeof completarPerfil>[0];
    const res = createMockResponse() as unknown as Parameters<
      typeof completarPerfil
    >[1];

    await completarPerfil(req, res);

    expect(mockedLoyaltyEngine.applySocialSignupBonus).toHaveBeenCalledWith(
      "uid-123",
    );
    expect(mockedLoyaltyEngine.applyProfileCompletionBonus).not.toHaveBeenCalled();
    expect(mockedPointsService.addPoints).not.toHaveBeenCalled();
    expect((res as any).status).toHaveBeenCalledWith(200);
    expect((res as any).json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        bonoOtorgado: true,
        puntosBonificados: 15,
      }),
    );
  });

  it("completarPerfil otorga bono de perfil a email via loyalty engine", async () => {
    mockedUserAppService.getUserByUid
      .mockResolvedValueOnce({
        id: "user-1",
        uid: "uid-123",
        provider: "email",
        perfilCompleto: false,
      } as never)
      .mockResolvedValueOnce({
        id: "user-1",
        puntosActuales: 55,
        perfilCompleto: true,
      } as never);
    mockedUserAppService.updateByUid.mockResolvedValue({} as never);
    mockedLoyaltyEngine.applyProfileCompletionBonus.mockResolvedValue(
      {} as never,
    );

    const req = {
      user: { uid: "uid-123" },
      body: {
        nombre: "Ana",
        telefono: "4771234567",
        fechaNacimiento: "1998-02-10",
        genero: "F",
      },
    } as unknown as Parameters<typeof completarPerfil>[0];
    const res = createMockResponse() as unknown as Parameters<
      typeof completarPerfil
    >[1];

    await completarPerfil(req, res);

    expect(mockedLoyaltyEngine.applyProfileCompletionBonus).toHaveBeenCalledWith(
      "uid-123",
    );
    expect(mockedLoyaltyEngine.applySocialSignupBonus).not.toHaveBeenCalled();
    expect((res as any).status).toHaveBeenCalledWith(200);
    expect((res as any).json).toHaveBeenCalledWith(
      expect.objectContaining({
        bonoOtorgado: true,
        puntosBonificados: 15,
      }),
    );
  });

  it("completarPerfil reporta bonoOtorgado false si el bono ya fue otorgado", async () => {
    mockedUserAppService.getUserByUid
      .mockResolvedValueOnce({
        id: "user-1",
        uid: "uid-123",
        provider: "google",
        perfilCompleto: false,
      } as never)
      .mockResolvedValueOnce({
        id: "user-1",
        perfilCompleto: true,
      } as never);
    mockedUserAppService.updateByUid.mockResolvedValue({} as never);
    mockedLoyaltyEngine.applySocialSignupBonus.mockResolvedValue(null as never);

    const req = {
      user: { uid: "uid-123" },
      body: {
        nombre: "Juan Perez",
        telefono: "4771234567",
        fechaNacimiento: "2000-04-15",
        genero: "M",
      },
    } as unknown as Parameters<typeof completarPerfil>[0];
    const res = createMockResponse() as unknown as Parameters<
      typeof completarPerfil
    >[1];

    await completarPerfil(req, res);

    expect((res as any).json).toHaveBeenCalledWith(
      expect.objectContaining({
        bonoOtorgado: false,
        puntosBonificados: 0,
      }),
    );
  });

  it("completarPerfil responde 400 si faltan campos", async () => {
    mockedUserAppService.getUserByUid.mockResolvedValue({
      id: "user-1",
      uid: "uid-123",
      provider: "apple",
      perfilCompleto: false,
    } as never);

    const req = {
      user: { uid: "uid-123" },
      body: {
        nombre: "Juan",
        telefono: "",
        fechaNacimiento: "",
        genero: "",
      },
    } as unknown as Parameters<typeof completarPerfil>[0];
    const res = createMockResponse() as unknown as Parameters<
      typeof completarPerfil
    >[1];

    await completarPerfil(req, res);

    expect(mockedUserAppService.updateByUid).not.toHaveBeenCalled();
    expect((res as any).status).toHaveBeenCalledWith(400);
  });

  it("completarDatosPerfil otorga 15 pts solo a email via loyalty engine", async () => {
    mockedUserAppService.getUserByUid
      .mockResolvedValueOnce({
        id: "user-1",
        uid: "uid-123",
        provider: "email",
        nombre: "Ana",
        telefono: "",
        genero: "",
      } as never)
      .mockResolvedValueOnce({
        id: "user-1",
        uid: "uid-123",
        provider: "email",
        nombre: "Ana",
        telefono: "4771234567",
        genero: "femenino",
        bonoPerfilCompletadoAt: { seconds: 1 },
        puntosActuales: 55,
      } as never);

    mockedUserAppService.updateByUid.mockResolvedValue({} as never);
    mockedLoyaltyEngine.applyProfileCompletionBonus.mockResolvedValue(
      {} as never,
    );

    const req = {
      user: { uid: "uid-123" },
      body: {
        telefono: "4771234567",
        fechaNacimiento: "1998-02-10",
        genero: "F",
      },
    } as unknown as Parameters<typeof completarDatosPerfil>[0];
    const res = createMockResponse() as unknown as Parameters<
      typeof completarDatosPerfil
    >[1];

    await completarDatosPerfil(req, res);

    expect(mockedLoyaltyEngine.applyProfileCompletionBonus).toHaveBeenCalledWith(
      "uid-123",
    );
    expect(mockedPointsService.addPoints).not.toHaveBeenCalled();
    expect((res as any).status).toHaveBeenCalledWith(200);
    expect((res as any).json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        bonoOtorgado: true,
        puntosBonificados: 15,
      }),
    );
  });

  it("completarDatosPerfil rechaza google/apple", async () => {
    mockedUserAppService.getUserByUid.mockResolvedValue({
      id: "user-1",
      uid: "uid-123",
      provider: "google",
    } as never);

    const req = {
      user: { uid: "uid-123" },
      body: {
        telefono: "4771234567",
        fechaNacimiento: "1998-02-10",
        genero: "M",
      },
    } as unknown as Parameters<typeof completarDatosPerfil>[0];
    const res = createMockResponse() as unknown as Parameters<
      typeof completarDatosPerfil
    >[1];

    await completarDatosPerfil(req, res);

    expect(mockedLoyaltyEngine.applyProfileCompletionBonus).not.toHaveBeenCalled();
    expect((res as any).status).toHaveBeenCalledWith(403);
  });

  it("completarDatosPerfil es idempotente si ya reclamo el bono", async () => {
    mockedUserAppService.getUserByUid
      .mockResolvedValueOnce({
        id: "user-1",
        uid: "uid-123",
        provider: "email",
        bonoPerfilCompletadoAt: { seconds: 99 },
      } as never)
      .mockResolvedValueOnce({
        id: "user-1",
        uid: "uid-123",
        provider: "email",
        bonoPerfilCompletadoAt: { seconds: 99 },
        puntosActuales: 70,
      } as never);

    mockedUserAppService.updateByUid.mockResolvedValue({} as never);

    const req = {
      user: { uid: "uid-123" },
      body: {
        telefono: "4771234567",
        fechaNacimiento: "1998-02-10",
        genero: "otro",
      },
    } as unknown as Parameters<typeof completarDatosPerfil>[0];
    const res = createMockResponse() as unknown as Parameters<
      typeof completarDatosPerfil
    >[1];

    await completarDatosPerfil(req, res);

    expect(mockedLoyaltyEngine.applyProfileCompletionBonus).not.toHaveBeenCalled();
    expect((res as any).json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        bonoOtorgado: false,
        puntosBonificados: 0,
      }),
    );
  });
});
