/**
 * Repositorios de los agregados operativos del POS.
 *
 * Cada clase extiende `PosAggregateRepository` y solo añade las consultas propias de su
 * agregado. Ninguna capa superior toca Firestore directamente.
 */

import { POS_STORE_ID } from "../constants/pos.constants";
import {
  PosCashMovementStatus,
  PosCashMovementType,
  PosCutScope,
  PosPaymentStatus,
  PosRegisterStatus,
  PosReturnStatus,
  PosSaleStatus,
  PosSessionStatus,
  PosShiftStatus,
} from "../models/pos.enums";
import type {
  PosCashCount,
  PosCashMovement,
  PosCut,
  PosCutVersion,
  PosDailyClose,
  PosExport,
  PosIncident,
  PosPageResult,
  PosPayment,
  PosRegister,
  PosRegisterSession,
  PosReturn,
  PosSale,
  PosShift,
} from "../models/pos.types";
import { PosAggregateRepository } from "./pos-aggregate.repository";
import { mapQuerySnapshot, nowTimestamp, posDoc } from "./pos-firestore";

/** Límite duro de documentos leídos en una consolidación. Protege contra consultas costosas. */
export const POS_CONSOLIDATION_HARD_LIMIT = 3_000;

export class PosRegisterRepository extends PosAggregateRepository<PosRegister> {
  constructor() {
    super("REGISTERS");
  }

  async findByCode(code: string): Promise<PosRegister | null> {
    const snapshot = await this.collection()
      .where("storeId", "==", POS_STORE_ID)
      .where("code", "==", code)
      .limit(1)
      .get();
    return mapQuerySnapshot<PosRegister>(snapshot)[0] ?? null;
  }

  async listActive(limit: number): Promise<PosRegister[]> {
    const snapshot = await this.collection()
      .where("storeId", "==", POS_STORE_ID)
      .limit(Math.max(limit, 100))
      .get();
    return mapQuerySnapshot<PosRegister>(snapshot)
      .filter((register) => register.archived !== true)
      .sort((a, b) => a.code.localeCompare(b.code, "es"))
      .slice(0, limit);
  }

  /**
   * Listado de cajas sin índice compuesto. Una sola sucursal tiene pocas cajas;
   * filtrar y ordenar en memoria evita bloquear el POS si el índice aún no está
   * desplegado.
   */
  async listForStore(input: {
    limit: number;
    status?: PosRegisterStatus;
    includeArchived?: boolean;
  }): Promise<PosPageResult<PosRegister>> {
    const snapshot = await this.collection()
      .where("storeId", "==", POS_STORE_ID)
      .limit(500)
      .get();

    let items = mapQuerySnapshot<PosRegister>(snapshot);
    if (!input.includeArchived) {
      items = items.filter((register) => register.archived !== true);
    }
    if (input.status) {
      items = items.filter((register) => register.status === input.status);
    }
    items.sort((a, b) => a.code.localeCompare(b.code, "es"));

    const limited = items.slice(0, input.limit);
    return {
      items: limited,
      hasMore: items.length > input.limit,
      nextCursor: null,
    };
  }

  async listOpen(limit: number): Promise<PosRegister[]> {
    const snapshot = await this.collection()
      .where("storeId", "==", POS_STORE_ID)
      .where("status", "==", PosRegisterStatus.OPEN)
      .limit(limit)
      .get();
    return mapQuerySnapshot<PosRegister>(snapshot);
  }

  async touchActivity(id: string): Promise<void> {
    await this.ref(id).set({ lastActivityAt: nowTimestamp() }, { merge: true });
  }
}

export class PosSessionRepository extends PosAggregateRepository<PosRegisterSession> {
  constructor() {
    super("REGISTER_SESSIONS");
  }

  async listByOperationalDate(
    operationalDate: string,
  ): Promise<PosRegisterSession[]> {
    return this.collectAll(
      [{ field: "operationalDate", value: operationalDate }],
      "openedAt",
      POS_CONSOLIDATION_HARD_LIMIT,
    );
  }

  async findOpenByRegister(registerId: string): Promise<PosRegisterSession | null> {
    const snapshot = await this.collection()
      .where("storeId", "==", POS_STORE_ID)
      .where("registerId", "==", registerId)
      .where("status", "in", [
        PosSessionStatus.OPEN,
        PosSessionStatus.HANDOFF_PENDING,
        PosSessionStatus.COUNTING,
        PosSessionStatus.REVIEW_PENDING,
      ])
      .limit(1)
      .get();
    return mapQuerySnapshot<PosRegisterSession>(snapshot)[0] ?? null;
  }
}

export class PosShiftRepository extends PosAggregateRepository<PosShift> {
  constructor() {
    super("SHIFTS");
  }

  async findActiveByCashier(cashierUid: string): Promise<PosShift | null> {
    const snapshot = await this.collection()
      .where("storeId", "==", POS_STORE_ID)
      .where("cashierUid", "==", cashierUid)
      .where("status", "in", [
        PosShiftStatus.ACTIVE,
        PosShiftStatus.HANDOFF_PENDING,
        PosShiftStatus.COUNTING,
      ])
      .limit(1)
      .get();
    return mapQuerySnapshot<PosShift>(snapshot)[0] ?? null;
  }

  async listBySession(sessionId: string): Promise<PosShift[]> {
    return this.collectAll(
      [{ field: "sessionId", value: sessionId }],
      "startedAt",
      POS_CONSOLIDATION_HARD_LIMIT,
    );
  }

  async listByOperationalDate(operationalDate: string): Promise<PosShift[]> {
    const snapshot = await this.collection()
      .where("operationalDate", "==", operationalDate)
      .limit(POS_CONSOLIDATION_HARD_LIMIT)
      .get();
    return mapQuerySnapshot<PosShift>(snapshot)
      .filter((shift) => shift.storeId === POS_STORE_ID)
      .sort((a, b) => a.startedAt.toMillis() - b.startedAt.toMillis());
  }
}

export class PosSaleRepository extends PosAggregateRepository<PosSale> {
  constructor() {
    super("SALES");
  }

  /**
   * Consulta por `shiftId` solo (índice automático de un campo) y filtra en memoria.
   * Evita depender de índices compuestos aún no desplegados en `tiendacl`.
   */
  async listByShift(shiftId: string): Promise<PosSale[]> {
    const snapshot = await this.collection()
      .where("shiftId", "==", shiftId)
      .limit(POS_CONSOLIDATION_HARD_LIMIT)
      .get();
    return mapQuerySnapshot<PosSale>(snapshot)
      .filter((sale) => sale.storeId === POS_STORE_ID)
      .sort((a, b) => a.createdAt.toMillis() - b.createdAt.toMillis());
  }

  async listPageForShift(input: {
    shiftId: string;
    status?: PosSaleStatus;
    cashierUid?: string;
    limit: number;
  }): Promise<PosPageResult<PosSale>> {
    let items = await this.listByShift(input.shiftId);
    if (input.status) {
      items = items.filter((sale) => sale.status === input.status);
    }
    if (input.cashierUid) {
      items = items.filter((sale) => sale.cashierUid === input.cashierUid);
    }
    items.sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis());
    const limited = items.slice(0, input.limit);
    return {
      items: limited,
      hasMore: items.length > input.limit,
      nextCursor: null,
    };
  }

  async listPageForOperationalDate(input: {
    operationalDate: string;
    status?: PosSaleStatus;
    registerId?: string;
    cashierUid?: string;
    folio?: string;
    limit: number;
  }): Promise<PosPageResult<PosSale>> {
    let items = await this.listByOperationalDate(input.operationalDate);
    if (input.status) {
      items = items.filter((sale) => sale.status === input.status);
    }
    if (input.registerId) {
      items = items.filter((sale) => sale.registerId === input.registerId);
    }
    if (input.cashierUid) {
      items = items.filter((sale) => sale.cashierUid === input.cashierUid);
    }
    if (input.folio) {
      items = items.filter((sale) => sale.folio === input.folio);
    }
    items.sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis());
    const limited = items.slice(0, input.limit);
    return {
      items: limited,
      hasMore: items.length > input.limit,
      nextCursor: null,
    };
  }

  async listByOperationalDate(operationalDate: string): Promise<PosSale[]> {
    const snapshot = await this.collection()
      .where("operationalDate", "==", operationalDate)
      .limit(POS_CONSOLIDATION_HARD_LIMIT)
      .get();
    return mapQuerySnapshot<PosSale>(snapshot)
      .filter((sale) => sale.storeId === POS_STORE_ID)
      .sort((a, b) => a.createdAt.toMillis() - b.createdAt.toMillis());
  }

  /** Ventas que impiden cerrar un turno o una caja. */
  async countPendingByShift(shiftId: string): Promise<number> {
    const pending = new Set<PosSaleStatus>([
      PosSaleStatus.DRAFT,
      PosSaleStatus.SUSPENDED,
      PosSaleStatus.PAYMENT_PENDING,
    ]);
    const sales = await this.listByShift(shiftId);
    return sales.filter((sale) => pending.has(sale.status)).length;
  }

  async findByTicketToken(token: string): Promise<PosSale | null> {
    const snapshot = await this.collection()
      .where("ticketToken", "==", token)
      .limit(5)
      .get();
    return (
      mapQuerySnapshot<PosSale>(snapshot).find(
        (sale) => sale.storeId === POS_STORE_ID,
      ) ?? null
    );
  }
}

export class PosPaymentRepository extends PosAggregateRepository<PosPayment> {
  constructor() {
    super("PAYMENTS");
  }

  /**
   * Consulta por `saleId` solo (índice de un campo) y filtra/ordena en memoria.
   * Evita el índice compuesto storeId+saleId+createdAt aún no desplegado.
   */
  async listBySale(saleId: string): Promise<PosPayment[]> {
    const snapshot = await this.collection()
      .where("saleId", "==", saleId)
      .limit(500)
      .get();
    return mapQuerySnapshot<PosPayment>(snapshot)
      .filter((payment) => payment.storeId === POS_STORE_ID)
      .sort((a, b) => a.createdAt.toMillis() - b.createdAt.toMillis());
  }

  async listBySaleInTransaction(
    transaction: FirebaseFirestore.Transaction,
    saleId: string,
  ): Promise<PosPayment[]> {
    const snapshot = await transaction.get(
      this.collection().where("saleId", "==", saleId).limit(200),
    );
    return mapQuerySnapshot<PosPayment>(snapshot)
      .filter((payment) => payment.storeId === POS_STORE_ID)
      .sort((a, b) => a.createdAt.toMillis() - b.createdAt.toMillis());
  }

  async listByOperationalDate(operationalDate: string): Promise<PosPayment[]> {
    return this.collectAll(
      [{ field: "operationalDate", value: operationalDate }],
      "createdAt",
      POS_CONSOLIDATION_HARD_LIMIT,
    );
  }

  async listByShift(shiftId: string): Promise<PosPayment[]> {
    const snapshot = await this.collection()
      .where("shiftId", "==", shiftId)
      .limit(POS_CONSOLIDATION_HARD_LIMIT)
      .get();
    return mapQuerySnapshot<PosPayment>(snapshot)
      .filter((payment) => payment.storeId === POS_STORE_ID)
      .sort((a, b) => a.createdAt.toMillis() - b.createdAt.toMillis());
  }

  async listApprovedByShift(shiftId: string): Promise<PosPayment[]> {
    const approved = new Set<PosPaymentStatus>([
      PosPaymentStatus.APPROVED,
      PosPaymentStatus.PARTIALLY_REFUNDED,
      PosPaymentStatus.REFUNDED,
    ]);
    return (await this.listByShift(shiftId)).filter((payment) =>
      approved.has(payment.status),
    );
  }
}

export class PosCashMovementRepository extends PosAggregateRepository<PosCashMovement> {
  constructor() {
    super("CASH_MOVEMENTS");
  }

  async listByShift(shiftId: string): Promise<PosCashMovement[]> {
    const snapshot = await this.collection()
      .where("shiftId", "==", shiftId)
      .limit(POS_CONSOLIDATION_HARD_LIMIT)
      .get();
    return mapQuerySnapshot<PosCashMovement>(snapshot)
      .filter((movement) => movement.storeId === POS_STORE_ID)
      .sort((a, b) => a.createdAt.toMillis() - b.createdAt.toMillis());
  }

  async listPageForShift(input: {
    shiftId: string;
    type?: PosCashMovementType;
    status?: PosCashMovementStatus;
    limit: number;
  }): Promise<PosPageResult<PosCashMovement>> {
    let items = await this.listByShift(input.shiftId);
    if (input.type) {
      items = items.filter((movement) => movement.type === input.type);
    }
    if (input.status) {
      items = items.filter((movement) => movement.status === input.status);
    }
    items.sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis());
    const limited = items.slice(0, input.limit);
    return {
      items: limited,
      hasMore: items.length > input.limit,
      nextCursor: null,
    };
  }

  async listByShiftInTransaction(
    transaction: FirebaseFirestore.Transaction,
    shiftId: string,
  ): Promise<PosCashMovement[]> {
    const snapshot = await transaction.get(
      this.collection().where("shiftId", "==", shiftId).limit(POS_CONSOLIDATION_HARD_LIMIT),
    );
    return mapQuerySnapshot<PosCashMovement>(snapshot)
      .filter((movement) => movement.storeId === POS_STORE_ID)
      .sort((a, b) => a.createdAt.toMillis() - b.createdAt.toMillis());
  }

  async listByOperationalDate(operationalDate: string): Promise<PosCashMovement[]> {
    return this.collectAll(
      [{ field: "operationalDate", value: operationalDate }],
      "createdAt",
      POS_CONSOLIDATION_HARD_LIMIT,
    );
  }

  /** Movimientos que bloquean un cierre: pendientes de autorización o en tránsito. */
  async listUnresolvedByOperationalDate(
    operationalDate: string,
  ): Promise<PosCashMovement[]> {
    const snapshot = await this.collection()
      .where("storeId", "==", POS_STORE_ID)
      .where("operationalDate", "==", operationalDate)
      .where("status", "in", [
        PosCashMovementStatus.PENDING_AUTHORIZATION,
        PosCashMovementStatus.IN_TRANSIT,
      ])
      .limit(200)
      .get();
    return mapQuerySnapshot<PosCashMovement>(snapshot);
  }

  async countUnresolvedByShift(shiftId: string): Promise<number> {
    const unresolved = new Set<PosCashMovementStatus>([
      PosCashMovementStatus.PENDING_AUTHORIZATION,
      PosCashMovementStatus.IN_TRANSIT,
    ]);
    const movements = await this.listByShift(shiftId);
    return movements.filter((movement) => unresolved.has(movement.status)).length;
  }

  async findPendingTransferInForShift(
    shiftId: string,
  ): Promise<PosCashMovement | null> {
    const snapshot = await this.collection()
      .where("storeId", "==", POS_STORE_ID)
      .where("targetShiftId", "==", shiftId)
      .where("type", "==", PosCashMovementType.TRANSFER_OUT)
      .where("status", "==", PosCashMovementStatus.IN_TRANSIT)
      .limit(1)
      .get();
    return mapQuerySnapshot<PosCashMovement>(snapshot)[0] ?? null;
  }
}

export class PosCashCountRepository extends PosAggregateRepository<PosCashCount> {
  constructor() {
    super("CASH_COUNTS");
  }

  async listByShift(shiftId: string): Promise<PosCashCount[]> {
    const snapshot = await this.collection()
      .where("shiftId", "==", shiftId)
      .limit(50)
      .get();
    return mapQuerySnapshot<PosCashCount>(snapshot)
      .filter((count) => count.storeId === POS_STORE_ID)
      .sort((a, b) => b.version - a.version);
  }

  async latestVersionForShift(shiftId: string): Promise<number> {
    const counts = await this.listByShift(shiftId);
    return counts[0]?.version ?? 0;
  }

  async latestVersionForShiftInTransaction(
    transaction: FirebaseFirestore.Transaction,
    shiftId: string,
  ): Promise<number> {
    const snapshot = await transaction.get(
      this.collection().where("shiftId", "==", shiftId).limit(50),
    );
    const counts = mapQuerySnapshot<PosCashCount>(snapshot)
      .filter((count) => count.storeId === POS_STORE_ID)
      .sort((a, b) => b.version - a.version);
    return counts[0]?.version ?? 0;
  }
}

export class PosCutRepository extends PosAggregateRepository<PosCut> {
  constructor() {
    super("CUTS");
  }

  async findByShift(shiftId: string): Promise<PosCut | null> {
    const snapshot = await this.collection()
      .where("storeId", "==", POS_STORE_ID)
      .where("shiftId", "==", shiftId)
      .where("scope", "==", PosCutScope.SHIFT)
      .limit(1)
      .get();
    return mapQuerySnapshot<PosCut>(snapshot)[0] ?? null;
  }

  async findByShiftInTransaction(
    transaction: FirebaseFirestore.Transaction,
    shiftId: string,
  ): Promise<PosCut | null> {
    const snapshot = await transaction.get(
      this.collection()
        .where("storeId", "==", POS_STORE_ID)
        .where("shiftId", "==", shiftId)
        .where("scope", "==", PosCutScope.SHIFT)
        .limit(1),
    );
    return mapQuerySnapshot<PosCut>(snapshot)[0] ?? null;
  }

  async findBySession(sessionId: string): Promise<PosCut | null> {
    const snapshot = await this.collection()
      .where("storeId", "==", POS_STORE_ID)
      .where("sessionId", "==", sessionId)
      .where("scope", "==", PosCutScope.SESSION)
      .limit(1)
      .get();
    return mapQuerySnapshot<PosCut>(snapshot)[0] ?? null;
  }

  async listByOperationalDate(operationalDate: string): Promise<PosCut[]> {
    const snapshot = await this.collection()
      .where("operationalDate", "==", operationalDate)
      .limit(POS_CONSOLIDATION_HARD_LIMIT)
      .get();
    return mapQuerySnapshot<PosCut>(snapshot)
      .filter((cut) => cut.storeId === POS_STORE_ID)
      .sort((a, b) => a.createdAt.toMillis() - b.createdAt.toMillis());
  }
}

export class PosCutVersionRepository extends PosAggregateRepository<PosCutVersion> {
  constructor() {
    super("CUT_VERSIONS");
  }

  async listByCut(cutId: string): Promise<PosCutVersion[]> {
    const snapshot = await this.collection()
      .where("storeId", "==", POS_STORE_ID)
      .where("cutId", "==", cutId)
      .orderBy("version", "desc")
      .limit(50)
      .get();
    return mapQuerySnapshot<PosCutVersion>(snapshot);
  }
}

export class PosReturnRepository extends PosAggregateRepository<PosReturn> {
  constructor() {
    super("RETURNS");
  }

  async listBySale(saleId: string): Promise<PosReturn[]> {
    const snapshot = await this.collection()
      .where("saleId", "==", saleId)
      .limit(200)
      .get();
    return mapQuerySnapshot<PosReturn>(snapshot)
      .filter((item) => item.storeId === POS_STORE_ID)
      .sort((a, b) => a.createdAt.toMillis() - b.createdAt.toMillis());
  }

  async listBySaleInTransaction(
    transaction: FirebaseFirestore.Transaction,
    saleId: string,
  ): Promise<PosReturn[]> {
    const snapshot = await transaction.get(
      this.collection().where("saleId", "==", saleId).limit(200),
    );
    return mapQuerySnapshot<PosReturn>(snapshot)
      .filter((item) => item.storeId === POS_STORE_ID)
      .sort((a, b) => a.createdAt.toMillis() - b.createdAt.toMillis());
  }

  async listByShift(shiftId: string): Promise<PosReturn[]> {
    const snapshot = await this.collection()
      .where("shiftId", "==", shiftId)
      .limit(POS_CONSOLIDATION_HARD_LIMIT)
      .get();
    return mapQuerySnapshot<PosReturn>(snapshot)
      .filter((item) => item.storeId === POS_STORE_ID)
      .sort((a, b) => a.createdAt.toMillis() - b.createdAt.toMillis());
  }

  async listByOperationalDate(operationalDate: string): Promise<PosReturn[]> {
    return this.collectAll(
      [{ field: "operationalDate", value: operationalDate }],
      "createdAt",
      POS_CONSOLIDATION_HARD_LIMIT,
    );
  }

  async listUnresolvedByOperationalDate(
    operationalDate: string,
  ): Promise<PosReturn[]> {
    const snapshot = await this.collection()
      .where("storeId", "==", POS_STORE_ID)
      .where("operationalDate", "==", operationalDate)
      .where("status", "in", [
        PosReturnStatus.DRAFT,
        PosReturnStatus.PENDING_APPROVAL,
        PosReturnStatus.APPROVED,
      ])
      .limit(200)
      .get();
    return mapQuerySnapshot<PosReturn>(snapshot);
  }
}

export class PosDailyCloseRepository extends PosAggregateRepository<PosDailyClose> {
  constructor() {
    super("DAILY_CLOSURES");
  }

  /** El ID del documento es la fecha operativa, lo que garantiza unicidad (DEC-08). */
  async getByOperationalDate(
    operationalDate: string,
  ): Promise<PosDailyClose | null> {
    return this.getById(operationalDate);
  }

  async getByOperationalDateInTransaction(
    transaction: FirebaseFirestore.Transaction,
    operationalDate: string,
  ): Promise<PosDailyClose | null> {
    return this.getByIdInTransaction(transaction, operationalDate);
  }

  dateRef(operationalDate: string): FirebaseFirestore.DocumentReference {
    return posDoc("DAILY_CLOSURES", operationalDate);
  }
}

export class PosIncidentRepository extends PosAggregateRepository<PosIncident> {
  constructor() {
    super("INCIDENTS");
  }

  async listByOperationalDate(operationalDate: string): Promise<PosIncident[]> {
    return this.collectAll(
      [{ field: "operationalDate", value: operationalDate }],
      "createdAt",
      POS_CONSOLIDATION_HARD_LIMIT,
    );
  }
}

export class PosExportRepository extends PosAggregateRepository<PosExport> {
  constructor() {
    super("EXPORTS");
  }
}

export const posRegisterRepository = new PosRegisterRepository();
export const posSessionRepository = new PosSessionRepository();
export const posShiftRepository = new PosShiftRepository();
export const posSaleRepository = new PosSaleRepository();
export const posPaymentRepository = new PosPaymentRepository();
export const posCashMovementRepository = new PosCashMovementRepository();
export const posCashCountRepository = new PosCashCountRepository();
export const posCutRepository = new PosCutRepository();
export const posCutVersionRepository = new PosCutVersionRepository();
export const posReturnRepository = new PosReturnRepository();
export const posDailyCloseRepository = new PosDailyCloseRepository();
export const posIncidentRepository = new PosIncidentRepository();
export const posExportRepository = new PosExportRepository();
