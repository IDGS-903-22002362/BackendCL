type RootState = {
  productos: Record<string, Record<string, unknown>>;
  detalles: Record<string, Record<string, Record<string, unknown>>>;
};

let state: RootState;
let autoId = 0;

const createDetalleDocRef = (productoId: string, detalleId: string) => ({
  id: detalleId,
  async get() {
    const data = state.detalles[productoId]?.[detalleId];
    return {
      exists: !!data,
      id: detalleId,
      data: () => (data ? { ...data } : undefined),
    };
  },
  async update(patch: Record<string, unknown>) {
    const current = state.detalles[productoId]?.[detalleId];
    if (!current) {
      throw new Error("Detalle no encontrado");
    }

    state.detalles[productoId] = {
      ...(state.detalles[productoId] ?? {}),
      [detalleId]: {
        ...current,
        ...patch,
      },
    };
  },
});

const createProductoDocRef = (productoId: string) => ({
  id: productoId,
  async get() {
    const data = state.productos[productoId];
    return {
      exists: !!data,
      id: productoId,
      data: () => (data ? { ...data } : undefined),
    };
  },
  async update(patch: Record<string, unknown>) {
    const current = state.productos[productoId];
    if (!current) {
      throw new Error("Producto no encontrado");
    }

    state.productos = {
      ...state.productos,
      [productoId]: {
        ...current,
        ...patch,
      },
    };
  },
  collection: (name: string) => {
    if (name !== "detalles") {
      throw new Error(`Unsupported subcollection ${name}`);
    }

    return {
      doc: (detalleId?: string) => {
        const resolvedId = detalleId ?? `det_${++autoId}`;
        return {
          ...createDetalleDocRef(productoId, resolvedId),
          async set(data: Record<string, unknown>) {
            state.detalles[productoId] = {
              ...(state.detalles[productoId] ?? {}),
              [resolvedId]: { ...data },
            };
          },
          async delete() {
            const current = state.detalles[productoId] ?? {};
            const nextDetalles = { ...current };
            delete nextDetalles[resolvedId];
            state.detalles[productoId] = nextDetalles;
          },
        };
      },
      orderBy: () => ({
        async get() {
          const detalles = Object.entries(state.detalles[productoId] ?? {}).map(
            ([id, data]) => ({
              id,
              data: () => ({ ...data }),
            }),
          );

          return { docs: detalles };
        },
      }),
    };
  },
});

jest.mock("../src/config/firebase", () => ({
  firestoreTienda: {
    collection: (name: string) => {
      if (name !== "productos") {
        throw new Error(`Unsupported collection ${name}`);
      }

      return {
        doc: (id: string) => createProductoDocRef(id),
      };
    },
    runTransaction: async (
      callback: (transaction: {
        get: (ref: { get: () => Promise<unknown> }) => Promise<unknown>;
        set: (ref: { set: (data: Record<string, unknown>) => Promise<void> }, data: Record<string, unknown>) => Promise<void>;
        update: (ref: { update: (patch: Record<string, unknown>) => Promise<void> }, patch: Record<string, unknown>) => Promise<void>;
        delete: (ref: { delete: () => Promise<void> }) => Promise<void>;
      }) => Promise<unknown>,
    ) =>
      callback({
        get: async (ref) => ref.get(),
        set: async (ref, data) => ref.set(data),
        update: async (ref, patch) => ref.update(patch),
        delete: async (ref) => ref.delete(),
      }),
  },
}));

jest.mock("../src/config/firebase.admin", () => ({
  admin: {
    firestore: {
      Timestamp: {
        now: () => "ts-now",
      },
    },
  },
}));

import detalleProductoService from "../src/services/detalleProducto.service";

describe("detalleProducto.service", () => {
  beforeEach(() => {
    autoId = 0;
    state = {
      productos: {
        prod_1: {
          descripcion: "Jersey Oficial",
          activo: true,
          detalleIds: ["det_legacy"],
        },
      },
      detalles: {
        prod_1: {
          det_legacy: {
            descripcion: "Detalle anterior",
            productoId: "prod_1",
            createdAt: "ts-legacy",
            updatedAt: "ts-legacy",
          },
        },
      },
    };
  });

  it("falla al listar detalles de un producto inexistente", async () => {
    await expect(detalleProductoService.getDetallesByProducto("missing")).rejects.toEqual(
      expect.objectContaining({
        code: "NOT_FOUND",
      }),
    );
  });

  it("crea detalle y sincroniza detalleIds", async () => {
    const result = await detalleProductoService.createDetalle("prod_1", {
      descripcion: "Nueva tela dry-fit",
    });

    expect(result).toMatchObject({
      id: "det_1",
      descripcion: "Nueva tela dry-fit",
      productoId: "prod_1",
    });
    expect(state.productos.prod_1.detalleIds).toEqual(["det_legacy", "det_1"]);
    expect(state.detalles.prod_1.det_1).toMatchObject({
      descripcion: "Nueva tela dry-fit",
      productoId: "prod_1",
    });
  });

  it("update conserva pertenencia al producto correcto", async () => {
    state.detalles.prod_1.det_wrong = {
      descripcion: "Otro detalle",
      productoId: "prod_2",
    };

    await expect(
      detalleProductoService.updateDetalle("prod_1", "det_wrong", {
        descripcion: "Cambio invalido",
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        code: "CONFLICT",
      }),
    );
  });

  it("delete elimina detalle y limpia detalleIds", async () => {
    await detalleProductoService.deleteDetalle("prod_1", "det_legacy");

    expect(state.productos.prod_1.detalleIds).toEqual([]);
    expect(state.detalles.prod_1.det_legacy).toBeUndefined();
  });

  it("delete repara inconsistencia cuando detalleIds no contenia el detalle", async () => {
    state.productos.prod_1.detalleIds = [];

    await detalleProductoService.deleteDetalle("prod_1", "det_legacy");

    expect(state.productos.prod_1.detalleIds).toEqual([]);
    expect(state.detalles.prod_1.det_legacy).toBeUndefined();
  });
});
