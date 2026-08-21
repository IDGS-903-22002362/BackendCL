jest.mock("../src/config/app.firebase", () => ({
  firestoreApp: { collection: jest.fn() },
  authAppOficial: { verifyIdToken: jest.fn() },
}));

jest.mock("../src/config/firebase.admin", () => ({
  admin: {
    firestore: {
      Timestamp: { now: jest.fn(() => ({ seconds: 1, nanoseconds: 0 })) },
    },
  },
}));

jest.mock("../src/utils/middlewares", () => ({
  isAdminRole: jest.fn(() => false),
  syncFirebaseAdminClaims: jest.fn(),
}));

jest.mock("../src/services/puntos.service", () => ({
  __esModule: true,
  default: { otorgarBonoBienvenida: jest.fn() },
}));

jest.mock("jsonwebtoken", () => ({
  sign: jest.fn(() => "signed-jwt"),
}));

import { registerOrLogin } from "../src/controllers/users/auth.social.controller";
import { authAppOficial, firestoreApp } from "../src/config/app.firebase";

const mockedFirestore = firestoreApp as unknown as { collection: jest.Mock };
const mockedAuth = authAppOficial as unknown as { verifyIdToken: jest.Mock };

const docUpdate = jest.fn();

function createResponse() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
}

function createRequest() {
  return {
    headers: { authorization: "Bearer firebase-id-token" },
    body: {},
    originalUrl: "/api/auth/register-or-login",
  };
}

function mockStoredUser(data: Record<string, unknown> | null) {
  mockedFirestore.collection.mockReturnValue({
    doc: jest.fn(() => ({
      get: jest.fn().mockResolvedValue({
        exists: data !== null,
        id: "user_123456789",
        data: () => data ?? undefined,
      }),
      update: docUpdate,
      create: jest.fn(),
    })),
  });
}

describe("registerOrLogin provider resolution", () => {
  const originalSecret = process.env.JWT_SECRET;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.JWT_SECRET = "test-secret";
    jest.spyOn(console, "info").mockImplementation(() => undefined);
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    docUpdate.mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.env.JWT_SECRET = originalSecret;
  });

  it("acepta sesiones abiertas con custom token reusando el provider guardado", async () => {
    mockedAuth.verifyIdToken.mockResolvedValue({
      uid: "user_123456789",
      email: "fan@clubleon.mx",
      name: "FAN ID",
      firebase: { sign_in_provider: "custom" },
    });
    mockStoredUser({
      uid: "user_123456789",
      provider: "email",
      nombre: "FAN ID",
      email: "fan@clubleon.mx",
      rol: "CLIENTE",
      bonoBienvenidaOtorgadoAt: { seconds: 1, nanoseconds: 0 },
    });

    const res = createResponse();
    await registerOrLogin(createRequest() as any, res as any);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, token: "signed-jwt" }),
    );
  });

  it("rechaza un provider desconocido sin usuario registrado", async () => {
    mockedAuth.verifyIdToken.mockResolvedValue({
      uid: "user_123456789",
      email: "fan@clubleon.mx",
      firebase: { sign_in_provider: "custom" },
    });
    mockStoredUser(null);

    const res = createResponse();
    await registerOrLogin(createRequest() as any, res as any);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: "Provider no soportado: custom",
    });
  });

  it("sigue rechazando providers no soportados aunque exista el usuario", async () => {
    mockedAuth.verifyIdToken.mockResolvedValue({
      uid: "user_123456789",
      email: "fan@clubleon.mx",
      firebase: { sign_in_provider: "facebook.com" },
    });
    mockStoredUser({
      uid: "user_123456789",
      provider: "proveedor-invalido",
      email: "fan@clubleon.mx",
      rol: "CLIENTE",
    });

    const res = createResponse();
    await registerOrLogin(createRequest() as any, res as any);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: "Provider no soportado: facebook.com",
    });
  });
});
