import chatNormalizerService from "../src/services/ai/nlu/chat-normalizer.service";

describe("chat normalizer", () => {
  it("mapea sinonimos de jersey, color y talla a filtros deterministas", () => {
    const result = chatNormalizerService.normalize(
      "que playeras negras tienes en mediana para mujer",
    );

    expect(result.filters.categoryIds).toContain("jersey");
    expect(result.filters.colors).toContain("negro");
    expect(result.filters.sizeIds).toContain("m");
    expect(result.filters.audience).toContain("dama");
  });

  it("resuelve referencias de contexto como la primera", () => {
    const result = chatNormalizerService.normalize("y la primera en l", {
      recentProducts: [{ productId: "prod_1" }],
    });

    expect(result.references[0]).toMatchObject({
      type: "product",
      resolvedId: "prod_1",
    });
    expect(result.filters.sizeIds).toContain("l");
  });
});
