describe("AI product link service", () => {
  const originalBaseUrl = process.env.STORE_PUBLIC_BASE_URL;
  const originalTemplate = process.env.STORE_PRODUCT_PATH_TEMPLATE;

  afterEach(() => {
    process.env.STORE_PUBLIC_BASE_URL = originalBaseUrl;
    process.env.STORE_PRODUCT_PATH_TEMPLATE = originalTemplate;
    jest.resetModules();
  });

  it("usa slug cuando el producto lo tiene", async () => {
    process.env.STORE_PUBLIC_BASE_URL = "https://tienda.clubleon.mx/";
    process.env.STORE_PRODUCT_PATH_TEMPLATE = "/producto/:slug";
    jest.resetModules();

    const { default: productLinkService } = await import(
      "../src/services/ai/knowledge/product-link.service"
    );

    expect(
      productLinkService.buildProductLink({
        id: "prod_1",
        slug: "jersey-local-2026",
      }),
    ).toBe(
      "https://tienda.clubleon.mx/producto/jersey-local-2026",
    );
  });

  it("cae a id cuando no existe slug", async () => {
    process.env.STORE_PUBLIC_BASE_URL = "https://tienda.clubleon.mx/";
    process.env.STORE_PRODUCT_PATH_TEMPLATE = "/producto/:slug";
    jest.resetModules();

    const { default: productLinkService } = await import(
      "../src/services/ai/knowledge/product-link.service"
    );

    expect(productLinkService.buildProductLink("prod_123")).toBe(
      "https://tienda.clubleon.mx/producto/prod_123",
    );
  });

  it("devuelve null si no existe base publica configurada", async () => {
    delete process.env.STORE_PUBLIC_BASE_URL;
    jest.resetModules();

    const { default: productLinkService } = await import(
      "../src/services/ai/knowledge/product-link.service"
    );

    expect(productLinkService.buildProductLink("prod_1")).toBeNull();
  });
});
