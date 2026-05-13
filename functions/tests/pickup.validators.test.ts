import { checkoutCarritoSchema } from "../src/middleware/validators/carrito.validator";
import { createOrdenSchema } from "../src/middleware/validators/orden.validator";
import { FulfillmentMethod, MetodoPago } from "../src/models/orden.model";

const deliveryAddress = {
  nombre: "Juan Perez",
  telefono: "4771234567",
  calle: "Av. Principal",
  numero: "1",
  colonia: "Centro",
  ciudad: "Leon",
  estado: "Guanajuato",
  codigoPostal: "37000",
};

describe("pickup fulfillment validators", () => {
  it("mantiene DELIVERY como default y exige direccion de envio", () => {
    const result = checkoutCarritoSchema.safeParse({
      metodoPago: MetodoPago.TARJETA,
    });

    expect(result.success).toBe(false);
    expect(result.success ? "" : result.error.issues[0].path.join(".")).toBe(
      "direccionEnvio",
    );
  });

  it("acepta checkout PICKUP con sucursal/contacto y sin direccion", () => {
    const result = checkoutCarritoSchema.safeParse({
      fulfillmentMethod: FulfillmentMethod.PICKUP,
      pickupLocationId: "loc_1",
      pickupContact: {
        name: "Juan Perez",
        phone: "4771234567",
        email: "juan@example.com",
      },
      metodoPago: MetodoPago.TARJETA,
    });

    expect(result.success).toBe(true);
  });

  it("rechaza costo de envio positivo en PICKUP", () => {
    const result = createOrdenSchema.safeParse({
      usuarioId: "user_1",
      fulfillmentMethod: FulfillmentMethod.PICKUP,
      pickupLocationId: "loc_1",
      pickupContact: { name: "Juan Perez" },
      items: [
        {
          productoId: "prod_1",
          cantidad: 1,
          precioUnitario: 100,
          subtotal: 100,
        },
      ],
      subtotal: 100,
      impuestos: 0,
      total: 100,
      metodoPago: MetodoPago.TARJETA,
      costoEnvio: 10,
    });

    expect(result.success).toBe(false);
    expect(result.success ? "" : result.error.issues[0].path.join(".")).toBe(
      "costoEnvio",
    );
  });

  it("acepta DELIVERY explicito con direccion", () => {
    const result = checkoutCarritoSchema.safeParse({
      fulfillmentMethod: FulfillmentMethod.DELIVERY,
      direccionEnvio: deliveryAddress,
      metodoPago: MetodoPago.APLAZO,
      costoEnvio: 99,
    });

    expect(result.success).toBe(true);
  });
});
