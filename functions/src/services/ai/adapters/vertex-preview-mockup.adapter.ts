import {
  GenerateContentResponse,
  GoogleGenAI,
  Modality,
  PersonGeneration,
  RecontextImageResponse,
  SafetyFilterLevel,
} from "@google/genai";
import aiConfig from "../../../config/ai.config";
import {
  ProductPreviewMode,
  ProductPreviewType,
} from "../../../models/ai/ai.model";
import logger from "../../../utils/logger";

export type VertexPreviewMockupErrorCode =
  | "PRODUCT_PREVIEW_TIMEOUT"
  | "PRODUCT_PREVIEW_INVALID_ARGUMENT"
  | "PRODUCT_PREVIEW_AUTH_FAILED"
  | "PRODUCT_PREVIEW_PERMISSION_DENIED"
  | "PRODUCT_PREVIEW_QUOTA_EXCEEDED"
  | "PRODUCT_PREVIEW_PARSE_ERROR"
  | "PRODUCT_PREVIEW_PROVIDER_ERROR";

export class VertexPreviewMockupError extends Error {
  constructor(
    public readonly code: VertexPreviewMockupErrorCode,
    message: string,
    public readonly status?: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "VertexPreviewMockupError";
  }
}

export interface VertexPreviewMockupImageInput {
  gcsUri?: string;
  bytesBase64Encoded?: string;
  mimeType?: string;
}

export interface VertexPreviewMockupInput {
  personImage: VertexPreviewMockupImageInput;
  productImage: VertexPreviewMockupImageInput;
  previewMode: ProductPreviewMode.ACCESSORY_MOCKUP | ProductPreviewMode.PROP_MOCKUP;
  productPreviewType: ProductPreviewType;
  productDescription?: string;
  categoryName?: string | null;
  lineName?: string | null;
  outputGcsUri?: string;
}

export interface VertexPreviewMockupResult {
  outputImageBytesBase64?: string;
  outputGcsUri?: string;
  mimeType?: string;
  rawResponse: unknown;
}

const mapHttpStatusToCode = (status: number): VertexPreviewMockupErrorCode => {
  if (status === 400) {
    return "PRODUCT_PREVIEW_INVALID_ARGUMENT";
  }

  if (status === 401) {
    return "PRODUCT_PREVIEW_AUTH_FAILED";
  }

  if (status === 403) {
    return "PRODUCT_PREVIEW_PERMISSION_DENIED";
  }

  if (status === 408 || status === 504) {
    return "PRODUCT_PREVIEW_TIMEOUT";
  }

  if (status === 429) {
    return "PRODUCT_PREVIEW_QUOTA_EXCEEDED";
  }

  return "PRODUCT_PREVIEW_PROVIDER_ERROR";
};

const normalizeImageInput = (input: VertexPreviewMockupImageInput) => {
  if (input.gcsUri) {
    return {
      gcsUri: input.gcsUri,
    };
  }

  if (input.bytesBase64Encoded) {
    return {
      imageBytes: input.bytesBase64Encoded,
      mimeType: input.mimeType || "image/png",
    };
  }

  throw new VertexPreviewMockupError(
    "PRODUCT_PREVIEW_INVALID_ARGUMENT",
    "La imagen de entrada para mockup es invalida",
  );
};

const buildPrompt = (input: VertexPreviewMockupInput): string => {
  const sharedRules = [
    "Mantener la identidad facial, tono de piel y postura general de la persona.",
    "Mantener color, forma, logo y proporcion real del producto.",
    "No transformar el producto en otra categoria distinta.",
    "Si la zona correcta no es visible o no es confiable, colocar el producto junto a la persona o en su mano.",
    "No convertir gorras, calcetas, balones ni souvenirs en camisas o prendas superiores.",
  ];

  const modeSpecificRules =
    input.previewMode === ProductPreviewMode.ACCESSORY_MOCKUP
      ? [
          "Si es gorra, solo puede aparecer en la cabeza o en la mano.",
          "Si es calceta, solo puede aparecer en los pies; si los pies no son visibles, mostrar el producto junto a la persona.",
          "La escena debe sentirse como una vista previa de compra realista del accesorio.",
        ]
      : [
          "Si es balon o souvenir, solo puede aparecer en las manos, junto al cuerpo o en una escena cercana y realista.",
          "No vestir el producto sobre el torso, piernas o cabeza salvo que el producto realmente pertenezca a esa zona.",
          "La escena debe sentirse como una vista previa con el producto, no como una prenda puesta.",
        ];

  return [
    "Crea una vista previa realista de e-commerce usando la persona y el producto de referencia.",
    `Tipo de preview: ${input.previewMode}.`,
    `Tipo de producto: ${input.productPreviewType}.`,
    input.productDescription
      ? `Descripcion del producto: ${input.productDescription}.`
      : null,
    input.categoryName ? `Categoria: ${input.categoryName}.` : null,
    input.lineName ? `Linea: ${input.lineName}.` : null,
    "Reglas obligatorias:",
    ...sharedRules.map((rule) => `- ${rule}`),
    ...modeSpecificRules.map((rule) => `- ${rule}`),
  ]
    .filter(Boolean)
    .join("\n");
};

const buildGeminiFallbackPrompt = (input: VertexPreviewMockupInput): string =>
  [
    "La primera imagen es la foto real de la persona cliente.",
    "La segunda imagen es la foto oficial del producto.",
    "Genera una sola imagen final de vista previa realista para e-commerce usando ambas referencias.",
    "Mantener a la misma persona de la primera imagen, sin cambiar su identidad facial, complexión ni pose general salvo ajustes naturales minimos.",
    "Conservar exactamente el color, forma, logo y proporcion del producto de la segunda imagen.",
    "Nunca transformar el producto en otra categoria distinta.",
    "Si la colocacion correcta no es confiable, mostrar el producto junto a la persona o en su mano.",
    "No convertir gorras, calcetas, balones ni souvenirs en camisas o prendas superiores.",
    input.previewMode === ProductPreviewMode.ACCESSORY_MOCKUP
      ? "Si el producto es una gorra, solo puede ir en la cabeza o en la mano. Si es una calceta, solo en los pies; si no se ven, dejarla junto a la persona."
      : "Si el producto es un balon o souvenir, solo debe ir en las manos, junto al cuerpo o en una escena cercana realista.",
    input.productDescription
      ? `Descripcion del producto: ${input.productDescription}.`
      : null,
    input.categoryName ? `Categoria: ${input.categoryName}.` : null,
    input.lineName ? `Linea: ${input.lineName}.` : null,
  ]
    .filter(Boolean)
    .join("\n");

const extractGeneratedImage = (
  response: RecontextImageResponse,
) =>
  response.generatedImages?.find((image) => image.image?.imageBytes || image.image?.gcsUri);

const extractGeminiImage = (response: GenerateContentResponse) => {
  const parts =
    response.candidates?.flatMap((candidate) => candidate.content?.parts || []) || [];

  return parts.find(
    (part) =>
      part.inlineData?.data &&
      typeof part.inlineData.mimeType === "string" &&
      part.inlineData.mimeType.startsWith("image/"),
  );
};

const resolveErrorStatus = (error: unknown): number | undefined => {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }

  const value = Reflect.get(error, "status");
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
};

const resolveErrorMessage = (error: unknown): string =>
  error instanceof Error
    ? error.message
    : typeof error === "object" &&
        error !== null &&
        typeof Reflect.get(error, "message") === "string"
      ? String(Reflect.get(error, "message"))
      : "Error desconocido al generar mockup de preview";

const shouldFallbackToGeminiImage = (error: unknown): boolean => {
  const status = resolveErrorStatus(error);
  const message = resolveErrorMessage(error);

  return (
    status === 404 &&
    /unavailable|not found|not[_ ]found|not available/i.test(message)
  );
};

class VertexPreviewMockupAdapter {
  private readonly baseLogger = logger.child({
    component: "vertex-preview-mockup-adapter",
  });
  private readonly clients = new Map<string, GoogleGenAI>();

  private getClient(location: string, apiVersion?: string): GoogleGenAI {
    const cacheKey = `${location}:${apiVersion || "default"}`;
    const existingClient = this.clients.get(cacheKey);
    if (existingClient) {
      return existingClient;
    }

    const client = new GoogleGenAI({
      vertexai: true,
      project: aiConfig.previewMockup.project,
      location,
      apiVersion,
    });
    this.clients.set(cacheKey, client);

    return client;
  }

  private async runRecontextRequest(
    input: VertexPreviewMockupInput,
    client: GoogleGenAI,
    controller: AbortController,
  ): Promise<VertexPreviewMockupResult> {
    const response = await client.models.recontextImage({
      model: aiConfig.previewMockup.model,
      source: {
        prompt: buildPrompt(input),
        personImage: normalizeImageInput(input.personImage),
        productImages: [{ productImage: normalizeImageInput(input.productImage) }],
      },
      config: {
        abortSignal: controller.signal,
        numberOfImages: 1,
        outputGcsUri: input.outputGcsUri,
        personGeneration: PersonGeneration.ALLOW_ADULT,
        safetyFilterLevel: SafetyFilterLevel.BLOCK_ONLY_HIGH,
        outputMimeType: "image/png",
        addWatermark: true,
        enhancePrompt: true,
      },
    });

    const generatedImage = extractGeneratedImage(response);
    if (!generatedImage?.image?.imageBytes && !generatedImage?.image?.gcsUri) {
      throw new VertexPreviewMockupError(
        "PRODUCT_PREVIEW_PARSE_ERROR",
        "Vertex preview mockup no devolvio una imagen utilizable",
        undefined,
        response,
      );
    }

    return {
      outputImageBytesBase64: generatedImage.image?.imageBytes,
      outputGcsUri: generatedImage.image?.gcsUri,
      mimeType: generatedImage.image?.mimeType,
      rawResponse: response,
    };
  }

  private buildGeminiImagePart(input: VertexPreviewMockupImageInput) {
    if (input.gcsUri) {
      return {
        fileData: {
          fileUri: input.gcsUri,
          mimeType: input.mimeType || "image/png",
        },
      };
    }

    if (input.bytesBase64Encoded) {
      return {
        inlineData: {
          data: input.bytesBase64Encoded,
          mimeType: input.mimeType || "image/png",
        },
      };
    }

    throw new VertexPreviewMockupError(
      "PRODUCT_PREVIEW_INVALID_ARGUMENT",
      "La imagen de entrada para mockup es invalida",
    );
  }

  private async runGeminiImageFallback(
    input: VertexPreviewMockupInput,
    controller: AbortController,
  ): Promise<VertexPreviewMockupResult> {
    const fallbackClient = this.getClient(
      aiConfig.previewMockup.fallbackRegion,
      aiConfig.previewMockup.fallbackApiVersion,
    );
    const response = await fallbackClient.models.generateContent({
      model: aiConfig.previewMockup.fallbackModel,
      contents: [
        {
          role: "user",
          parts: [
            { text: buildGeminiFallbackPrompt(input) },
            this.buildGeminiImagePart(input.personImage),
            this.buildGeminiImagePart(input.productImage),
          ],
        },
      ],
      config: {
        abortSignal: controller.signal,
        responseModalities: [Modality.IMAGE],
        temperature: 0.2,
        imageConfig: {
          aspectRatio: "3:4",
          imageSize: "1K",
          personGeneration: PersonGeneration.ALLOW_ADULT,
        },
      },
    });

    const generatedImage = extractGeminiImage(response);
    if (!generatedImage?.inlineData?.data) {
      throw new VertexPreviewMockupError(
        "PRODUCT_PREVIEW_PARSE_ERROR",
        "Vertex preview mockup fallback con Gemini no devolvio una imagen utilizable",
        undefined,
        response,
      );
    }

    return {
      outputImageBytesBase64: generatedImage.inlineData.data,
      mimeType: generatedImage.inlineData.mimeType,
      rawResponse: response,
    };
  }

  async generateMockup(
    input: VertexPreviewMockupInput,
  ): Promise<VertexPreviewMockupResult> {
    const client = this.getClient(
      aiConfig.previewMockup.region,
      aiConfig.previewMockup.apiVersion,
    );
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      aiConfig.previewMockup.timeoutMs,
    );

    try {
      try {
        return await this.runRecontextRequest(input, client, controller);
      } catch (error) {
        if (!shouldFallbackToGeminiImage(error)) {
          throw error;
        }

        this.baseLogger.warn("vertex_preview_mockup_recontext_unavailable", {
          primaryModel: aiConfig.previewMockup.model,
          primaryRegion: aiConfig.previewMockup.region,
          fallbackModel: aiConfig.previewMockup.fallbackModel,
          fallbackRegion: aiConfig.previewMockup.fallbackRegion,
          message: resolveErrorMessage(error),
          status: resolveErrorStatus(error),
        });

        return await this.runGeminiImageFallback(input, controller);
      }
    } catch (error) {
      if (error instanceof VertexPreviewMockupError) {
        throw error;
      }

      if (error instanceof DOMException && error.name === "AbortError") {
        throw new VertexPreviewMockupError(
          "PRODUCT_PREVIEW_TIMEOUT",
          "Tiempo agotado al generar mockup de preview",
        );
      }

      const status = resolveErrorStatus(error);
      const code =
        typeof status === "number" && Number.isFinite(status)
          ? mapHttpStatusToCode(status)
          : "PRODUCT_PREVIEW_PROVIDER_ERROR";
      const message = resolveErrorMessage(error);

      this.baseLogger.error("vertex_preview_mockup_failed", {
        code,
        status,
        message,
      });

      throw new VertexPreviewMockupError(code, message, status, error);
    } finally {
      clearTimeout(timeout);
    }
  }
}

export const vertexPreviewMockupAdapter = new VertexPreviewMockupAdapter();
export default vertexPreviewMockupAdapter;
