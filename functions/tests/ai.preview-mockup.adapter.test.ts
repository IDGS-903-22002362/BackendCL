const mockRecontextImage = jest.fn();
const mockGenerateContent = jest.fn();

jest.mock("@google/genai", () => ({
  GoogleGenAI: jest.fn().mockImplementation(() => ({
    models: {
      recontextImage: mockRecontextImage,
      generateContent: mockGenerateContent,
    },
  })),
  Modality: {
    IMAGE: "IMAGE",
  },
  PersonGeneration: {
    ALLOW_ADULT: "ALLOW_ADULT",
  },
  SafetyFilterLevel: {
    BLOCK_ONLY_HIGH: "BLOCK_ONLY_HIGH",
  },
}));

jest.mock("../src/config/ai.config", () => ({
  __esModule: true,
  default: {
    previewMockup: {
      project: "e-comerce-leon",
      region: "us-central1",
      model: "imagen-product-recontext-preview-06-30",
      apiVersion: "v1beta",
      fallbackModel: "gemini-2.5-flash-image",
      fallbackRegion: "global",
      fallbackApiVersion: "v1",
      timeoutMs: 2500,
    },
  },
}));

import vertexPreviewMockupAdapter from "../src/services/ai/adapters/vertex-preview-mockup.adapter";
import {
  ProductPreviewMode,
  ProductPreviewType,
} from "../src/models/ai/ai.model";

describe("Vertex preview mockup adapter", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("incluye guardrails para gorra y extrae bytes base64", async () => {
    mockRecontextImage.mockResolvedValue({
      generatedImages: [
        {
          image: {
            imageBytes: "ZmFrZS1tb2NrdXA=",
            mimeType: "image/png",
          },
        },
      ],
    });

    const result = await vertexPreviewMockupAdapter.generateMockup({
      personImage: {
        bytesBase64Encoded: "cGVyc29u",
        mimeType: "image/png",
      },
      productImage: {
        bytesBase64Encoded: "Z29ycmE=",
        mimeType: "image/png",
      },
      previewMode: ProductPreviewMode.ACCESSORY_MOCKUP,
      productPreviewType: ProductPreviewType.ACCESSORY,
      productDescription: "Gorra oficial verde",
      categoryName: "Gorra",
      lineName: "Souvenir",
    });

    expect(mockRecontextImage).toHaveBeenCalledTimes(1);
    const request = mockRecontextImage.mock.calls[0][0];

    expect(request.model).toBe("imagen-product-recontext-preview-06-30");
    expect(request.source.prompt).toContain("Si es gorra, solo puede aparecer en la cabeza o en la mano.");
    expect(request.source.prompt).toContain("No convertir gorras, calcetas, balones ni souvenirs en camisas o prendas superiores.");
    expect(result).toMatchObject({
      outputImageBytesBase64: "ZmFrZS1tb2NrdXA=",
      mimeType: "image/png",
    });
  });

  it("usa fallback visual seguro para props", async () => {
    mockRecontextImage.mockResolvedValue({
      generatedImages: [
        {
          image: {
            imageBytes: "cHJvcC1tb2NrdXA=",
            mimeType: "image/png",
          },
        },
      ],
    });

    await vertexPreviewMockupAdapter.generateMockup({
      personImage: {
        bytesBase64Encoded: "cGVyc29u",
        mimeType: "image/png",
      },
      productImage: {
        bytesBase64Encoded: "YmFsb24=",
        mimeType: "image/png",
      },
      previewMode: ProductPreviewMode.PROP_MOCKUP,
      productPreviewType: ProductPreviewType.PROP,
      productDescription: "Balón oficial",
      categoryName: "Balón",
      lineName: "Souvenir",
    });

    const request = mockRecontextImage.mock.calls[0][0];
    expect(request.source.prompt).toContain(
      "Si la zona correcta no es visible o no es confiable, colocar el producto junto a la persona o en su mano.",
    );
    expect(request.source.prompt).toContain(
      "Si es balon o souvenir, solo puede aparecer en las manos, junto al cuerpo o en una escena cercana y realista.",
    );
  });

  it("usa Gemini Image como fallback cuando recontext no esta disponible", async () => {
    mockRecontextImage.mockRejectedValue({
      status: 404,
      message:
        "Image editing failed with the following error: imagen-product-recontext-preview-06-30 is unavailable.",
    });
    mockGenerateContent.mockResolvedValue({
      candidates: [
        {
          content: {
            parts: [
              {
                inlineData: {
                  data: "ZmFsbGJhY2staW1hZ2U=",
                  mimeType: "image/png",
                },
              },
            ],
          },
        },
      ],
    });

    const result = await vertexPreviewMockupAdapter.generateMockup({
      personImage: {
        bytesBase64Encoded: "cGVyc29u",
        mimeType: "image/png",
      },
      productImage: {
        bytesBase64Encoded: "Z29ycmE=",
        mimeType: "image/png",
      },
      previewMode: ProductPreviewMode.ACCESSORY_MOCKUP,
      productPreviewType: ProductPreviewType.ACCESSORY,
      productDescription: "Gorra oficial verde",
      categoryName: "Gorra",
      lineName: "Souvenir",
    });

    expect(mockRecontextImage).toHaveBeenCalledTimes(1);
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);

    const fallbackRequest = mockGenerateContent.mock.calls[0][0];
    expect(fallbackRequest.model).toBe("gemini-2.5-flash-image");
    expect(fallbackRequest.contents[0].parts[0].text).toContain(
      "La segunda imagen es la foto oficial del producto.",
    );
    expect(fallbackRequest.config.responseModalities).toEqual(["IMAGE"]);
    expect(fallbackRequest.config.imageConfig).toMatchObject({
      aspectRatio: "3:4",
      imageSize: "1K",
      personGeneration: "ALLOW_ADULT",
    });
    expect(fallbackRequest.contents[0].parts).toHaveLength(3);
    expect(fallbackRequest.contents[0].parts[1]).toMatchObject({
      inlineData: {
        data: "cGVyc29u",
        mimeType: "image/png",
      },
    });

    expect(result).toMatchObject({
      outputImageBytesBase64: "ZmFsbGJhY2staW1hZ2U=",
      mimeType: "image/png",
    });
  });
});
