import { afterEach, describe, expect, it, jest } from "@jest/globals";

const mockApplyAdjustment = jest.fn<any>();

jest.mock("../src/modules/loyalty/services/loyalty-engine.service", () => ({
  __esModule: true,
  default: {
    applyAdjustment: (...args: unknown[]) => mockApplyAdjustment(...args),
  },
}));

jest.mock("../src/modules/loyalty/services/loyalty-feature-flags.service", () => ({
  requireLegacyAdapters: jest.fn<any>().mockResolvedValue(undefined),
}));

import { legacyAssignPoints } from "../src/modules/loyalty/services/legacy-adapter.service";

describe("legacy adapter replaces users.points.controller", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it("legacy assign delega al engine en lugar de pointsService.addPoints", async () => {
    mockApplyAdjustment.mockResolvedValue({ balanceAfter: 150, points: 50 });

    const req = {
      params: { id: "user_123" },
      body: { points: 50, descripcion: "Asignacion manual de puntos" },
      user: { uid: "admin-api", rol: "ADMIN" },
      header: () => undefined,
    } as never;

    const res = {
      set: jest.fn().mockReturnThis(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };

    await legacyAssignPoints(req, res as never);

    expect(mockApplyAdjustment).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(200);
  });
});
