const validateAddressMock = jest.fn();

jest.mock("../src/modules/shipping/fedex/fedex-address.service", () => ({
  __esModule: true,
  fedexAddressService: {
    validateAddress: validateAddressMock,
  },
}));

import { Request, Response } from "express";
import { FedexProviderError } from "../src/modules/shipping/fedex/fedex.errors";
import { validateFedexAddress } from "../src/modules/shipping/shipping.controller";

const buildResponse = () => {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  return res as unknown as Response;
};

describe("shipping.controller FedEx address validation", () => {
  beforeEach(() => {
    validateAddressMock.mockReset();
  });

  it("returns controlled FedEx errors without raw payloads or secrets", async () => {
    validateAddressMock.mockRejectedValue(
      new FedexProviderError({
        provider: "FEDEX",
        status: 400,
        message: "Invalid address",
      }),
    );
    const req = { body: {} } as Request;
    const res = buildResponse();

    await validateFedexAddress(req, res);

    expect(res.status).toHaveBeenCalledWith(502);
    expect(res.json).toHaveBeenCalledWith({
      ok: false,
      provider: "FEDEX",
      message: "No fue posible validar la dirección con FedEx",
      details: "Invalid address",
    });
    expect(JSON.stringify((res.json as jest.Mock).mock.calls[0][0])).not.toContain(
      "client-secret",
    );
  });
});
