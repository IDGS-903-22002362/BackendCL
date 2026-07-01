import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { RolUsuario } from "../src/models/usuario.model";

const mockGetWallet = jest.fn<any>();
const mockApplyAdjustment = jest.fn<any>();
const mockEarnFromSale = jest.fn<any>();
const mockListByMember = jest.fn<any>();
const mockListAdmin = jest.fn<any>();

jest.mock("../src/modules/loyalty/services/loyalty-engine.service", () => ({
  __esModule: true,
  default: {
    getWallet: (...args: unknown[]) => mockGetWallet(...args),
    applyAdjustment: (...args: unknown[]) => mockApplyAdjustment(...args),
    earnFromSale: (...args: unknown[]) => mockEarnFromSale(...args),
  },
}));

jest.mock("../src/modules/loyalty/repositories/ledger.repository", () => ({
  __esModule: true,
  default: {
    listByMember: (...args: unknown[]) => mockListByMember(...args),
    listAdmin: (...args: unknown[]) => mockListAdmin(...args),
    toResponseDto: (t: { transactionId: string }) => t,
  },
}));

jest.mock("../src/modules/loyalty/services/loyalty-feature-flags.service", () => ({
  requireLegacyAdapters: jest.fn<any>().mockResolvedValue(undefined),
}));

import {
  legacyAssignPoints,
  legacyAssignPointsBySale,
  legacyGetAsignaciones,
  legacyGetMyHistorial,
  legacyGetMyPoints,
} from "../src/modules/loyalty/services/legacy-adapter.service";

const createRes = () => {
  const headers: Record<string, string> = {};
  const res = {
    set: jest.fn((k: string, v: string) => {
      headers[k] = v;
      return res;
    }),
    status: jest.fn(),
    json: jest.fn(),
  } as {
    set: jest.Mock;
    status: jest.Mock;
    json: jest.Mock;
  };
  res.status.mockReturnValue(res);
  return { res, headers };
};

describe("legacy loyalty adapters", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it("GET /me/getpuntos responde formato legacy y headers de deprecacion", async () => {
    mockGetWallet.mockResolvedValue({
      availablePoints: 120,
      level: "Plata",
      nextExpirationAt: { toDate: () => new Date("2026-12-31T00:00:00.000Z") },
    });

    const req = {
      user: { uid: "u1", rol: RolUsuario.CLIENTE },
    } as never;
    const { res, headers } = createRes();

    await legacyGetMyPoints(req, res as never);

    expect(headers.Deprecation).toBe("true");
    expect(headers.Sunset).toBe("2026-09-30");
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, puntos: 120, nivel: "Plata" }),
    );
  });

  it("POST asignar delega al engine y no usa origenId del body", async () => {
    mockApplyAdjustment.mockResolvedValue({
      balanceAfter: 200,
      points: 50,
    });

    const req = {
      params: { id: "member_1" },
      body: { points: 50, descripcion: "Ajuste" },
      user: { uid: "admin_1", rol: RolUsuario.ADMIN },
      header: () => "idem-1",
    } as never;
    const { res } = createRes();

    await legacyAssignPoints(req, res as never);

    expect(mockApplyAdjustment).toHaveBeenCalledWith(
      expect.objectContaining({
        memberId: "member_1",
        points: 50,
        idempotencyKey: "idem-1",
        actor: expect.objectContaining({ actorId: "admin_1" }),
      }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("POST asignar-por-venta usa folio estable como idempotency", async () => {
    mockEarnFromSale.mockResolvedValue({
      points: 10,
      balanceAfter: 110,
    });

    const req = {
      params: { id: "member_1" },
      body: { dinero: 100, descripcion: "Venta tienda" },
      user: { uid: "emp_1", rol: RolUsuario.EMPLEADO },
      header: (name: string) => (name === "Idempotency-Key" ? "FOLIO-001" : undefined),
    } as never;
    const { res } = createRes();

    await legacyAssignPointsBySale(req, res as never);

    expect(mockEarnFromSale).toHaveBeenCalledWith(
      expect.objectContaining({
        externalTransactionId: "FOLIO-001",
        idempotencyKey: "FOLIO-001",
        amountCents: 10000,
      }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("GET historial devuelve movimientos desde ledger", async () => {
    mockGetWallet.mockResolvedValue({ availablePoints: 80, level: "Bronce" });
    mockListByMember.mockResolvedValue({
      items: [{ transactionId: "tx1", points: 10 }],
    });

    const req = { user: { uid: "u1", rol: RolUsuario.CLIENTE } } as never;
    const { res } = createRes();

    await legacyGetMyHistorial(req, res as never);

    expect(mockListByMember).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("GET asignaciones admin delega a ledger admin list", async () => {
    mockListAdmin.mockResolvedValue({
      items: [
        {
          transactionId: "tx1",
          memberId: "m1",
          points: 5,
          description: "Venta",
          actorId: "emp1",
          createdAt: { toDate: () => new Date("2026-01-01T00:00:00.000Z") },
        },
      ],
      nextCursor: null,
    });

    const req = {
      user: { uid: "admin1", rol: RolUsuario.ADMIN },
      query: { limit: "10" },
    } as never;
    const { res } = createRes();

    await legacyGetAsignaciones(req, res as never);

    expect(mockListAdmin).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });
});
