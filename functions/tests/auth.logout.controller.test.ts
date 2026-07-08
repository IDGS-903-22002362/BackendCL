import { logout, logoutAllSessions } from "../src/controllers/users/auth.logout.controller";
import { authAppOficial } from "../src/config/app.firebase";

jest.mock("../src/config/app.firebase", () => ({
  authAppOficial: {
    revokeRefreshTokens: jest.fn(),
  },
}));

function createResponse() {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };

  return res;
}

describe("auth logout controller", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("does not revoke Firebase refresh tokens on normal logout", async () => {
    const req = { user: { uid: "user_123456789" } };
    const res = createResponse();

    await logout(req as any, res as any);

    expect(authAppOficial.revokeRefreshTokens).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      message: "Sesion local cerrada correctamente",
    });
  });

  it("revokes Firebase refresh tokens only for explicit logout-all", async () => {
    const req = { user: { uid: "user_123456789" } };
    const res = createResponse();

    await logoutAllSessions(req as any, res as any);

    expect(authAppOficial.revokeRefreshTokens).toHaveBeenCalledWith(
      "user_123456789",
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      message: "Todas las sesiones fueron revocadas correctamente",
    });
  });
});
