type DocData = Record<string, any>;

let dbState: Record<string, Record<string, DocData>>;
let autoIdCounter = 0;

jest.mock("../src/config/firebase", () => ({
  firestoreTienda: {
    collection: (name: string) => ({
      doc: (id: string) => ({
        id,
        async get() {
          const data = dbState[name]?.[id];
          return {
            exists: !!data,
            id,
            data: () => (data ? { ...data } : undefined),
          };
        },
        async set(data: DocData, opts?: { merge?: boolean }) {
          dbState[name] = dbState[name] || {};
          dbState[name][id] =
            opts?.merge && dbState[name][id]
              ? { ...dbState[name][id], ...data }
              : { ...data };
        },
      }),
      async add(data: DocData) {
        autoIdCounter += 1;
        const id = `auto_${autoIdCounter}`;
        dbState[name] = {
          ...(dbState[name] ?? {}),
          [id]: { ...data },
        };
        return { id };
      },
      where(field: string, op: string, value: unknown) {
        const filters = [{ field, op, value }];
        const query = {
          where(nextField: string, nextOp: string, nextValue: unknown) {
            filters.push({ field: nextField, op: nextOp, value: nextValue });
            return query;
          },
          async get() {
            const docs = Object.entries(dbState[name] ?? {})
              .filter(([, data]) =>
                filters.every((filter) => data[filter.field] === filter.value),
              )
              .map(([id, data]) => ({
                id,
                data: () => ({ ...data }),
              }));
            return { docs, empty: docs.length === 0 };
          },
        };
        return query;
      },
    }),
  },
}));

jest.mock("../src/config/firebase.admin", () => ({
  admin: {
    firestore: {
      Timestamp: {
        now: () => new Date("2026-05-11T10:00:00.000Z"),
      },
    },
  },
}));

import pickupLocationService from "../src/services/pickup-location.service";

describe("PickupLocationService", () => {
  beforeEach(() => {
    autoIdCounter = 0;
    dbState = {
      pickupLocations: {
        loc_active: {
          name: "Tienda Estadio",
          address: "Blvd. Principal 1",
          city: "Leon",
          state: "Guanajuato",
          postalCode: "37000",
          country: "MX",
          active: true,
          pickupEnabled: true,
        },
        loc_disabled: {
          name: "Tienda Cerrada",
          address: "Calle 2",
          city: "Leon",
          state: "Guanajuato",
          postalCode: "37000",
          country: "MX",
          active: false,
          pickupEnabled: true,
        },
      },
      carritos: {
        cart_1: {
          items: [
            { productoId: "global_1", cantidad: 2 },
            { productoId: "jersey_1", tallaId: "m", cantidad: 1 },
          ],
        },
      },
      productos: {
        global_1: {
          descripcion: "Balon",
          activo: true,
          existencias: 4,
          tallaIds: [],
          inventarioPorTalla: [],
        },
        jersey_1: {
          descripcion: "Jersey",
          activo: true,
          existencias: 10,
          tallaIds: ["s", "m"],
          inventarioPorTalla: [
            { tallaId: "s", cantidad: 0 },
            { tallaId: "m", cantidad: 1 },
          ],
        },
      },
    };
  });

  it("lista solo sucursales activas con pickup habilitado", async () => {
    const locations = await pickupLocationService.listPublic();

    expect(locations).toHaveLength(1);
    expect(locations[0].id).toBe("loc_active");
  });

  it("valida disponibilidad con inventario global y por talla", async () => {
    const result = await pickupLocationService.validateCartAvailability(
      "loc_active",
      "cart_1",
    );

    expect(result.canPickup).toBe(true);
    expect(result.inventoryScope).toBe("global");
    expect(result.availableItems).toHaveLength(2);
    expect(result.unavailableItems).toHaveLength(0);
  });

  it("rechaza sucursal inactiva", async () => {
    await expect(
      pickupLocationService.validateCartAvailability("loc_disabled", "cart_1"),
    ).rejects.toThrow("inactiva");
  });
});
