const validateAddressMock = jest.fn();

class MockFedexAddressValidationError extends Error {
  provider: "FEDEX" = "FEDEX";
  code: string;
  statusCode: number;

  constructor(code: string, message: string, statusCode = 400) {
    super(message);
    this.name = "FedexAddressValidationError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

jest.mock("../src/modules/shipping/fedex/fedex-address-validation.service", () => ({
  __esModule: true,
  fedexAddressValidationService: {
    validateAddress: validateAddressMock,
  },
  FedexAddressValidationError: MockFedexAddressValidationError,
}));

import { Request, Response } from "express";
import { validateFedexAddress } from "../src/modules/shipping/shipping.controller";

const buildResponse = () => {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  return res as unknown as Response;
};

describe("shipping.controller FedEx public address validation", () => {
  beforeEach(() => {
    validateAddressMock.mockReset();
  });

  it("returns normalized address validation data", async () => {
    validateAddressMock.mockResolvedValue({
      success: true,
      transactionId: "tx-123",
      addresses: [
        {
          inputIndex: 0,
          isResolved: true,
          isStandardized: true,
          isInterpolatedStreetAddress: false,
          isLikelyValid: true,
          classification: "UNKNOWN",
          streetLines: ["BLVD ADOLFO LOPEZ MATEOS 1810"],
          city: "LEON",
          stateOrProvinceCode: "GTO",
          postalCode: "37500",
          countryCode: "MX",
          customerMessages: [],
          alerts: [],
          attributes: {},
        },
      ],
      alerts: [],
    });
    const req = {
      body: {
        streetLines: ["Blvd Adolfo Lopez Mateos 1810"],
        city: "Leon",
        stateOrProvinceCode: "GTO",
        postalCode: "37500",
        countryCode: "MX",
      },
    } as Request;
    const res = buildResponse();

    await validateFedexAddress(req, res);

    expect(validateAddressMock).toHaveBeenCalledWith(req.body);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: {
        success: true,
        transactionId: "tx-123",
        addresses: [
          expect.objectContaining({
            inputIndex: 0,
            isResolved: true,
            isStandardized: true,
            isLikelyValid: true,
            postalCode: "37500",
          }),
        ],
        alerts: [],
      },
    });
  });

  it.each([
    [400, "FEDEX_ADDRESS_INPUT_ERROR"],
    [401, "FEDEX_AUTH_FAILED"],
    [403, "FEDEX_FORBIDDEN"],
    [404, "FEDEX_NOT_FOUND"],
    [422, "FEDEX_ADDRESS_UNPROCESSABLE"],
    [429, "FEDEX_RATE_LIMITED"],
    [500, "FEDEX_SERVICE_UNAVAILABLE"],
    [503, "FEDEX_SERVICE_UNAVAILABLE"],
  ])("returns safe controlled error for %s", async (statusCode, code) => {
    validateAddressMock.mockRejectedValue(
      new MockFedexAddressValidationError(
        code,
        "safe FedEx address message",
        statusCode,
      ),
    );
    const req = { body: {} } as Request;
    const res = buildResponse();

    await validateFedexAddress(req, res);

    expect(res.status).toHaveBeenCalledWith(statusCode);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      code,
      message: "safe FedEx address message",
    });
    const output = JSON.stringify((res.json as jest.Mock).mock.calls[0][0]);
    expect(output).not.toContain("client-secret");
    expect(output).not.toContain("Authorization");
    expect(output).not.toContain("740561073");
  });

  it("hides unexpected errors behind a generic response", async () => {
    validateAddressMock.mockRejectedValue(
      new Error("client-secret raw provider payload"),
    );
    const req = { body: {} } as Request;
    const res = buildResponse();

    await validateFedexAddress(req, res);

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
