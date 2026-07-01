import { afterEach, describe, expect, it, jest } from "@jest/globals";

const mockOrderGet = jest.fn<any>();
const mockEarnFromSale = jest.fn<any>();
const mockExternalGet = jest.fn<any>();
const mockLedgerGetById = jest.fn<any>();
const mockReverseTransaction = jest.fn<any>();
const mockBuildExternalTxnKey = jest.fn<any>();

jest.mock("../src/config/firebase", () => ({
  firestoreTienda: {
    collection: () => ({
      doc: () => ({
        get: mockOrderGet,
      }),
    }),
  },
}));

jest.mock("../src/modules/loyalty/services/loyalty-engine.service", () => ({
  __esModule: true,
  default: {
    earnFromSale: (...args: unknown[]) => mockEarnFromSale(...args),
    reverseTransaction: (...args: unknown[]) => mockReverseTransaction(...args),
  },
}));

jest.mock("../src/modules/loyalty/repositories/idempotency.repository", () => ({
  externalTxnRepository: {
    get: (...args: unknown[]) => mockExternalGet(...args),
  },
}));

jest.mock("../src/modules/loyalty/repositories/ledger.repository", () => ({
  __esModule: true,
  default: {
    getById: (...args: unknown[]) => mockLedgerGetById(...args),
  },
}));

jest.mock("../src/modules/loyalty/services/conversion-rules.service", () => ({
  __esModule: true,
  default: {
    buildExternalTxnKey: (...args: unknown[]) => mockBuildExternalTxnKey(...args),
    calculatePointsFromAmountCents: (cents: number) => Math.round(cents / 1000),
  },
}));

import {
  earnLoyaltyPointsForPaidOrder,
  reverseLoyaltyPointsForRefund,
} from "../src/modules/loyalty/events/payment-loyalty.hook";
import { LoyaltyChannel } from "../src/modules/loyalty/models/loyalty.enums";

describe("payment loyalty hooks", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it("earnLoyaltyPointsForPaidOrder usa idempotencyKey earn:order:{id}", async () => {
    mockOrderGet.mockResolvedValue({
      exists: true,
      data: () => ({
        usuarioId: "member-1",
        total: 500,
      }),
    });
    mockEarnFromSale.mockResolvedValue({ transactionId: "tx-1" });

    await earnLoyaltyPointsForPaidOrder("order-abc");

    expect(mockEarnFromSale).toHaveBeenCalledWith(
      expect.objectContaining({
        memberId: "member-1",
        externalTransactionId: "order:order-abc",
        idempotencyKey: "earn:order:order-abc",
        channel: LoyaltyChannel.ECOMMERCE,
        amountCents: 50000,
      }),
    );
  });

  it("earnLoyaltyPointsForPaidOrder no asigna si orden no existe", async () => {
    mockOrderGet.mockResolvedValue({ exists: false });

    await earnLoyaltyPointsForPaidOrder("missing-order");

    expect(mockEarnFromSale).not.toHaveBeenCalled();
  });

  it("earnLoyaltyPointsForPaidOrder no asigna si pago pendiente o total cero", async () => {
    mockOrderGet.mockResolvedValue({
      exists: true,
      data: () => ({
        usuarioId: "member-1",
        total: 0,
      }),
    });

    await earnLoyaltyPointsForPaidOrder("order-zero");

    expect(mockEarnFromSale).not.toHaveBeenCalled();
  });

  it("reverseLoyaltyPointsForRefund revierte con idempotencyKey por reembolso", async () => {
    mockBuildExternalTxnKey.mockReturnValue("ext-key");
    mockExternalGet.mockResolvedValue({ transactionId: "tx-earn-1" });
    mockLedgerGetById.mockResolvedValue({
      transactionId: "tx-earn-1",
      points: 50,
    });
    mockReverseTransaction.mockResolvedValue({ transactionId: "tx-rev-1" });

    await reverseLoyaltyPointsForRefund("order-abc", 25000);

    expect(mockReverseTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        originalTransactionId: "tx-earn-1",
        idempotencyKey: "refund:order:order-abc:25000",
        points: 25,
      }),
    );
  });

  it("reverseLoyaltyPointsForRefund no duplica si no hay transaccion original", async () => {
    mockBuildExternalTxnKey.mockReturnValue("ext-key");
    mockExternalGet.mockResolvedValue(null);

    await reverseLoyaltyPointsForRefund("order-abc");

    expect(mockReverseTransaction).not.toHaveBeenCalled();
  });
});
