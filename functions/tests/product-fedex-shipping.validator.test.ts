import {
  createProductSchema,
  updateProductSchema,
} from "../src/middleware/validators/product.validator";

const baseProduct = {
  clave: "TARRO-001",
  descripcion: "Tarro grande",
  lineaId: "linea_1",
  categoriaId: "categoria_1",
  precioPublico: 250,
  precioCompra: 100,
  existencias: 5,
  proveedorId: "proveedor_1",
};

describe("product FedEx shipping validators", () => {
  it("allows fedexShipping on product create", () => {
    const parsed = createProductSchema.parse({
      ...baseProduct,
      fedexShipping: {
        enabled: true,
        weightKg: 0.9,
        lengthCm: 20,
        widthCm: 20,
        heightCm: 20,
      },
    });

    expect(parsed.fedexShipping).toMatchObject({
      enabled: true,
      weightKg: 0.9,
      packageType: "YOUR_PACKAGING",
    });
  });

  it("allows fedexShipping on product update", () => {
    const parsed = updateProductSchema.parse({
      fedexShipping: {
        enabled: true,
        weightKg: 1,
        lengthCm: 30,
        widthCm: 25,
        heightCm: 10,
      },
    });

    expect(parsed.fedexShipping?.heightCm).toBe(10);
  });
});
