const validatePostalCodeMock = jest.fn();

class MockFedexPostalValidationError extends Error {
  provider: "FEDEX" = "FEDEX";
  code: string;
  statusCode: number;

  constructor(code: string, message: string, statusCode = 400) {
    super(message);
    this.name = "FedexPostalValidationError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

jest.mock("../src/modules/shipping/fedex/fedex-postal.service", () => ({
  __esModule: true,
  fedexPostalCodeService: {
    validatePostalCode: validatePostalCodeMock,
  },
  FedexPostalValidationError: MockFedexPostalValidationError,
}));

import { Request, Response } from "express";
import { validateFedexPostalCode } from "../src/modules/shipping/shipping.controller";

const buildResponse = () => {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  return res as unknown as Response;
};

describe("shipping.controller FedEx postal validation", () => {
  beforeEach(() => {
    validatePostalCodeMock.mockReset();
  });

  it("returns normalized postal validation data", async () => {
    validatePostalCodeMock.mockResolvedValue({
      isValid: true,
      carrierCode: "FDXE",
      countryCode: "MX",
      stateOrProvinceCode: "CS",
      postalCode: "30709",
      cleanedPostalCode: "30709",
      alerts: [],
      locationDescriptions: [],
      transactionId: "tx-123",
    });
    const req = {
      body: {
        carrierCode: "FDXE",
        countryCode: "MX",
        stateOrProvinceCode: "CS",
        postalCode: "30709",
      },
    } as Request;
    const res = buildResponse();

    await validateFedexPostalCode(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: {
        isValid: true,
        carrierCode: "FDXE",
        countryCode: "MX",
        stateOrProvinceCode: "CS",
        postalCode: "30709",
        cleanedPostalCode: "30709",
        alerts: [],
        locationDescriptions: [],
        transactionId: "tx-123",
      },
    });
  });

  it.each([
    [400, "FEDEX_POSTAL_BAD_REQUEST"],
    [401, "FEDEX_AUTH_FAILED"],
    [403, "FEDEX_FORBIDDEN"],
    [422, "FEDEX_POSTAL_UNPROCESSABLE"],
    [429, "FEDEX_RATE_LIMITED"],
    [500, "FEDEX_SERVICE_UNAVAILABLE"],
    [503, "FEDEX_SERVICE_UNAVAILABLE"],
  ])("returns safe controlled error for %s", async (statusCode, code) => {
    validatePostalCodeMock.mockRejectedValue(
      new MockFedexPostalValidationError(
        code,
        "safe FedEx postal message",
        statusCode,
      ),
    );
    const req = { body: {} } as Request;
    const res = buildResponse();

    await validateFedexPostalCode(req, res);

    expect(res.status).toHaveBeenCalledWith(statusCode);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      code,
      message: "safe FedEx postal message",
    });
    const output = JSON.stringify((res.json as jest.Mock).mock.calls[0][0]);
    expect(output).not.toContain("client-secret");
    expect(output).not.toContain("Authorization");
    expect(output).not.toContain("740561073");
  });

  it("hides unexpected errors behind a generic service unavailable response", async () => {
    validatePostalCodeMock.mockRejectedValue(
      new Error("client-secret raw stack trace"),
    );
    const req = { body: {} } as Request;
    const res = buildResponse();

    await validateFedexPostalCode(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      code: "FEDEX_SERVICE_UNAVAILABLE",
      message: "FedEx no esta disponible temporalmente.",
    });
    expect(JSON.stringify((res.json as jest.Mock).mock.calls[0][0])).not.toContain(
      "client-secret",
    );
  });
});
