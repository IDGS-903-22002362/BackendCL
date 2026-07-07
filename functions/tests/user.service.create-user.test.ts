import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { RolUsuario } from "../src/models/usuario.model";

const mockGetUserByEmail = jest.fn<any>();
const mockCreateUser = jest.fn<any>();
const mockDeleteUser = jest.fn<any>();
const mockExistsGet = jest.fn<any>();
const mockDocCreate = jest.fn<any>();
const mockOtorgarBono = jest.fn<any>();
const mockSyncClaims = jest.fn<any>();

jest.mock("../src/config/app.firebase", () => ({
  authAppOficial: {
    getUserByEmail: (...args: unknown[]) => mockGetUserByEmail(...args),
    createUser: (...args: unknown[]) => mockCreateUser(...args),
    deleteUser: (...args: unknown[]) => mockDeleteUser(...args),
  },
  firestoreApp: {
    collection: jest.fn(() => ({
      where: jest.fn(() => ({
        limit: jest.fn(() => ({
          get: (...args: unknown[]) => mockExistsGet(...args),
        })),
      })),
      doc: jest.fn(() => ({
        create: (...args: unknown[]) => mockDocCreate(...args),
      })),
    })),
  },
}));

jest.mock("../src/utils/middlewares", () => ({
  syncFirebaseAdminClaims: (...args: unknown[]) => mockSyncClaims(...args),
}));

jest.mock("../src/services/puntos.service", () => ({
  __esModule: true,
  default: {
    otorgarBonoBienvenida: (...args: unknown[]) => mockOtorgarBono(...args),
  },
}));

jest.mock("../src/config/firebase.admin", () => ({
  admin: {
    firestore: {
      Timestamp: {
        now: jest.fn(() => ({ seconds: 1 })),
      },
    },
  },
}));

import userAppService from "../src/services/user.service";

describe("UserAppService.createUser", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockExistsGet.mockResolvedValue({ empty: true });
    mockGetUserByEmail.mockRejectedValue({ code: "auth/user-not-found" });
    mockCreateUser.mockResolvedValue({ uid: "new-user-1" });
    mockDocCreate.mockResolvedValue(undefined);
    mockOtorgarBono.mockResolvedValue({
      id: "new-user-1",
      uid: "new-user-1",
      email: "empleado@test.com",
      rol: RolUsuario.EMPLEADO,
    });
    mockSyncClaims.mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("crea Auth en authAppOficial y sincroniza claims para EMPLEADO", async () => {
    const result = await userAppService.createUser({
      nombre: "Empleado Test",
      email: "empleado@test.com",
      password: "Password123!",
      rol: RolUsuario.EMPLEADO,
    } as never);

    expect(mockCreateUser).toHaveBeenCalledWith({
      email: "empleado@test.com",
      password: "Password123!",
      displayName: "Empleado Test",
    });
    expect(mockDocCreate).toHaveBeenCalled();
    expect(mockSyncClaims).toHaveBeenCalledWith("new-user-1", RolUsuario.EMPLEADO);
    expect(mockOtorgarBono).toHaveBeenCalledWith("new-user-1");
    expect(result.uid).toBe("new-user-1");
  });

  it("rechaza email duplicado antes de crear Auth", async () => {
    mockExistsGet.mockResolvedValue({ empty: false });

    await expect(
      userAppService.createUser({
        nombre: "Duplicado",
        email: "duplicado@test.com",
        password: "Password123!",
        rol: RolUsuario.CLIENTE,
      } as never),
    ).rejects.toThrow("El correo electrónico ya está registrado");

    expect(mockCreateUser).not.toHaveBeenCalled();
  });

  it("hace rollback en Auth si Firestore falla", async () => {
    mockDocCreate.mockRejectedValue(new Error("firestore unavailable"));

    await expect(
      userAppService.createUser({
        nombre: "Rollback",
        email: "rollback@test.com",
        password: "Password123!",
        rol: RolUsuario.ADMIN,
      } as never),
    ).rejects.toThrow("firestore unavailable");

    expect(mockDeleteUser).toHaveBeenCalledWith("new-user-1");
  });
});