const retrieveMock = jest.fn();

class MockFedexServiceAvailabilityError extends Error {
  provider: "FEDEX" = "FEDEX";
  code: string;
  statusCode: number;

  constructor(code: string, message: string, statusCode = 400) {
    super(message);
    this.name = "FedexServiceAvailabilityError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

jest.mock("../src/modules/shipping/fedex/fedex-service-availability.service", () => ({
  __esModule: true,
  fedexServiceAvailabilityService: {
    retrieveServicesAndTransitTimes: retrieveMock,
  },
  FedexServiceAvailabilityError: MockFedexServiceAvailabilityError,
}));

import { Request, Response } from "express";
import { retrieveFedexServicesAndTransitTimes } from "../src/modules/shipping/shipping.controller";

const buildResponse = () => {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  return res as unknown as Response;
};

describe("shipping.controller FedEx service availability", () => {
  beforeEach(() => {
    retrieveMock.mockReset();
  });

  it("returns normalized availability data", async () => {
    retrieveMock.mockResolvedValue({
      success: true,
      transactionId: "tx-123",
      services: [
        {
          provider: "FEDEX",
          serviceType: "FEDEX_EXPRESS_SAVER",
          specialServices: [],
          signatureOptions: [],
          returnShipmentTypes: [],
          rawKeys: ["serviceType"],
        },
      ],
      alerts: [],
    });
    const req = { body: { recipient: {}, packages: [] } } as Request;
    const res = buildResponse();

    await retrieveFedexServicesAndTransitTimes(req, res);

    expect(retrieveMock).toHaveBeenCalledWith(req.body);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: {
        success: true,
        transactionId: "tx-123",
        services: [
          {
            provider: "FEDEX",
            serviceType: "FEDEX_EXPRESS_SAVER",
            specialServices: [],
            signatureOptions: [],
            returnShipmentTypes: [],
            rawKeys: ["serviceType"],
          },
        ],
        alerts: [],
      },
    });
  });

  it.each([
    [400, "FEDEX_AVAILABILITY_BAD_REQUEST"],
    [401, "FEDEX_AUTH_FAILED"],
    [403, "FEDEX_FORBIDDEN"],
    [404, "FEDEX_NOT_FOUND"],
    [422, "FEDEX_AVAILABILITY_NO_SERVICES"],
    [429, "FEDEX_RATE_LIMITED"],
    [500, "FEDEX_SERVICE_UNAVAILABLE"],
    [503, "FEDEX_SERVICE_UNAVAILABLE"],
  ])("returns safe controlled error for %s", async (statusCode, code) => {
    retrieveMock.mockRejectedValue(
      new MockFedexServiceAvailabilityError(
        code,
        "safe availability message",
        statusCode,
      ),
    );
    const req = { body: {} } as Request;
    const res = buildResponse();

    await retrieveFedexServicesAndTransitTimes(req, res);

    expect(res.status).toHaveBeenCalledWith(statusCode);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      code,
      message: "safe availability message",
    });
    const output = JSON.stringify((res.json as jest.Mock).mock.calls[0][0]);
    expect(output).not.toContain("Authorization");
    expect(output).not.toContain("client-secret");
    expect(output).not.toContain("740561073");
  });
});
