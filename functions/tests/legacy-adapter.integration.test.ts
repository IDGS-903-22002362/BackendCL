import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { RolUsuario } from "../src/models/usuario.model";
import { ROLES_ASIGNACION_PUNTOS } from "../src/models/usuario.model";
import { verifyRole } from "../src/middleware/validation.middleware";

const mockGetWallet = jest.fn<any>();
const mockApplyAdjustment = jest.fn<any>();
const mockEarnFromSale = jest.fn<any>();
const mockListByMember = jest.fn<any>();
const mockListAdmin = jest.fn<any>();
const mockHistoryList = jest.fn<any>();

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

jest.mock("../src/modules/loyalty/services/staff-assignment-history.service", () => ({
  __esModule: true,
  default: {
    list: (...args: unknown[]) => mockHistoryList(...args),
  },
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

  it("bloquea clientes del historial de asignaciones", () => {
    const next = jest.fn();
    const status = jest.fn();
    const json = jest.fn();
    status.mockReturnValue({ json });

    verifyRole([...ROLES_ASIGNACION_PUNTOS])(
      { user: { uid: "client-1", rol: RolUsuario.CLIENTE } } as never,
      { status } as never,
      next,
    );

    expect(status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
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
      body: { dinero: 100, descripcion: "Venta tienda", folioVenta: " folio-001 " },
      user: { uid: "emp_1", rol: RolUsuario.EMPLEADO },
      header: (name: string) => (name === "Idempotency-Key" ? "FOLIO-001" : undefined),
    } as never;
    const { res } = createRes();

    await legacyAssignPointsBySale(req, res as never);

    expect(mockEarnFromSale).toHaveBeenCalledWith(
      expect.objectContaining({
        externalTransactionId: expect.stringMatching(/^staff-sale:[a-f0-9]{12}:[a-f0-9]{12}:FOLIO-001$/),
        idempotencyKey: expect.stringMatching(/^staff-sale:[a-f0-9]{12}:[a-f0-9]{12}:FOLIO-001$/),
        amountCents: 10000,
        locationId: "emp_1",
        metadata: { saleId: "FOLIO-001", source: "staff-qr" },
      }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("rechaza un folio igual al UID del cliente", async () => {
    const req = {
      params: { id: "member_1" },
      body: { dinero: 100, folioVenta: "MEMBER_1" },
      user: { uid: "emp_1", rol: RolUsuario.EMPLEADO },
      header: () => undefined,
    } as never;
    const { res } = createRes();

    await legacyAssignPointsBySale(req, res as never);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      message: "El folio de venta debe ser distinto del ID del cliente",
    }));
    expect(mockEarnFromSale).not.toHaveBeenCalled();
  });

  it("requiere el folio y devuelve un error claro", async () => {
    const req = {
      params: { id: "member_1" },
      body: { dinero: 100 },
      user: { uid: "emp_1", rol: RolUsuario.EMPLEADO },
      header: () => undefined,
    } as never;
    const { res } = createRes();

    await legacyAssignPointsBySale(req, res as never);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      message: "El folio de venta es requerido",
    }));
    expect(mockEarnFromSale).not.toHaveBeenCalled();
  });

  it("separa el mismo folio por tienda y cliente", async () => {
    mockEarnFromSale.mockResolvedValue({ points: 10, balanceAfter: 110 });
    const { res } = createRes();

    await legacyAssignPointsBySale({
      params: { id: "member_2" },
      body: { dinero: 100, folioVenta: "TICKET-1" },
      user: {
        uid: "emp_2",
        rol: RolUsuario.EMPLEADO,
        sucursalId: "store_2",
      },
      header: () => undefined,
    } as never, res as never);

    const input = mockEarnFromSale.mock.calls[0][0] as {
      externalTransactionId: string;
      idempotencyKey: string;
      locationId: string;
    };
    expect(input.externalTransactionId).toMatch(
      /^staff-sale:[a-f0-9]{12}:[a-f0-9]{12}:TICKET-1$/,
    );
    expect(input.idempotencyKey).toBe(input.externalTransactionId);
    expect(input.locationId).toBe("store_2");
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
    mockHistoryList.mockResolvedValue({
      items: [
        {
          transactionId: "tx1",
          memberId: "m1",
          customerFullName: "Cliente Uno",
          customerExists: true,
          saleId: "TICKET-1",
          amountMxn: 100,
          points: 5,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      nextCursor: null,
      searchWindowLimited: false,
      scannedCount: 1,
    });

    const req = {
      user: { uid: "admin1", rol: RolUsuario.ADMIN },
      query: { limit: 10, cursor: "cursor-1", search: "cliente uno" },
    } as never;
    const { res } = createRes();

    await legacyGetAsignaciones(req, res as never);

    expect(mockHistoryList).toHaveBeenCalledWith({
      actorId: "admin1",
      limit: 10,
      cursor: "cursor-1",
      search: "cliente uno",
    });
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      data: [expect.objectContaining({
        customerFullName: "Cliente Uno",
        saleId: "TICKET-1",
      })],
    }));
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("limita el historial de empleado a su propio actor", async () => {
    mockHistoryList.mockResolvedValue({
      items: [],
      searchWindowLimited: false,
      scannedCount: 0,
    });
    const { res } = createRes();

    await legacyGetAsignaciones({
      user: { uid: "emp1", rol: RolUsuario.EMPLEADO },
      query: { empleadoId: "otro-empleado", limit: 20 },
    } as never, res as never);

    expect(mockHistoryList).toHaveBeenCalledWith(expect.objectContaining({
      actorId: "emp1",
    }));
  });
});
