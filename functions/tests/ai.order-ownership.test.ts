type DocData = Record<string, unknown>;

let orders: Record<string, DocData>;

jest.mock("../src/config/firebase", () => ({
  firestoreTienda: {
    collection: (name: string) => ({
      doc: (id: string) => ({
        async get() {
          const data = name === "ordenes" ? orders[id] : undefined;
          return {
            exists: Boolean(data),
            id,
            data: () => data,
          };
        },
      }),
    }),
  },
}));

jest.mock("../src/config/app.firebase", () => ({
  firestoreApp: {},
}));

jest.mock("../src/config/firebase.admin", () => ({
  admin: {
    firestore: {
      Timestamp: {
        now: () => new Date("2026-07-17T12:00:00.000Z"),
      },
    },
  },
}));

import ordenService from "../src/services/orden.service";
import { EstadoOrden } from "../src/models/orden.model";
import { RolUsuario } from "../src/models/usuario.model";

describe("AI order lookup ownership", () => {
  beforeEach(() => {
    const timestamp = new Date("2026-07-17T10:00:00.000Z");
    orders = {
      "order-user-2": {
        usuarioId: "user-2",
        estado: EstadoOrden.PENDIENTE,
        total: 1599,
        metodoPago: "stripe",
        direccionEnvio: { telefono: "4771234567" },
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    };
  });

  it("no usa el telefono del request como prueba de propiedad entre dos usuarios", async () => {
    await expect(
      ordenService.getOrderStatusForAssistant({
        orderId: "order-user-2",
        authUser: { uid: "user-1", rol: RolUsuario.CLIENTE },
        phone: "4771234567",
      }),
    ).resolves.toBeNull();
  });

  it("devuelve el mismo resultado para pedido ajeno e inexistente", async () => {
    const foreign = await ordenService.getOrderStatusForAssistant({
      orderId: "order-user-2",
      authUser: { uid: "user-1", rol: RolUsuario.CLIENTE },
    });
    const missing = await ordenService.getOrderStatusForAssistant({
      orderId: "missing-order",
      authUser: { uid: "user-1", rol: RolUsuario.CLIENTE },
    });

    expect(foreign).toBeNull();
    expect(missing).toBeNull();
  });

  it("permite al propietario y al rol ADMIN real", async () => {
    const owner = await ordenService.getOrderStatusForAssistant({
      orderId: "order-user-2",
      authUser: { uid: "user-2", rol: RolUsuario.CLIENTE },
    });
    const admin = await ordenService.getOrderStatusForAssistant({
      orderId: "order-user-2",
      authUser: { uid: "admin-1", rol: RolUsuario.ADMIN },
    });

    expect(owner).toMatchObject({ orderId: "order-user-2", total: 1599 });
    expect(admin).toMatchObject({ orderId: "order-user-2", total: 1599 });
  });
});
