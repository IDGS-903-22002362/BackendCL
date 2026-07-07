import { RolUsuario } from "../src/models/usuario.model";
import { requireAdmin, requireStaff } from "../src/utils/middlewares";
import { Request, Response, NextFunction } from "express";

function runMiddleware(
  middleware: typeof requireAdmin,
  user: Record<string, unknown> | undefined,
) {
  const req = { user } as Request;
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  } as Response & { statusCode: number; body: unknown };
  const next = jest.fn() as NextFunction;

  return { req, res, next };
}

describe("requireStaff inventario", () => {
  it("permite EMPLEADO", async () => {
    const { req, res, next } = runMiddleware(requireStaff, {
      uid: "empleado-1",
      rol: RolUsuario.EMPLEADO,
      admin: true,
    });

    await requireStaff(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
  });

  it("deniega CLIENTE", async () => {
    const { req, res, next } = runMiddleware(requireStaff, {
      uid: "cliente-1",
      rol: RolUsuario.CLIENTE,
      admin: false,
    });

    await requireStaff(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });
});

describe("requireAdmin inventario", () => {
  it("deniega EMPLEADO", async () => {
    const { req, res, next } = runMiddleware(requireAdmin, {
      uid: "empleado-1",
      rol: RolUsuario.EMPLEADO,
      admin: true,
    });

    await requireAdmin(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  it("permite ADMIN", async () => {
    const { req, res, next } = runMiddleware(requireAdmin, {
      uid: "admin-1",
      rol: RolUsuario.ADMIN,
      admin: true,
    });

    await requireAdmin(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
  });

  it("deniega CLIENTE", async () => {
    const { req, res, next } = runMiddleware(requireAdmin, {
      uid: "cliente-1",
      rol: RolUsuario.CLIENTE,
      admin: false,
    });

    await requireAdmin(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });
});
