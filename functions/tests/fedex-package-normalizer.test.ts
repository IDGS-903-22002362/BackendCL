import {
  buildFedexPackageLineItemsFromCart,
  FEDEX_PRODUCT_DIMENSIONS_MISSING,
  FEDEX_PRODUCT_LIMITS_EXCEEDED,
  FedexPackageValidationError,
  normalizeProductForFedex,
} from "../src/modules/shipping/fedex/fedex-package-normalizer";

const originalEnv = { ...process.env };

const product = (overrides: Record<string, unknown> = {}) => ({
  productId: "prod_1",
  name: "Tarro grande",
  quantity: 1,
  rawProduct: {
    descripcion: "Tarro grande",
    categoriaId: "tarros",
    ...overrides,
  },
});

describe("FedEx package normalizer", () => {
  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.FEDEX_ENV = "sandbox";
    delete process.env.FEDEX_ALLOW_DEFAULT_PACKAGE_DIMENSIONS;
    delete process.env.FEDEX_PACKING_STRATEGY;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("normalizes valid fedexShipping values", () => {
    expect(
      normalizeProductForFedex(
        product({
          fedexShipping: {
            enabled: true,
            weightKg: 1.236,
            lengthCm: 20.1,
            widthCm: 19.2,
            heightCm: 10.01,
          },
        }),
      ),
    ).toEqual({
      weightKg: 1.24,
      lengthCm: 21,
      widthCm: 20,
      heightCm: 11,
      packageType: "YOUR_PACKAGING",
    });
  });

  it("uses Tarro defaults only when enabled", () => {
    process.env.FEDEX_ALLOW_DEFAULT_PACKAGE_DIMENSIONS = "true";

    expect(normalizeProductForFedex(product())).toMatchObject({
      weightKg: 0.9,
      lengthCm: 20,
      widthCm: 20,
      heightCm: 20,
    });
  });

  it("throws a controlled missing dimensions error when defaults are disabled", () => {
    expect(() => normalizeProductForFedex(product())).toThrow(
      FedexPackageValidationError,
    );

    try {
      normalizeProductForFedex(product());
    } catch (error) {
      expect(error).toMatchObject({
        code: FEDEX_PRODUCT_DIMENSIONS_MISSING,
        statusCode: 422,
      });
    }
  });

  it("throws when a package exceeds FedEx limits", () => {
    try {
      normalizeProductForFedex(
        product({
          fedexShipping: {
            weightKg: 69,
            lengthCm: 20,
            widthCm: 20,
            heightCm: 20,
          },
        }),
      );
      throw new Error("Expected normalizeProductForFedex to throw");
    } catch (error) {
      expect(error).toMatchObject({ code: FEDEX_PRODUCT_LIMITS_EXCEEDED });
    }
  });

  it("skips non-shippable products and builds per-unit line items", () => {
    process.env.FEDEX_ALLOW_DEFAULT_PACKAGE_DIMENSIONS = "true";

    const result = buildFedexPackageLineItemsFromCart([
      product({ descripcion: "Tarro grande" }),
      {
        ...product({ fedexShipping: { enabled: false } }),
        productId: "digital_1",
        name: "Digital",
      },
      {
        productId: "gorra_1",
        name: "Gorra",
        quantity: 2,
        rawProduct: { descripcion: "Gorra" },
      },
    ]);

    expect(result.requiresShipping).toBe(true);
    expect(result.packages).toHaveLength(3);
    expect(result.requestedPackageLineItems.map((item) => item.sequenceNumber)).toEqual([
      "1",
      "2",
      "3",
    ]);
    expect(result.requestedPackageLineItems[0].weight.units).toBe("KG");
    expect(result.requestedPackageLineItems[0].dimensions.units).toBe("CM");
  });
});
