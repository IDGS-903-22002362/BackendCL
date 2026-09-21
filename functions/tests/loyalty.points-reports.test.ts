import { beforeEach, describe, expect, it } from "@jest/globals";
import { Timestamp } from "firebase-admin/firestore";
import { TipoMovimientoPuntos } from "../src/models/usuario.model";
import { LoyaltyPermission } from "../src/modules/loyalty/models/loyalty.enums";
import { RolUsuario } from "../src/models/usuario.model";
import { permissionsForRole } from "../src/modules/loyalty/services/loyalty-auth.service";
import {
  aggregateEarners,
  isEarnMovement,
  isRetryableFirestoreError,
  PointsReportsService,
} from "../src/modules/loyalty/services/points-reports.service";

type FakeDoc = {
  id: string;
  path: string;
  data: Record<string, unknown>;
};

function ts(iso: string): Timestamp {
  return Timestamp.fromDate(new Date(iso));
}

function createDoc(path: string, data: Record<string, unknown>): FakeDoc {
  const id = path.split("/").pop() as string;
  return { id, path, data };
}

function snapshotFrom(doc: FakeDoc) {
  return {
    id: doc.id,
    exists: true,
    ref: {
      path: doc.path,
      parent: {
        parent: {
          id: doc.path.split("/")[1] ?? doc.data.usuarioId,
        },
      },
    },
    data: () => doc.data,
  };
}

function createFakeFirestore(seed: {
  movements?: FakeDoc[];
  users?: FakeDoc[];
  getFailures?: number;
  failAfterSuccessfulGets?: number;
}) {
  const movements = seed.movements ?? [];
  const users = seed.users ?? [];
  const constraints: Array<{ type: string; args: unknown[] }> = [];
  let remainingFailures = seed.getFailures ?? 0;
  let successfulMovementGets = 0;

  const query = {
    where(...args: unknown[]) {
      constraints.push({ type: "where", args });
      return query;
    },
    orderBy(...args: unknown[]) {
      constraints.push({ type: "orderBy", args });
      return query;
    },
    limit(value: number) {
      constraints.push({ type: "limit", args: [value] });
      return query;
    },
    startAfter(cursor: { id?: string; ref?: { path?: string } }) {
      constraints.push({ type: "startAfter", args: [cursor] });
      return query;
    },
    async get() {
      const tipoEq = constraints.find(
        (item) => item.type === "where" && item.args[0] === "tipo",
      )?.args[2] as string | undefined;
      const puntosGt = constraints.find(
        (item) =>
          item.type === "where" &&
          item.args[0] === "puntosActuales" &&
          item.args[1] === ">",
      )?.args[2] as number | undefined;
      const createdFrom = constraints.find(
        (item) =>
          item.type === "where" &&
          item.args[0] === "createdAt" &&
          item.args[1] === ">=",
      )?.args[2] as Timestamp | undefined;
      const createdTo = constraints.find(
        (item) =>
          item.type === "where" &&
          item.args[0] === "createdAt" &&
          item.args[1] === "<",
      )?.args[2] as Timestamp | undefined;
      const orderBy = constraints.find((item) => item.type === "orderBy");
      const orderField = (orderBy?.args[0] as string | undefined) ?? "createdAt";
      const orderDir = (orderBy?.args[1] as string | undefined) ?? "asc";
      const startAfterCursor = constraints.find(
        (item) => item.type === "startAfter",
      )?.args[0] as { id?: string; ref?: { path?: string } } | undefined;
      const limit =
        (constraints.find((item) => item.type === "limit")?.args[0] as
          | number
          | undefined) ?? 100;
      const source =
        puntosGt !== undefined
          ? users
          : movements.filter((doc) => {
              if (tipoEq && doc.data.tipo !== tipoEq) return false;
              const createdAt = doc.data.createdAt as Timestamp;
              if (createdFrom && createdAt.toMillis() < createdFrom.toMillis()) {
                return false;
              }
              if (createdTo && createdAt.toMillis() >= createdTo.toMillis()) {
                return false;
              }
              return true;
            });

      const sorted = source
        .filter((doc) =>
          puntosGt !== undefined
            ? Number(doc.data.puntosActuales) > puntosGt
            : true,
        )
        .sort((a, b) => {
          if (puntosGt !== undefined || orderField === "puntosActuales") {
            const delta =
              Number(b.data.puntosActuales) - Number(a.data.puntosActuales);
            if (delta !== 0) return delta;
            return a.id.localeCompare(b.id);
          }
          const timeDelta =
            (a.data.createdAt as Timestamp).toMillis() -
            (b.data.createdAt as Timestamp).toMillis();
          const ordered = orderDir === "desc" ? -timeDelta : timeDelta;
          if (ordered !== 0) return ordered;
          return a.id.localeCompare(b.id);
        });

      const cursorPath = startAfterCursor?.ref?.path;
      const cursorId = startAfterCursor?.id;
      const cursorIndex = cursorPath
        ? sorted.findIndex((doc) => doc.path === cursorPath)
        : cursorId
          ? sorted.findIndex((doc) => doc.id === cursorId)
          : -1;
      const afterCursor =
        cursorIndex >= 0 ? sorted.slice(cursorIndex + 1) : sorted;

      const isMovementQuery = createdFrom !== undefined || tipoEq !== undefined;
      if (isMovementQuery && remainingFailures > 0) {
        remainingFailures -= 1;
        throw Object.assign(new Error("unavailable"), { code: "unavailable" });
      }
      if (
        isMovementQuery &&
        seed.failAfterSuccessfulGets !== undefined &&
        successfulMovementGets >= seed.failAfterSuccessfulGets
      ) {
        throw Object.assign(new Error("unavailable"), { code: "unavailable" });
      }
      if (isMovementQuery) {
        successfulMovementGets += 1;
      }

      const docs = afterCursor.slice(0, limit).map(snapshotFrom);

      return { docs };
    },
  };

  return {
    constraints,
    collectionGroup() {
      constraints.length = 0;
      return query;
    },
    collection() {
      constraints.length = 0;
      return {
        ...query,
        doc(id: string) {
          const found = users.find((user) => user.id === id);
          return {
            get: async () =>
              found
                ? snapshotFrom(found)
                : { exists: false, id, data: () => undefined, ref: { path: `usuariosApp/${id}` } },
          };
        },
      };
    },
    doc(path: string) {
      const found = movements.find((doc) => doc.path === path);
      return {
        get: async () =>
          found
            ? snapshotFrom(found)
            : { exists: false, id: path, data: () => undefined, ref: { path } },
      };
    },
    async getAll(...refs: Array<{ get: () => Promise<unknown> }>) {
      return Promise.all(refs.map((ref) => ref.get()));
    },
  };
}

describe("points reports helpers", () => {
  it("counts accumulation, bonus, refund and positive adjustments as earned points", () => {
    expect(isEarnMovement(TipoMovimientoPuntos.BONIFICACION, 5)).toBe(true);
    expect(isEarnMovement(TipoMovimientoPuntos.ACUMULACION, 12)).toBe(true);
    expect(isEarnMovement(TipoMovimientoPuntos.DEVOLUCION, 8)).toBe(true);
    expect(isEarnMovement(TipoMovimientoPuntos.AJUSTE, 3)).toBe(true);
    expect(isEarnMovement(TipoMovimientoPuntos.AJUSTE, -3)).toBe(false);
    expect(isEarnMovement(TipoMovimientoPuntos.CANJE, -20)).toBe(false);
    expect(isEarnMovement(TipoMovimientoPuntos.EXPIRACION, -10)).toBe(false);
  });

  it("retries only transient Firestore failures", () => {
    expect(isRetryableFirestoreError({ code: "unavailable" })).toBe(true);
    expect(isRetryableFirestoreError({ code: "permission-denied" })).toBe(false);
  });

  it("aggregates earned points by user and ignores redemptions", () => {
    const totals = aggregateEarners([
      { usuarioId: "ana", tipo: TipoMovimientoPuntos.BONIFICACION, puntos: 5 },
      { usuarioId: "ana", tipo: TipoMovimientoPuntos.ACUMULACION, puntos: 10 },
      { usuarioId: "ana", tipo: TipoMovimientoPuntos.CANJE, puntos: -8 },
      { usuarioId: "luis", tipo: TipoMovimientoPuntos.BONIFICACION, puntos: 40 },
    ]);

    expect(totals.get("ana")).toEqual({ puntosObtenidos: 15, movimientos: 2 });
    expect(totals.get("luis")).toEqual({ puntosObtenidos: 40, movimientos: 1 });
  });
});

describe("PointsReportsService", () => {
  let service: PointsReportsService;
  let firestore: ReturnType<typeof createFakeFirestore>;

  beforeEach(() => {
    firestore = createFakeFirestore({
      movements: [
        createDoc("usuariosApp/ana/movimientos_puntos/c1", {
          usuarioId: "ana",
          tipo: TipoMovimientoPuntos.CANJE,
          puntos: -20,
          descripcion: "Canje en tienda",
          origen: "tienda",
          referencia: "folio-1",
          saldoNuevo: 80,
          createdAt: ts("2026-08-17T18:00:00.000Z"),
        }),
        createDoc("usuariosApp/luis/movimientos_puntos/b1", {
          usuarioId: "luis",
          tipo: TipoMovimientoPuntos.BONIFICACION,
          puntos: 40,
          descripcion: "Bonificación por Fiera Racha diaria",
          origen: "promo",
          createdAt: ts("2026-08-17T15:34:00.000Z"),
        }),
        createDoc("usuariosApp/ana/movimientos_puntos/b2", {
          usuarioId: "ana",
          tipo: TipoMovimientoPuntos.BONIFICACION,
          puntos: 5,
          createdAt: ts("2026-08-17T16:00:00.000Z"),
        }),
      ],
      users: [
        createDoc("usuariosApp/ana", {
          nombre: "Ana León",
          email: "ana@example.com",
          puntosActuales: 80,
          nivel: "fan",
        }),
        createDoc("usuariosApp/luis", {
          nombre: "Luis",
          email: "luis@example.com",
          puntosActuales: 200,
          nivel: "socio",
        }),
        createDoc("usuariosApp/cero", {
          nombre: "Sin puntos",
          puntosActuales: 0,
        }),
      ],
    });
    service = new PointsReportsService(firestore as never);
  });

  it("lists redemptions with absolute points and member names", async () => {
    const result = await service.listRedemptions({
      limit: 20,
      from: "2026-08-17",
      to: "2026-08-17",
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      usuarioId: "ana",
      nombre: "Ana León",
      puntos: 20,
      descripcion: "Canje en tienda",
    });
    expect(result.summary.pagePoints).toBe(20);
  });

  it("ranks current balances without exposing users at zero", async () => {
    const result = await service.listTopBalances(10);
    expect(result.items.map((item) => item.usuarioId)).toEqual(["luis", "ana"]);
    expect(result.items[0]?.puntosActuales).toBe(200);
  });

  it("ranks who earned the most points on a Mexico City day", async () => {
    const result = await service.listTopEarners({
      day: "2026-08-17",
      limit: 10,
    });

    expect(result.items[0]).toMatchObject({
      usuarioId: "luis",
      puntosObtenidos: 40,
    });
    expect(result.items[1]).toMatchObject({
      usuarioId: "ana",
      puntosObtenidos: 5,
    });
    expect(result.summary.totalPuntos).toBe(45);
    expect(result.summary.usuarios).toBe(2);
    expect(result.summary.truncated).toBe(false);
  });

  it("pages through the whole day so a late earner is not dropped", async () => {
    const movements = Array.from({ length: 5 }, (_, index) =>
      createDoc(`usuariosApp/u${index}/movimientos_puntos/early${index}`, {
        usuarioId: `u${index}`,
        tipo: TipoMovimientoPuntos.BONIFICACION,
        puntos: 1,
        createdAt: ts(`2026-08-21T08:0${index}:00.000Z`),
      }),
    );
    movements.push(
      createDoc("usuariosApp/luis/movimientos_puntos/late", {
        usuarioId: "luis",
        tipo: TipoMovimientoPuntos.ACUMULACION,
        puntos: 120,
        createdAt: ts("2026-08-21T20:13:00.000Z"),
      }),
    );
    movements.push(
      createDoc("usuariosApp/ana/movimientos_puntos/canje", {
        usuarioId: "ana",
        tipo: TipoMovimientoPuntos.CANJE,
        puntos: -20,
        createdAt: ts("2026-08-21T19:00:00.000Z"),
      }),
    );

    firestore = createFakeFirestore({
      movements,
      users: [
        createDoc("usuariosApp/luis", {
          nombre: "Luis",
          email: "luis@example.com",
        }),
      ],
    });
    service = new PointsReportsService(firestore as never, {
      scanPageSize: 2,
      maxDayScan: 50,
    });

    const result = await service.listTopEarners({
      day: "2026-08-21",
      limit: 10,
    });

    expect(result.items[0]).toMatchObject({
      usuarioId: "luis",
      puntosObtenidos: 120,
      movimientos: 1,
    });
    expect(result.summary.usuarios).toBe(6);
    expect(result.summary.totalPuntos).toBe(125);
    expect(result.summary.truncated).toBe(false);
  });

  it("keeps recent earners when the day scan hits its safety cap", async () => {
    const movements = Array.from({ length: 4 }, (_, index) =>
      createDoc(`usuariosApp/u${index}/movimientos_puntos/early${index}`, {
        usuarioId: `u${index}`,
        tipo: TipoMovimientoPuntos.BONIFICACION,
        puntos: 1,
        createdAt: ts(`2026-08-21T08:0${index}:00.000Z`),
      }),
    );
    movements.push(
      createDoc("usuariosApp/luis/movimientos_puntos/late", {
        usuarioId: "luis",
        tipo: TipoMovimientoPuntos.ACUMULACION,
        puntos: 120,
        createdAt: ts("2026-08-21T20:13:00.000Z"),
      }),
    );

    firestore = createFakeFirestore({ movements });
    service = new PointsReportsService(firestore as never, {
      scanPageSize: 2,
      maxDayScan: 3,
    });

    const result = await service.listTopEarners({
      day: "2026-08-21",
      limit: 10,
    });

    expect(result.summary.truncated).toBe(true);
    expect(result.items[0]).toMatchObject({
      usuarioId: "luis",
      puntosObtenidos: 120,
    });
  });

  it("retries a transient Firestore error and still ranks the day", async () => {
    firestore = createFakeFirestore({
      movements: [
        createDoc("usuariosApp/luis/movimientos_puntos/late", {
          usuarioId: "luis",
          tipo: TipoMovimientoPuntos.ACUMULACION,
          puntos: 120,
          createdAt: ts("2026-08-21T20:13:00.000Z"),
        }),
      ],
      users: [
        createDoc("usuariosApp/luis", {
          nombre: "Luis",
          email: "luis@example.com",
        }),
      ],
      getFailures: 1,
    });
    service = new PointsReportsService(firestore as never, {
      sleep: async () => undefined,
    });

    const result = await service.listTopEarners({
      day: "2026-08-21",
      limit: 10,
    });

    expect(result.items[0]).toMatchObject({
      usuarioId: "luis",
      puntosObtenidos: 120,
    });
    expect(result.summary.truncated).toBe(false);
  });

  it("returns a partial ranking instead of failing when a later page stays down", async () => {
    const movements = [
      createDoc("usuariosApp/luis/movimientos_puntos/late", {
        usuarioId: "luis",
        tipo: TipoMovimientoPuntos.ACUMULACION,
        puntos: 120,
        createdAt: ts("2026-08-21T20:13:00.000Z"),
      }),
      createDoc("usuariosApp/u0/movimientos_puntos/early0", {
        usuarioId: "u0",
        tipo: TipoMovimientoPuntos.BONIFICACION,
        puntos: 1,
        createdAt: ts("2026-08-21T08:00:00.000Z"),
      }),
      createDoc("usuariosApp/u1/movimientos_puntos/early1", {
        usuarioId: "u1",
        tipo: TipoMovimientoPuntos.BONIFICACION,
        puntos: 1,
        createdAt: ts("2026-08-21T08:01:00.000Z"),
      }),
    ];
    firestore = createFakeFirestore({
      movements,
      failAfterSuccessfulGets: 1,
    });
    service = new PointsReportsService(firestore as never, {
      scanPageSize: 1,
      maxDayScan: 50,
      sleep: async () => undefined,
    });

    const result = await service.listTopEarners({
      day: "2026-08-21",
      limit: 10,
    });

    expect(result.summary.truncated).toBe(true);
    expect(result.items[0]).toMatchObject({
      usuarioId: "luis",
      puntosObtenidos: 120,
    });
  });

  it("stops by time budget with the pages already read", async () => {
    let clock = 0;
    const movements = Array.from({ length: 4 }, (_, index) =>
      createDoc(`usuariosApp/u${index}/movimientos_puntos/m${index}`, {
        usuarioId: `u${index}`,
        tipo: TipoMovimientoPuntos.BONIFICACION,
        puntos: 1,
        createdAt: ts(`2026-08-21T08:0${index}:00.000Z`),
      }),
    );
    movements.push(
      createDoc("usuariosApp/luis/movimientos_puntos/late", {
        usuarioId: "luis",
        tipo: TipoMovimientoPuntos.ACUMULACION,
        puntos: 120,
        createdAt: ts("2026-08-21T20:13:00.000Z"),
      }),
    );
    firestore = createFakeFirestore({ movements });
    service = new PointsReportsService(firestore as never, {
      scanPageSize: 2,
      maxDayScan: 50,
      maxScanMs: 5,
      now: () => {
        clock += 10;
        return clock;
      },
    });

    const result = await service.listTopEarners({
      day: "2026-08-21",
      limit: 10,
    });

    expect(result.summary.truncated).toBe(true);
    expect(result.items[0]).toMatchObject({
      usuarioId: "luis",
      puntosObtenidos: 120,
    });
  });
});

describe("points report authorization", () => {
  it("allows ADMIN and SUPER_ADMIN to read any wallet", () => {
    expect(permissionsForRole(RolUsuario.ADMIN)).toContain(
      LoyaltyPermission.WALLET_READ_ANY,
    );
    expect(permissionsForRole(RolUsuario.SUPER_ADMIN)).toContain(
      LoyaltyPermission.WALLET_READ_ANY,
    );
  });

  it("keeps EMPLEADO out of global point reports", () => {
    expect(permissionsForRole(RolUsuario.EMPLEADO)).not.toContain(
      LoyaltyPermission.WALLET_READ_ANY,
    );
    expect(permissionsForRole(RolUsuario.CLIENTE)).not.toContain(
      LoyaltyPermission.WALLET_READ_ANY,
    );
  });
});
