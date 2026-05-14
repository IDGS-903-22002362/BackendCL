const quoteRatesMock = jest.fn();

jest.mock("../src/modules/shipping/fedex/fedex-rates.service", () => {
  class FedexRatesUnavailableError extends Error {
    statusCode = 422;

    constructor() {
      super("No FedEx rates available for this shipment");
    }
  }

  return {
    __esModule: true,
    fedexRatesService: {
      quoteRates: quoteRatesMock,
    },
    FedexRatesUnavailableError,
  };
});

import { Request, Response } from "express";
import { FedexProviderError } from "../src/modules/shipping/fedex/fedex.errors";
import { quoteFedexRates } from "../src/modules/shipping/shipping.controller";

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

    expect(res.status).toHaveBeenCalledWith(502);
    expect(res.json).toHaveBeenCalledWith({
      ok: false,
      provider: "FEDEX",
      message: "No fue posible cotizar el envío con FedEx",
      details: "Invalid destination",
    });
    expect(JSON.stringify((res.json as jest.Mock).mock.calls[0][0])).not.toContain(
      "client-secret",
    );
  });
});
