import { createFirebaseSessionToken } from "../src/controllers/users/auth.firebase-session.controller";
import { authAppOficial } from "../src/config/app.firebase";

jest.mock("../src/config/app.firebase", () => ({
  authAppOficial: {
    getUser: jest.fn(),
    createCustomToken: jest.fn(),
  },
}));

const mockedAuth = authAppOficial as unknown as {
  getUser: jest.Mock;
  createCustomToken: jest.Mock;
};

function createResponse() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
}

describe("auth firebase session controller", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
    jest.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("emite un custom token para el uid de la sesión", async () => {
    mockedAuth.getUser.mockResolvedValue({ uid: "user_123456789" });
    mockedAuth.createCustomToken.mockResolvedValue("custom-token-abc");

    const req = { user: { uid: "user_123456789" }, body: {} };
    const res = createResponse();

    await createFirebaseSessionToken(req as any, res as any);

    expect(mockedAuth.createCustomToken).toHaveBeenCalledWith("user_123456789");
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { customToken: "custom-token-abc", uid: "user_123456789" },
    });
  });

  it("ignora cualquier uid enviado en el body", async () => {
    mockedAuth.getUser.mockResolvedValue({ uid: "user_123456789" });
    mockedAuth.createCustomToken.mockResolvedValue("custom-token-abc");

    const req = {
      user: { uid: "user_123456789" },
      body: { uid: "otro_usuario" },
    };
    const res = createResponse();

    await createFirebaseSessionToken(req as any, res as any);

    expect(mockedAuth.getUser).toHaveBeenCalledWith("user_123456789");
    expect(mockedAuth.createCustomToken).toHaveBeenCalledWith("user_123456789");
  });

  it("responde 401 sin sesión backend", async () => {
    const req = { body: {} };
    const res = createResponse();

    await createFirebaseSessionToken(req as any, res as any);

    expect(mockedAuth.createCustomToken).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: "No autorizado. Token requerido",
      code: "AUTH_TOKEN_REQUIRED",
    });
  });

  it("responde 404 cuando el usuario no existe en Firebase Auth", async () => {
    mockedAuth.getUser.mockRejectedValue({ code: "auth/user-not-found" });

    const req = { user: { uid: "user_123456789" }, body: {} };
    const res = createResponse();

    await createFirebaseSessionToken(req as any, res as any);

    expect(mockedAuth.createCustomToken).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: "Tu cuenta no tiene credenciales de Firebase disponibles.",
      code: "FIREBASE_USER_NOT_FOUND",
    });
  });

  it("responde 500 cuando falla la emisión del token", async () => {
    mockedAuth.getUser.mockResolvedValue({ uid: "user_123456789" });
    mockedAuth.createCustomToken.mockRejectedValue(new Error("boom"));

    const req = { user: { uid: "user_123456789" }, body: {} };
    const res = createResponse();

    await createFirebaseSessionToken(req as any, res as any);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: "No fue posible iniciar tu sesión de Firebase",
    });
  });
});
