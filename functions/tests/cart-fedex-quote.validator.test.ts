import { createCartFedexQuoteSchema } from "../src/middleware/validators/carrito.validator";

const direccionEnvio = {
  nombre: "Juan Perez",
  telefono: "4771234567",
  calle: "BOULEVARD PUMA",
  numero: "102",
  numeroInterior: "202",
  colonia: "Lomas de Echeveste",
  ciudad: "Leon de los Aldama",
  estado: "Guanajuato",
  codigoPostal: "37208",
};

describe("createCartFedexQuoteSchema", () => {
  it("accepts the legacy payload with direccionEnvio only", () => {
    const parsed = createCartFedexQuoteSchema.parse({ direccionEnvio });

    expect(parsed.direccionEnvio?.estado).toBe("Guanajuato");
  });

  it("accepts new FedEx and checkout address fields", () => {
    const parsed = createCartFedexQuoteSchema.parse({
      direccionEnvio: {
        ...direccionEnvio,
        stateOrProvinceCode: "GT",
        countryCode: "MX",
        postalCode: "37208",
      },
      shippingAddress: {
        streetLines: ["BOULEVARD PUMA 102"],
        city: "Leon de los Aldama",
        stateOrProvinceCode: "GT",
        postalCode: "37208",
        countryCode: "MX",
        residential: true,
      },
      fedexAddress: {
        streetLines: ["BOULEVARD PUMA 102", "Lomas de Echeveste Int 202"],
        city: "Leon de los Aldama",
        stateOrProvinceCode: "GT",
        postalCode: "37208",
        countryCode: "MX",
        residential: true,
      },
    });

    expect(parsed.fedexAddress?.stateOrProvinceCode).toBe("GT");
    expect(parsed.shippingAddress?.postalCode).toBe("37208");
    expect(parsed.direccionEnvio?.countryCode).toBe("MX");
  });

  it("requires at least one shipping address source", () => {
    expect(() => createCartFedexQuoteSchema.parse({})).toThrow(
      "SHIPPING_ADDRESS_REQUIRED",
    );
  });
});
