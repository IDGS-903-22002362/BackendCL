import { describe, expect, it } from "@jest/globals";
import LoyaltyProblemError from "../src/modules/loyalty/errors/loyalty-problem.error";
import { LOYALTY_PROBLEM_BASE_URI } from "../src/modules/loyalty/constants/loyalty.constants";

describe("LoyaltyProblemError RFC7807", () => {
  it("expone type, title, status y detail", () => {
    const error = new LoyaltyProblemError("INSUFFICIENT_POINTS");
    expect(error.type).toBe(`${LOYALTY_PROBLEM_BASE_URI}/insufficient-points`);
    expect(error.title).toBe("Puntos insuficientes");
    expect(error.status).toBe(409);
    expect(error.message).toBe(
      "El monedero no tiene puntos suficientes para completar la operacion.",
    );
  });

  it("serializa application/problem+json con campos RFC7807", () => {
    const error = new LoyaltyProblemError("INVALID_AMOUNT", "Monto no valido");
    const body = error.toProblemJson("/api/loyalty/v1/earn-transactions");

    expect(body).toEqual({
      type: `${LOYALTY_PROBLEM_BASE_URI}/invalid-amount`,
      title: "Monto o puntos invalidos",
      status: 400,
      detail: "Monto no valido",
      code: "INVALID_AMOUNT",
      instance: "/api/loyalty/v1/earn-transactions",
    });
  });

  it("omite instance cuando no se proporciona", () => {
    const error = new LoyaltyProblemError("FORBIDDEN");
    const body = error.toProblemJson();
    expect(body.instance).toBeUndefined();
    expect(body.code).toBe("FORBIDDEN");
  });
});
