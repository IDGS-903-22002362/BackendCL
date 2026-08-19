import { describe, expect, it } from "@jest/globals";
import {
  computeSaleTotals,
  pendingAmountMinor,
} from "../src/modules/pos/domain/sale-totals";
import {
  allocateRefund,
  lineRefundMinor,
  totalRefundableMinor,
} from "../src/modules/pos/domain/refund-allocation";
import PosProblemError from "../src/modules/pos/errors/pos-problem.error";
import {
  PosPaymentMethod,
  PosPaymentStatus,
} from "../src/modules/pos/models/pos.enums";

const line = (
  overrides: Partial<{
    itemId: string;
    quantity: number;
    unitPriceOriginalMinor: number;
    unitPriceMinor: number;
    offerDiscountMinor: number;
    codeDiscountMinor: number;
  }> = {},
) => ({
  itemId: "item-1",
  quantity: 1,
  unitPriceOriginalMinor: 10_000,
  unitPriceMinor: 10_000,
  offerDiscountMinor: 0,
  codeDiscountMinor: 0,
  ...overrides,
});

describe("POS totales de venta", () => {
  it("calcula subtotal y total sin descuentos", () => {
    const { totals } = computeSaleTotals([
      line({ itemId: "a", quantity: 2 }),
      line({ itemId: "b", unitPriceOriginalMinor: 4_999, unitPriceMinor: 4_999 }),
    ]);

    expect(totals.subtotalOriginalMinor).toBe(24_999);
    expect(totals.discountMinor).toBe(0);
    expect(totals.totalMinor).toBe(24_999);
    expect(totals.taxMinor).toBe(0);
  });

  it("acumula oferta, código y descuento manual sin duplicar", () => {
    const { totals, lines } = computeSaleTotals(
      [
        line({
          itemId: "a",
          quantity: 2,
          unitPriceOriginalMinor: 10_000,
          unitPriceMinor: 8_000,
          offerDiscountMinor: 4_000,
          codeDiscountMinor: 1_000,
        }),
        line({
          itemId: "b",
          unitPriceOriginalMinor: 5_000,
          unitPriceMinor: 5_000,
          codeDiscountMinor: 500,
        }),
      ],
      1_000,
    );

    expect(totals.subtotalOriginalMinor).toBe(25_000);
    expect(totals.offerDiscountMinor).toBe(4_000);
    expect(totals.codeDiscountMinor).toBe(1_500);
    expect(totals.manualDiscountMinor).toBe(1_000);
    expect(totals.discountMinor).toBe(6_500);
    expect(totals.totalMinor).toBe(18_500);
    // El manual se reparte proporcionalmente y la suma de líneas es exactamente el total.
    expect(lines.reduce((acc, item) => acc + item.lineTotalMinor, 0)).toBe(
      totals.totalMinor,
    );
    expect(
      lines.reduce((acc, item) => acc + item.manualDiscountMinor, 0),
    ).toBe(1_000);
  });

  it("rechaza un descuento manual mayor al importe cobrable", () => {
    expect(() => computeSaleTotals([line()], 10_001)).toThrow(PosProblemError);
    expect(() => computeSaleTotals([line()], -1)).toThrow(PosProblemError);
  });

  it("rechaza un descuento de código mayor al importe de la línea", () => {
    expect(() =>
      computeSaleTotals([line({ codeDiscountMinor: 10_001 })]),
    ).toThrow(PosProblemError);
  });

  it("nunca deja el pendiente en negativo", () => {
    expect(pendingAmountMinor(10_000, 4_000)).toBe(6_000);
    expect(pendingAmountMinor(10_000, 10_000)).toBe(0);
    expect(pendingAmountMinor(10_000, 12_000)).toBe(0);
  });
});

describe("POS reparto de reembolso", () => {
  const cash = {
    id: "pay-cash",
    method: PosPaymentMethod.CASH,
    status: PosPaymentStatus.APPROVED,
    amountMinor: 5_000,
    refundedMinor: 0,
    approvedAtMs: 2_000,
  };
  const card = {
    id: "pay-card",
    method: PosPaymentMethod.CARD_EXTERNAL,
    status: PosPaymentStatus.APPROVED,
    amountMinor: 15_000,
    refundedMinor: 0,
    approvedAtMs: 1_000,
  };

  it("agota primero el efectivo y luego la tarjeta", () => {
    const result = allocateRefund(8_000, [card, cash]);
    expect(result.cashRefundMinor).toBe(5_000);
    expect(result.cardRefundMinor).toBe(3_000);
    expect(result.allocations.map((item) => item.paymentId)).toEqual([
      "pay-cash",
      "pay-card",
    ]);
  });

  it("no reembolsa más que el saldo reembolsable", () => {
    expect(totalRefundableMinor([cash, card])).toBe(20_000);
    expect(() => allocateRefund(20_001, [cash, card])).toThrow(PosProblemError);
    expect(() => allocateRefund(20_001, [cash, card])).toThrow(
      /excede el saldo reembolsable/i,
    );
  });

  it("descuenta lo ya reembolsado y excluye pagos no reembolsables", () => {
    const partiallyRefunded = {
      ...card,
      status: PosPaymentStatus.PARTIALLY_REFUNDED,
      refundedMinor: 12_000,
    };
    const declined = {
      ...cash,
      id: "pay-declined",
      status: PosPaymentStatus.DECLINED,
    };

    expect(totalRefundableMinor([partiallyRefunded, declined])).toBe(3_000);
    expect(() => allocateRefund(3_001, [partiallyRefunded, declined])).toThrow(
      PosProblemError,
    );
    const result = allocateRefund(3_000, [partiallyRefunded, declined]);
    expect(result.cardRefundMinor).toBe(3_000);
    expect(result.cashRefundMinor).toBe(0);
  });

  it("rechaza importes no positivos o no enteros", () => {
    expect(() => allocateRefund(0, [cash])).toThrow(PosProblemError);
    expect(() => allocateRefund(-100, [cash])).toThrow(PosProblemError);
    expect(() => allocateRefund(10.5, [cash])).toThrow(PosProblemError);
  });

  describe("importe por línea devuelta", () => {
    it("las devoluciones parciales suman exactamente el total de línea", () => {
      const uno = lineRefundMinor({
        lineTotalMinor: 1_000,
        quantity: 3,
        returnQuantity: 1,
        alreadyReturnedQuantity: 0,
        alreadyRefundedMinor: 0,
      });
      const dos = lineRefundMinor({
        lineTotalMinor: 1_000,
        quantity: 3,
        returnQuantity: 2,
        alreadyReturnedQuantity: 1,
        alreadyRefundedMinor: uno,
      });

      expect(uno).toBe(334);
      expect(dos).toBe(666);
      expect(uno + dos).toBe(1_000);
    });

    it("devolver todo de una vez reembolsa el total cobrado", () => {
      expect(
        lineRefundMinor({
          lineTotalMinor: 1_000,
          quantity: 3,
          returnQuantity: 3,
          alreadyReturnedQuantity: 0,
          alreadyRefundedMinor: 0,
        }),
      ).toBe(1_000);
    });

    it("es independiente del orden de las devoluciones parciales", () => {
      const total = [1, 1, 1].reduce(
        (acc, quantity, index) =>
          acc +
          lineRefundMinor({
            lineTotalMinor: 1_001,
            quantity: 3,
            returnQuantity: quantity,
            alreadyReturnedQuantity: index,
            alreadyRefundedMinor: acc,
          }),
        0,
      );
      expect(total).toBe(1_001);
    });

    it("no permite devolver más unidades de las vendidas", () => {
      expect(() =>
        lineRefundMinor({
          lineTotalMinor: 1_000,
          quantity: 2,
          returnQuantity: 3,
          alreadyReturnedQuantity: 0,
          alreadyRefundedMinor: 0,
        }),
      ).toThrow(/no puedes devolver más unidades/i);

      expect(() =>
        lineRefundMinor({
          lineTotalMinor: 1_000,
          quantity: 2,
          returnQuantity: 1,
          alreadyReturnedQuantity: 2,
          alreadyRefundedMinor: 1_000,
        }),
      ).toThrow(/no puedes devolver más unidades/i);
    });

    it("rechaza cantidades inválidas", () => {
      expect(() =>
        lineRefundMinor({
          lineTotalMinor: 1_000,
          quantity: 2,
          returnQuantity: 0,
          alreadyReturnedQuantity: 0,
          alreadyRefundedMinor: 0,
        }),
      ).toThrow(PosProblemError);

      expect(() =>
        lineRefundMinor({
          lineTotalMinor: 1_000,
          quantity: 2,
          returnQuantity: 1,
          alreadyReturnedQuantity: -1,
          alreadyRefundedMinor: 0,
        }),
      ).toThrow(PosProblemError);
    });
  });
});
