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
    gemini: {
      mode: "apiKey",
      provider: "gemini-api",
      apiKey: "test-gemini-key",
    },
    previewMockup: {
      project: "e-comerce-leon",
      region: "us-central1",
      model: "imagen-product-recontext-preview-06-30",
      apiVersion: "v1beta",
      fallbackModel: "gemini-3.1-flash-image",
      fallbackRegion: "us-central1",
      fallbackApiVersion: "v1",
      timeoutMs: 2500,
    },
  },
}));

import { GoogleGenAI } from "@google/genai";
import vertexPreviewMockupAdapter from "../src/services/ai/adapters/vertex-preview-mockup.adapter";
import {
  ProductPreviewMode,
  ProductPreviewType,
} from "../src/models/ai/ai.model";

const accessoryInput = {
  personImage: {
    bytesBase64Encoded: "cGVyc29u",
    mimeType: "image/png",
  },
  productImage: {
    bytesBase64Encoded: "Z29ycmE=",
    mimeType: "image/png",
  },
  previewMode: ProductPreviewMode.ACCESSORY_MOCKUP as const,
  productPreviewType: ProductPreviewType.ACCESSORY,
  productDescription: "Gorra oficial verde",
  categoryName: "Gorra",
  lineName: "Souvenir",
};

describe("Vertex preview mockup adapter", () => {
  const originalProvider = process.env.AI_PREVIEW_MOCKUP_PROVIDER;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.AI_PREVIEW_MOCKUP_PROVIDER;
    mockGenerateContent.mockResolvedValue({
      candidates: [
        {
          content: {
            parts: [
              {
                inlineData: {
                  data: "ZmFrZS1tb2NrdXA=",
                  mimeType: "image/png",
                },
              },
            ],
          },
        },
      ],
    });
  });

  afterAll(() => {
    process.env.AI_PREVIEW_MOCKUP_PROVIDER = originalProvider;
  });

  it("usa Gemini Developer API por defecto y no inicializa Vertex", async () => {
    const result = await vertexPreviewMockupAdapter.generateMockup(accessoryInput);

    expect(mockRecontextImage).not.toHaveBeenCalled();
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    expect(GoogleGenAI).toHaveBeenCalledWith({
      apiKey: "test-gemini-key",
      apiVersion: "v1",
    });
    expect(GoogleGenAI).not.toHaveBeenCalledWith(
      expect.objectContaining({ vertexai: true }),
    );

    const request = mockGenerateContent.mock.calls[0][0];
    expect(request.model).toBe("gemini-3.1-flash-image");
    expect(request.contents[0].parts[0].text).toContain(
      "Si el producto es una gorra, solo puede ir en la cabeza o en la mano.",
    );
    expect(request.contents[0].parts[0].text).toContain(
      "No convertir gorras, calcetas, balones ni souvenirs en camisas o prendas superiores.",
    );
    expect(result).toMatchObject({
      outputImageBytesBase64: "ZmFrZS1tb2NrdXA=",
      mimeType: "image/png",
    });
  });

  it("usa fallback visual seguro para props via Gemini API", async () => {
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

    expect(mockRecontextImage).not.toHaveBeenCalled();
    const request = mockGenerateContent.mock.calls[0][0];
    expect(request.contents[0].parts[0].text).toContain(
      "Si el producto es un balon o souvenir, solo debe ir en las manos, junto al cuerpo o en una escena cercana realista.",
    );
  });

  it("solo usa Vertex Imagen si AI_PREVIEW_MOCKUP_PROVIDER=vertex", async () => {
    process.env.AI_PREVIEW_MOCKUP_PROVIDER = "vertex";
    mockRecontextImage.mockResolvedValue({
      generatedImages: [
        {
          image: {
            imageBytes: "dmVydGV4LW1vY2t1cA==",
            mimeType: "image/png",
          },
        },
      ],
    });

    const result = await vertexPreviewMockupAdapter.generateMockup(accessoryInput);

    expect(mockRecontextImage).toHaveBeenCalledTimes(1);
    expect(GoogleGenAI).toHaveBeenCalledWith(
      expect.objectContaining({ vertexai: true }),
    );
    expect(result.outputImageBytesBase64).toBe("dmVydGV4LW1vY2t1cA==");
  });
});
