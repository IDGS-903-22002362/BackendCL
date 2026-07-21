import { NextFunction, Request, Response } from "express";
import { RolUsuario } from "../src/models/usuario.model";
import { paymentCustomerMiddleware } from "../src/middleware/payments-auth.middleware";
import { requireCustomer } from "../src/utils/middlewares";

function harness(user?: { uid: string; rol: RolUsuario }) {
  const req = { user } as Request;
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) { this.statusCode = code; return this; },
    json(payload: unknown) { this.body = payload; return this; },
  } as Response & { statusCode: number; body: any };
  return { req, res, next: jest.fn() as NextFunction };
}

describe("customer-only purchase guards", () => {
  it.each([
    RolUsuario.ADMIN,
    RolUsuario.SUPER_ADMIN,
    RolUsuario.EMPLEADO,
    RolUsuario.EMPLEADO_CLUB,
    RolUsuario.CONCESION_VENDEDOR,
  ])("blocks internal role %s", (rol) => {
    const { req, res, next } = harness({ uid: "internal", rol });
    requireCustomer(req, res, next);
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe("CUSTOMER_ACCOUNT_REQUIRED");
    expect(next).not.toHaveBeenCalled();
  });

  it("allows CLIENTE", () => {
    const { req, res, next } = harness({ uid: "client", rol: RolUsuario.CLIENTE });
    requireCustomer(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("blocks a primary CLIENTE that also has an internal role", () => {
    const { req, res, next } = harness({ uid: "worker", rol: RolUsuario.CLIENTE });
    (req.user as any).roles = [RolUsuario.CLIENTE, RolUsuario.TRABAJADOR_CLUBLEON];
    requireCustomer(req, res, next);
    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("uses the payment error contract", () => {
    const { req, res, next } = harness({ uid: "admin", rol: RolUsuario.ADMIN });
    paymentCustomerMiddleware(req, res, next);
    expect(res.statusCode).toBe(403);
    expect(res.body.error.code).toBe("CUSTOMER_ACCOUNT_REQUIRED");
  });
});
