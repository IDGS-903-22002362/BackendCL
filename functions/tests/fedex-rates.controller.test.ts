const quoteRatesMock = jest.fn();
const quotePublicRatesMock = jest.fn();

jest.mock("../src/modules/shipping/fedex/fedex-rates.service", () => {
  class FedexRatesUnavailableError extends Error {
    statusCode = 422;

    constructor() {
      super("No FedEx rates available for this shipment");
    }
  }
  class FedexPublicRateError extends Error {
    provider = "FEDEX";
    code: string;
    statusCode: number;

    constructor(code: string, message: string, statusCode = 400) {
      super(message);
      this.name = "FedexPublicRateError";
      this.code = code;
      this.statusCode = statusCode;
    }
  }

  return {
    __esModule: true,
    fedexRatesService: {
      quoteRates: quoteRatesMock,
      quotePublicRates: quotePublicRatesMock,
    },
    FedexRatesUnavailableError,
    FedexPublicRateError,
  };
});

import { Request, Response } from "express";
import { FedexProviderError } from "../src/modules/shipping/fedex/fedex.errors";
import {
  quoteFedexPublicRates,
  quoteFedexRates,
} from "../src/modules/shipping/shipping.controller";

const buildResponse = () => {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  return res as unknown as Response;
};

describe("shipping.controller FedEx rates", () => {
  beforeEach(() => {
    quoteRatesMock.mockReset();
    quotePublicRatesMock.mockReset();
  });

  it("returns controlled FedEx errors without raw payloads or secrets", async () => {
    quoteRatesMock.mockRejectedValue(
      new FedexProviderError({
        provider: "FEDEX",
        status: 400,
        message: "Invalid destination",
      }),
    );
    const req = { body: {} } as Request;
    const res = buildResponse();

    await quoteFedexRates(req, res);

    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.json).toHaveBeenCalledWith({
      ok: false,
      provider: "FEDEX",
      message: "Invalid destination",
      details: "Invalid destination",
    });
    expect(JSON.stringify((res.json as jest.Mock).mock.calls[0][0])).not.toContain(
      "client-secret",
    );
  });

  it("returns normalized public rate data", async () => {
    quotePublicRatesMock.mockResolvedValue({
      success: true,
      transactionId: "tx-123",
      currency: "MXN",
      quotes: [
        {
          provider: "FEDEX",
          serviceType: "FEDEX_EXPRESS_SAVER",
          currency: "MXN",
          amount: 180.5,
          rateType: "ACCOUNT",
          rawRateTypes: ["ACCOUNT", "LIST"],
        },
      ],
      alerts: [],
    });
    const req = { body: { recipient: {}, packages: [] } } as Request;
    const res = buildResponse();

    await quoteFedexPublicRates(req, res);

    expect(quotePublicRatesMock).toHaveBeenCalledWith(req.body);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: {
        success: true,
        transactionId: "tx-123",
        currency: "MXN",
        quotes: [
          {
            provider: "FEDEX",
            serviceType: "FEDEX_EXPRESS_SAVER",
            currency: "MXN",
            amount: 180.5,
            rateType: "ACCOUNT",
            rawRateTypes: ["ACCOUNT", "LIST"],
          },
        ],
        alerts: [],
      },
    });
  });

  it.each([
    [400, "FEDEX_RATE_BAD_REQUEST"],
    [401, "FEDEX_AUTH_FAILED"],
    [403, "FEDEX_FORBIDDEN"],
    [404, "FEDEX_NOT_FOUND"],
    [422, "FEDEX_RATE_UNAVAILABLE"],
    [429, "FEDEX_RATE_LIMITED"],
    [500, "FEDEX_SERVICE_UNAVAILABLE"],
    [503, "FEDEX_SERVICE_UNAVAILABLE"],
  ])("returns safe public rate error for %s", async (statusCode, code) => {
    const { FedexPublicRateError } = jest.requireMock(
      "../src/modules/shipping/fedex/fedex-rates.service",
    );
    quotePublicRatesMock.mockRejectedValue(
      new FedexPublicRateError(code, "safe public rate message", statusCode),
    );
    const req = { body: {} } as Request;
    const res = buildResponse();

    await quoteFedexPublicRates(req, res);

    expect(res.status).toHaveBeenCalledWith(statusCode);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      code,
      message: "safe public rate message",
    });
    const output = JSON.stringify((res.json as jest.Mock).mock.calls[0][0]);
    expect(output).not.toContain("client-secret");
    expect(output).not.toContain("Authorization");
    expect(output).not.toContain("740561073");
  });
});
