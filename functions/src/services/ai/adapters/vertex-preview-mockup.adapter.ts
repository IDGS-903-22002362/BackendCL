import {
  GoogleGenAI,
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

const extractGeneratedImage = (response: RecontextImageResponse) =>
  response.generatedImages?.find((image) => image.image?.imageBytes || image.image?.gcsUri);

class VertexPreviewMockupAdapter {
  private readonly baseLogger = logger.child({
    component: "vertex-preview-mockup-adapter",
  });
  private client?: GoogleGenAI;

  private getClient(): GoogleGenAI {
    if (this.client) {
      return this.client;
    }

    this.client = new GoogleGenAI({
      vertexai: true,
      project: aiConfig.previewMockup.project,
      location: aiConfig.previewMockup.region,
      apiVersion: aiConfig.previewMockup.apiVersion,
    });

    return this.client;
  }

  async generateMockup(
    input: VertexPreviewMockupInput,
  ): Promise<VertexPreviewMockupResult> {
    const client = this.getClient();
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      aiConfig.previewMockup.timeoutMs,
    );

    try {
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

      const status =
        typeof error === "object" && error !== null
          ? Number(Reflect.get(error, "status"))
          : undefined;
      const code =
        typeof status === "number" && Number.isFinite(status)
          ? mapHttpStatusToCode(status)
          : "PRODUCT_PREVIEW_PROVIDER_ERROR";
      const message =
        error instanceof Error
          ? error.message
          : "Error desconocido al generar mockup de preview";

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
