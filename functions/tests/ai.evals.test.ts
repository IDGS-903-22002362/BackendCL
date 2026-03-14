import chatNormalizerService from "../src/services/ai/nlu/chat-normalizer.service";

describe("AI business eval fixtures", () => {
  it.each([
    {
      input: "que playeras tienes",
      expectedCategory: "jersey",
    },
    {
      input: "tienes jersey de local",
      expectedCategory: "jersey",
    },
    {
      input: "hay talla mediana",
      expectedSize: "m",
    },
    {
      input: "que promociones hay",
      expectedTopic: "promotions",
    },
    {
      input: "aceptan cambios",
      expectedTopic: "returns",
    },
  ])("normaliza caso de negocio: $input", ({ input, expectedCategory, expectedSize, expectedTopic }) => {
    const result = chatNormalizerService.normalize(input);

    if (expectedCategory) {
      expect(result.filters.categoryIds).toContain(expectedCategory);
    }

    if (expectedSize) {
      expect(result.filters.sizeIds).toContain(expectedSize);
    }

    if (expectedTopic) {
      expect(result.topics).toContain(expectedTopic);
    }
  });
});
