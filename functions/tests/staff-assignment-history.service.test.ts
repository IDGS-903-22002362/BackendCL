import { describe, expect, it, jest } from "@jest/globals";
import { LoyaltyChannel, LoyaltyTransactionStatus, LoyaltyTransactionType } from "../src/modules/loyalty/models/loyalty.enums";
import { StaffAssignmentHistoryService } from "../src/modules/loyalty/services/staff-assignment-history.service";

const createdAt = { toDate: () => new Date("2026-07-20T12:00:00.000Z") };

function transaction(overrides: Record<string, unknown> = {}) {
  return {
    transactionId: "tx-1",
    memberId: "member-1",
    actorId: "employee-1",
    actorType: "EMPLOYEE",
    type: LoyaltyTransactionType.EARN,
    status: LoyaltyTransactionStatus.CONFIRMED,
    points: 10,
    balanceBefore: 0,
    balanceAfter: 10,
    channel: LoyaltyChannel.STORE,
    amountCents: 12345,
    createdAt,
    ...overrides,
  } as never;
}

function fakeFirestore(profiles: Record<string, { nombre?: string } | undefined>) {
  const getAll = jest.fn(async (...refs: Array<{ id: string }>) =>
    refs.map((ref) => ({
      exists: Boolean(profiles[ref.id]),
      data: () => profiles[ref.id],
    })),
  );
  return {
    collection: () => ({ doc: (id: string) => ({ id }) }),
    getAll,
  };
}

describe("StaffAssignmentHistoryService", () => {
  it("devuelve el snapshot seguro y saleId sin consultar perfiles", async () => {
    const ledger = {
      listAdmin: jest.fn(async (_options: unknown) => ({
        items: [transaction({
          metadata: {
            customerNameSnapshot: "Ana León",
            saleId: "TICKET-100",
          },
        })],
      })),
    };
    const firestore = fakeFirestore({});
    const service = new StaffAssignmentHistoryService(
      ledger as never,
      firestore as never,
    );

    const result = await service.list({ actorId: "employee-1", limit: 20 });

    expect(result.items[0]).toEqual({
      transactionId: "tx-1",
      memberId: "member-1",
      customerFullName: "Ana León",
      customerExists: true,
      saleId: "TICKET-100",
      amountMxn: 123.45,
      points: 10,
      createdAt: "2026-07-20T12:00:00.000Z",
    });
    expect(firestore.getAll).not.toHaveBeenCalled();
  });

  it("enriquece históricos legacy por lote y no inventa folio", async () => {
    const ledger = {
      listAdmin: jest.fn(async (_options: unknown) => ({
        items: [
          transaction({ transactionId: "tx-a", memberId: "member-a", metadata: undefined }),
          transaction({ transactionId: "tx-b", memberId: "deleted", metadata: undefined }),
        ],
      })),
    };
    const firestore = fakeFirestore({
      "member-a": { nombre: "  María   López  " },
      deleted: undefined,
    });
    const service = new StaffAssignmentHistoryService(ledger as never, firestore as never);

    const result = await service.list({ actorId: "employee-1", limit: 20 });

    expect(firestore.getAll).toHaveBeenCalledTimes(1);
    expect(result.items[0]).toMatchObject({
      customerFullName: "María López",
      customerExists: true,
      saleId: null,
    });
    expect(result.items[1]).toMatchObject({
      customerFullName: null,
      customerExists: false,
      saleId: null,
    });
  });

  it("busca en nombre, folio o UID y entrega cursor estable", async () => {
    const ledger = {
      listAdmin: jest.fn(async (_options: unknown) => ({
        items: [
          transaction({
            transactionId: "tx-first",
            memberId: "member-a",
            metadata: { customerNameSnapshot: "José Pérez", saleId: "VENTA-1" },
          }),
          transaction({
            transactionId: "tx-second",
            memberId: "member-b",
            metadata: { customerNameSnapshot: "José Ramírez", saleId: "VENTA-2" },
          }),
        ],
        nextCursor: "tx-second",
      })),
    };
    const service = new StaffAssignmentHistoryService(
      ledger as never,
      fakeFirestore({}) as never,
    );

    const result = await service.list({
      actorId: "employee-1",
      limit: 1,
      search: "jose",
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.transactionId).toBe("tx-first");
    expect(result.nextCursor).toBe("tx-first");
    expect(ledger.listAdmin).toHaveBeenCalledWith(expect.objectContaining({
      actorId: "employee-1",
      channel: LoyaltyChannel.STORE,
    }));
  });

  it("continúa buscando en páginas backend posteriores a la visible", async () => {
    const listAdmin = jest.fn(async (options: { cursor?: string }) =>
      options.cursor
        ? {
            items: [transaction({
              transactionId: "tx-found",
              memberId: "member-found",
              metadata: {
                customerNameSnapshot: "Cliente Encontrado",
                saleId: "FOLIO-999",
              },
            })],
          }
        : {
            items: [transaction({
              transactionId: "tx-skip",
              metadata: {
                customerNameSnapshot: "Otra Persona",
                saleId: "FOLIO-1",
              },
            })],
            nextCursor: "tx-skip",
          },
    );
    const service = new StaffAssignmentHistoryService(
      { listAdmin } as never,
      fakeFirestore({}) as never,
    );

    const result = await service.list({
      actorId: "employee-1",
      limit: 20,
      search: "encontrado",
    });

    expect(listAdmin).toHaveBeenCalledTimes(2);
    expect(result.items.map((item) => item.transactionId)).toEqual(["tx-found"]);
  });
});
