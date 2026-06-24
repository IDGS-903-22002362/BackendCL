import { RolUsuario } from "../src/models/usuario.model";
import { requireAdmin } from "../src/utils/middlewares";
import { Request, Response, NextFunction } from "express";

describe("requireAdmin inventario", () => {
  function runMiddleware(user: Record<string, unknown> | undefined) {
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

  it("permite EMPLEADO con claim admin", async () => {
    const { req, res, next } = runMiddleware({
      uid: "empleado-1",
      rol: RolUsuario.EMPLEADO,
      admin: true,
    });

    await requireAdmin(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
  });

  it("deniega CLIENTE", async () => {
    const { req, res, next } = runMiddleware({
      uid: "cliente-1",
      rol: RolUsuario.CLIENTE,
      admin: false,
    });

    await requireAdmin(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });
});
