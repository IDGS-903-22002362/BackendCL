import conversationStateService from "../src/services/ai/session/conversation-state.service";

describe("conversation state service", () => {
  it("persiste filtros y productos recientes a partir de tools", () => {
    const result = conversationStateService.merge({
      previous: {
        currentIntent: "product_search",
      },
      normalized: {
        originalText: "quiero la negra",
        normalizedText: "quiero la negra",
        tokens: ["quiero", "la", "negra"],
        filters: { colors: ["negro"] },
        references: [],
        topics: [],
        asksForRecommendation: false,
        asksForComparison: false,
        asksForStoreLocation: false,
        mentionsImage: false,
      },
      sessionUpdates: {
        currentIntent: "product_search",
      },
      toolOutputs: [
        {
          toolName: "search_products",
          output: {
            products: [
              {
                id: "prod_negra",
                descripcion: "Sudadera Negra",
                canonicalLink: "https://clubleon.mx/productos/prod_negra",
              },
            ],
          },
        },
      ],
    });

    expect(result.activeFilters?.colors).toEqual(["negro"]);
    expect(result.recentProducts?.[0]).toMatchObject({
      productId: "prod_negra",
    });
    expect(result.lastResolvedProductId).toBe("prod_negra");
  });
});
