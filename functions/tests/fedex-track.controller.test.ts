const trackOrderMock = jest.fn();
const trackNumbersMock = jest.fn();

jest.mock("../src/modules/shipping/fedex/fedex-track.service", () => {
  class FedexTrackError extends Error {
    statusCode: number;

    constructor(message: string, statusCode = 400) {
      super(message);
      this.statusCode = statusCode;
    }
  }

  return {
    __esModule: true,
    fedexTrackService: {
      trackOrder: trackOrderMock,
      trackNumbers: trackNumbersMock,
    },
    FedexTrackError,
  };
});

import { Request, Response } from "express";
import { FedexProviderError } from "../src/modules/shipping/fedex/fedex.errors";
import { getFedexOrderTracking } from "../src/modules/shipping/shipping.controller";

const buildResponse = () => {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  return res as unknown as Response;
};

describe("shipping.controller FedEx tracking", () => {
  beforeEach(() => {
    trackOrderMock.mockReset();
    trackNumbersMock.mockReset();
  });

  it("returns controlled FedEx errors without raw payloads or secrets", async () => {
    trackOrderMock.mockRejectedValue(
      new FedexProviderError({
        provider: "FEDEX",
        status: 400,
        message: "Invalid tracking number",
      }),
    );
    const req = {
      params: { orderId: "order_1" },
      user: { uid: "user_1" },
    } as unknown as Request;
    const res = buildResponse();

    await getFedexOrderTracking(req, res);

    expect(res.status).toHaveBeenCalledWith(502);
    expect(res.json).toHaveBeenCalledWith({
      ok: false,
      provider: "FEDEX",
      message: "No fue posible consultar el rastreo con FedEx",
      details: "Invalid tracking number",
    });
    expect(JSON.stringify((res.json as jest.Mock).mock.calls[0][0])).not.toContain(
      "client-secret",
    );
  });
});
