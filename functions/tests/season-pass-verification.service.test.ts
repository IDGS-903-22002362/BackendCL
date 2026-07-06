import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import axios from "axios";
import seasonPassVerificationService from "../src/services/season-pass-verification.service";

jest.mock("axios", () => ({
  __esModule: true,
  default: {
    post: jest.fn(),
    isAxiosError: jest.fn((error: { isAxiosError?: boolean }) =>
      error?.isAxiosError === true,
    ),
  },
}));

const mockedAxios = axios as jest.Mocked<typeof axios>;
const originalEnv = { ...process.env };

describe("seasonPassVerificationService", () => {
  beforeEach(() => {
    process.env = {
      ...originalEnv,
      BOLETOMOVIL_API_TOKEN: "test-token",
      BOLETOMOVIL_PURCHASES_URL: "https://provider.test/purchases",
      BOLETOMOVIL_TIMEOUT_MS: "5000",
    };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.clearAllMocks();
  });

  it.each([
    ["4771234567", "+524771234567"],
    ["52 477 123 4567", "+524771234567"],
    ["+52 (477) 123-4567", "+524771234567"],
  ])("normaliza formatos mexicanos equivalentes: %s", (input, expected) => {
    expect(seasonPassVerificationService.normalizePhone(input)).toBe(expected);
  });

  it("rechaza telefonos que no sean mexicanos de 10 digitos", () => {
    expect(() => seasonPassVerificationService.normalizePhone("+12125550101"))
      .toThrow("El teléfono debe tener 10 dígitos nacionales de México.");
  });

  it("normaliza telefono, filtra Fierabono AP26 y calcula puntos", async () => {
    mockedAxios.post.mockResolvedValue({
      data: {
        user: {
          name: "Martha Beatriz González Nava",
          email: "martha.gonzalez@leon.tecnm.mx",
          phone: "+524777245984",
        },
        items: [
          {
            event: "Fierabono AP26",
            purchaseID: 14950977,
            zone: "Preferente 7",
            section: "307",
            seat: "28-27",
            eventDate: "2026-08-01T00:00:00.000Z",
            season: "Apertura 2026",
            basePrice: 3300,
            isSeasonPass: 1,
          },
          {
            event: "Fierabono AP26",
            purchaseID: 14950977,
            zone: "Preferente 7",
            section: "307",
            seat: "28-29",
            eventDate: "2026-08-01T00:00:00.000Z",
            season: "Apertura 2026",
            basePrice: 3300,
            isSeasonPass: 1,
          },
          {
            event: "Partido individual",
            purchaseID: 200,
            season: "Apertura 2026",
            basePrice: 500,
            isSeasonPass: 0,
          },
        ],
      },
    });

    const result = await seasonPassVerificationService.verifyByPhone("4777245984");

    expect(mockedAxios.post).toHaveBeenCalledWith(
      "https://provider.test/purchases",
      {
        filters: { phone: "+524777245984" },
        limit: 500,
        offset: 0,
      },
      expect.objectContaining({
        timeout: 5000,
        headers: expect.objectContaining({
          Authorization: "Bearer test-token",
          "User-Agent": "leonfc",
        }),
      }),
    );
    expect(result.isSubscriber).toBe(true);
    expect(result.purchaseCount).toBe(2);
    expect(result.totalBasePrice).toBe(6600);
    expect(result.pointsAwarded).toBe(660);
    expect(result.purchaseIds).toEqual([14950977]);
  });

  it("no otorga puntos si el proveedor no confirma que el usuario pertenece al telefono", async () => {
    mockedAxios.post.mockResolvedValue({
      data: {
        user: null,
        count: 500,
        items: [
          {
            event: "Fierabono AP26",
            purchaseID: 14956796,
            season: "Apertura 2026",
            basePrice: 3300,
            isSeasonPass: 1,
          },
        ],
      },
    });

    const result = await seasonPassVerificationService.verifyByPhone("4775730149");

    expect(result.isSubscriber).toBe(false);
    expect(result.purchaseCount).toBe(0);
    expect(result.totalBasePrice).toBe(0);
    expect(result.pointsAwarded).toBe(0);
    expect(result.purchaseIds).toEqual([]);
  });
});
