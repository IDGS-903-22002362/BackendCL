import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import jwt from "jsonwebtoken";

const get = jest.fn();
const doc = jest.fn(() => ({ get }));

jest.mock("../src/config/app.firebase", () => ({
  firestoreApp: {
    collection: () => ({ doc }),
  },
  authAppOficial: {},
}));

jest.mock("../src/config/firebase.admin", () => ({
  admin: {},
}));

import { optionalAuthWithUserMiddleware } from "../src/utils/middlewares";

const secret = "test-secret";

function tokenFor(uid: string): string {
  return jwt.sign(
    { uid, email: "a@club.com", rol: "CLIENTE", nombre: "Ana" },
    secret,
  );
}

async function run(authorization?: string) {
  const req = {
    headers: authorization ? { authorization } : {},
    originalUrl: "/api/beneficios",
  } as Parameters<typeof optionalAuthWithUserMiddleware>[0];
  const next = jest.fn();
  await optionalAuthWithUserMiddleware(req, {} as never, next);
  return { req, next };
}

describe("catalogo de beneficios y sesion", () => {
  beforeEach(() => {
    process.env.JWT_SECRET = secret;
    get.mockReset();
    doc.mockClear();
  });

  it("sigue anonimo sin token", async () => {
    const { req, next } = await run();
    expect(next).toHaveBeenCalled();
    expect(req.user).toBeUndefined();
    expect(doc).not.toHaveBeenCalled();
  });

  it("sigue anonimo con un token invalido", async () => {
    const { req, next } = await run("Bearer no-es-un-jwt");
    expect(next).toHaveBeenCalled();
    expect(req.user).toBeUndefined();
    expect(doc).not.toHaveBeenCalled();
  });

  it("usa el id del documento y niega si el campo uid no coincide", async () => {
    get.mockImplementation(async () => ({
      exists: true,
      id: "uid-a",
      data: () => ({ uid: "otro-campo", email: "a@club.com", rol: "CLIENTE" }),
    }));

    const denied = await run(`Bearer ${tokenFor("uid-a")}`);
    expect(doc).toHaveBeenCalled();
    expect((doc as unknown as jest.Mock).mock.calls[0]?.[0]).toBe("uid-a");
    expect(denied.req.user).toBeUndefined();
    expect(denied.next).toHaveBeenCalled();

    get.mockImplementation(async () => ({
      exists: true,
      id: "uid-a",
      data: () => ({
        uid: "uid-a",
        email: "a@club.com",
        rol: "CLIENTE",
        nombre: "Ana",
      }),
    }));

    const allowed = await run(`Bearer ${tokenFor("uid-a")}`);
    expect(allowed.req.user?.uid).toBe("uid-a");
  });
});