const createShipmentForOrderMock = jest.fn();
const createSandboxTestLabelMock = jest.fn();

jest.mock("../src/modules/shipping/fedex/fedex-ship.service", () => {
  class FedexShipError extends Error {
    statusCode: number;

    constructor(message: string, statusCode = 400) {
      super(message);
      this.statusCode = statusCode;
    }
  }

  return {
    __esModule: true,
    fedexShipService: {
      createShipmentForOrder: createShipmentForOrderMock,
      createSandboxTestLabel: createSandboxTestLabelMock,
    },
    FedexShipError,
  };
});

import { Request, Response } from "express";
import { FedexProviderError } from "../src/modules/shipping/fedex/fedex.errors";
import { createFedexShipmentForOrder } from "../src/modules/shipping/shipping.controller";

const buildResponse = () => {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  return res as unknown as Response;
};

describe("shipping.controller FedEx ship", () => {
  beforeEach(() => {
    createShipmentForOrderMock.mockReset();
    createSandboxTestLabelMock.mockReset();
  });

  it("returns controlled FedEx errors without secrets or label base64", async () => {
    createShipmentForOrderMock.mockRejectedValue(
      new FedexProviderError({
        provider: "FEDEX",
        status: 400,
        message: "Invalid shipment",
      }),
    );
    const req = {
      params: { orderId: "orden_123" },
      body: {},
    } as unknown as Request;
    const res = buildResponse();

    await createFedexShipmentForOrder(req, res);

    expect(res.status).toHaveBeenCalledWith(502);
    expect(res.json).toHaveBeenCalledWith({
      ok: false,
      provider: "FEDEX",
      message: "No fue posible generar la guía con FedEx",
      details: "Invalid shipment",
    });
    const payload = JSON.stringify((res.json as jest.Mock).mock.calls[0][0]);
    expect(payload).not.toContain("client-secret");
    expect(payload).not.toContain("JVBER");
  });
});
