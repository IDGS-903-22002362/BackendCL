import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { RolUsuario } from "../src/models/usuario.model";

const getUser = jest.fn<any>();
const getWallet = jest.fn<any>();

jest.mock("../src/config/app.firebase", () => ({
  firestoreApp: {
    collection: () => ({ doc: () => ({ get: (...args: unknown[]) => getUser(...args) }) }),
  },
}));

jest.mock("../src/modules/loyalty/services/loyalty-engine.service", () => ({
  __esModule: true,
  default: { getWallet: (...args: unknown[]) => getWallet(...args) },
}));

import { getQrMemberSummary } from "../src/modules/loyalty/controllers/loyalty.controller";

function response() {
  const res = { status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  return res;
}

describe("staff QR member summary", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it("returns only name, id and current points for a CLIENTE", async () => {
    getUser.mockResolvedValue({
      exists: true,
      data: () => ({ rol: RolUsuario.CLIENTE, nombre: "Ana León", email: "private@example.com", telefono: "477" }),
    });
    getWallet.mockResolvedValue({ availablePoints: 145 });
    const res = response();
    const next = jest.fn();

    await getQrMemberSummary({ params: { memberId: "client_1" } } as never, res as never, next);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      member: { memberId: "client_1", fullName: "Ana León", currentPoints: 145 },
    });
    expect(JSON.stringify(res.json.mock.calls[0][0])).not.toMatch(/email|telefono|rol/);
  });

  it("rejects a non-client with the same safe error as an unknown QR", async () => {
    getUser.mockResolvedValue({ exists: true, data: () => ({ rol: RolUsuario.ADMIN, nombre: "Interno" }) });
    const next = jest.fn();
    await getQrMemberSummary({ params: { memberId: "admin_1" } } as never, response() as never, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: "MEMBER_NOT_FOUND" }));
    expect(getWallet).not.toHaveBeenCalled();
  });
});
