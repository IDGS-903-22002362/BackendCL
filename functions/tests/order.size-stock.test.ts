type DocData = Record<string, any>;

let dbState: Record<string, Record<string, DocData>>;
let autoIdCounter = 0;

const registerMovementMock = jest.fn();

jest.mock("../src/services/inventory.service", () => ({
  __esModule: true,
  default: {
    registerMovement: (...args: unknown[]) => registerMovementMock(...args),
  },
}));

jest.mock("../src/config/firebase", () => ({
  firestoreTienda: {
    collection: (name: string) => ({
      doc: (id: string) => ({
        async get() {
          const data = dbState[name]?.[id];
          return {
            exists: !!data,
            id,
            data: () => (data ? { ...data } : undefined),
          };
        },
      }),
      async add(data: DocData) {
        autoIdCounter += 1;
        const id = `auto_${autoIdCounter}`;
        dbState[name] = {
          ...(dbState[name] ?? {}),
          [id]: { ...data },
        };
        return {
          id,
          async delete() {
            const collection = dbState[name] ?? {};
            const updated = { ...collection };
            delete updated[id];
            dbState[name] = updated;
          },
        };
      },
    }),
  },
}));

jest.mock("../src/config/firebase.admin", () => ({
  admin: {
    firestore: {
      Timestamp: {
        now: () => new Date("2026-03-09T10:00:00.000Z"),
      },
    },
  },
}));

import ordenService from "../src/services/orden.service";
import { MetodoPago } from "../src/models/orden.model";

describe("Order service size-aware stock validation", () => {
  beforeEach(() => {
    registerMovementMock.mockReset();
    registerMovementMock.mockResolvedValue({});
    autoIdCounter = 0;

    dbState = {
      productos: {
        jersey_1: {
          clave: "JER-1",
          descripcion: "Jersey Local",
          precioPublico: 1200,
          existencias: 40,
          tallaIds: ["s", "m", "l"],
          inventarioPorTalla: [
            { tallaId: "s", cantidad: 2 },
            { tallaId: "m", cantidad: 5 },
            { tallaId: "l", cantidad: 1 },
          ],
          activo: true,
        },
        balon_1: {
          clave: "BAL-1",
          descripcion: "Balón Oficial",
          precioPublico: 700,
          existencias: 10,
          tallaIds: [],
          inventarioPorTalla: [],
          activo: true,
        },
      },
      ordenes: {},
    };
  });

  it("rechaza orden sin talla para producto con tallaIds", async () => {
    await expect(
      ordenService.createOrden({
        usuarioId: "user_1",
        items: [
          {
            productoId: "jersey_1",
            cantidad: 1,
            precioUnitario: 1200,
            subtotal: 1200,
          },
        ],
        subtotal: 1200,
        impuestos: 0,
        total: 1200,
        direccionEnvio: {
          nombre: "Juan Perez",
          telefono: "4771234567",
          calle: "Av. Principal",
          numero: "1",
          colonia: "Centro",
          ciudad: "Leon",
          estado: "Guanajuato",
          codigoPostal: "37000",
        },
        metodoPago: MetodoPago.TARJETA,
      }),
    ).rejects.toThrow("Se requiere tallaId");

    expect(Object.keys(dbState.ordenes)).toHaveLength(0);
    expect(registerMovementMock).not.toHaveBeenCalled();
  });

  it("rechaza orden cuando la talla no tiene stock suficiente", async () => {
    await expect(
      ordenService.createOrden({
        usuarioId: "user_1",
        items: [
          {
            productoId: "jersey_1",
            tallaId: "l",
            cantidad: 3,
            precioUnitario: 1200,
            subtotal: 3600,
          },
        ],
        subtotal: 3600,
        impuestos: 0,
        total: 3600,
        direccionEnvio: {
          nombre: "Juan Perez",
          telefono: "4771234567",
          calle: "Av. Principal",
          numero: "1",
          colonia: "Centro",
          ciudad: "Leon",
          estado: "Guanajuato",
          codigoPostal: "37000",
        },
        metodoPago: MetodoPago.TARJETA,
      }),
    ).rejects.toThrow("Stock insuficiente");

    expect(Object.keys(dbState.ordenes)).toHaveLength(0);
    expect(registerMovementMock).not.toHaveBeenCalled();
  });

  it("rechaza talla en producto sin inventario por talla", async () => {
    await expect(
      ordenService.createOrden({
        usuarioId: "user_1",
        items: [
          {
            productoId: "balon_1",
            tallaId: "m",
            cantidad: 1,
            precioUnitario: 700,
            subtotal: 700,
          },
        ],
        subtotal: 700,
        impuestos: 0,
        total: 700,
        direccionEnvio: {
          nombre: "Juan Perez",
          telefono: "4771234567",
          calle: "Av. Principal",
          numero: "1",
          colonia: "Centro",
          ciudad: "Leon",
          estado: "Guanajuato",
          codigoPostal: "37000",
        },
        metodoPago: MetodoPago.TARJETA,
      }),
    ).rejects.toThrow("no maneja inventario por talla");
  });
});
