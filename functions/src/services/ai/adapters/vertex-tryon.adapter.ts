import { GoogleAuth } from "google-auth-library";
import aiConfig from "../../../config/ai.config";
import logger from "../../../utils/logger";

export type VertexTryOnErrorCode =
  | "VERTEX_AUTH_FAILED"
  | "VERTEX_PERMISSION_DENIED"
  | "VERTEX_QUOTA_EXCEEDED"
  | "VERTEX_TIMEOUT"
  | "VERTEX_INVALID_ARGUMENT"
  | "VERTEX_PARSE_ERROR"
  | "VERTEX_PROVIDER_ERROR";

export class VertexTryOnError extends Error {
  constructor(
    public readonly code: VertexTryOnErrorCode,
    message: string,
    public readonly status?: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "VertexTryOnError";
  }
}

export interface VertexTryOnInput {
  personImageUri: string;
  garmentImageUri: string;
  outputGcsUri?: string;
}

export interface VertexTryOnResult {
  providerJobId?: string;
  outputImageBytesBase64?: string;
  mimeType?: string;
  outputGcsUri?: string;
  rawResponse: unknown;
}

type VertexPrediction = Record<string, unknown>;

const getString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value : undefined;

const getNestedString = (
  source: Record<string, unknown> | undefined,
  ...keys: string[]
): string | undefined => {
  let current: unknown = source;

  for (const key of keys) {
    if (!current || typeof current !== "object") {
      return undefined;
    }

    current = (current as Record<string, unknown>)[key];
  }

  return getString(current);
};

const mapHttpStatusToCode = (status: number): VertexTryOnErrorCode => {
  if (status === 400) {
    return "VERTEX_INVALID_ARGUMENT";
  }

  if (status === 401) {
    return "VERTEX_AUTH_FAILED";
  }

  if (status === 403) {
    return "VERTEX_PERMISSION_DENIED";
  }

  if (status === 408 || status === 504) {
    return "VERTEX_TIMEOUT";
  }

  if (status === 429) {
    return "VERTEX_QUOTA_EXCEEDED";
  }

  return "VERTEX_PROVIDER_ERROR";
};

class VertexTryOnAdapter {
  private readonly auth = new GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });
  private readonly baseLogger = logger.child({ component: "vertex-tryon-adapter" });

  async runTryOn(input: VertexTryOnInput): Promise<VertexTryOnResult> {
    const project = aiConfig.tryOn.project;
    const region = aiConfig.tryOn.region;
    const publisher = aiConfig.tryOn.endpointPublisher;
    const model = aiConfig.tryOn.model;

    if (!project || !region || !model) {
      throw new VertexTryOnError(
        "VERTEX_INVALID_ARGUMENT",
        "Configuracion incompleta de Vertex Try-On",
      );
    }

    const endpoint = `https://${region}-aiplatform.googleapis.com/v1/projects/${project}/locations/${region}/publishers/${publisher}/models/${model}:predict`;

    let accessToken: string | undefined;
    try {
      const client = await this.auth.getClient();
      const tokenResponse = await client.getAccessToken();
      accessToken = tokenResponse.token || undefined;
    } catch (error) {
      throw new VertexTryOnError(
        "VERTEX_AUTH_FAILED",
        "No se pudo autenticar contra Vertex AI usando ADC",
        undefined,
        error,
      );
    }

    if (!accessToken) {
      throw new VertexTryOnError(
        "VERTEX_AUTH_FAILED",
        "No se obtuvo access token para Vertex AI",
      );
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), aiConfig.tryOn.timeoutMs);

    try {
      const storageUri = input.outputGcsUri
        ? input.outputGcsUri.replace(/\/?$/, "/")
        : undefined;

      const payload = {
        instances: [
          {
            personImage: {
              image: {
                gcsUri: input.personImageUri,
              },
            },
            productImages: [
              {
                image: {
                  gcsUri: input.garmentImageUri,
                },
              },
            ],
          },
        ],
        parameters: {
          sampleCount: 1,
          storageUri,
        },
      };

      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      const rawText = await response.text();
      let rawResponse: unknown = {};

      if (rawText) {
        try {
          rawResponse = JSON.parse(rawText);
        } catch (error) {
          throw new VertexTryOnError(
            "VERTEX_PARSE_ERROR",
            "La respuesta de Vertex Try-On no es JSON valido",
            response.status,
            error,
          );
        }
      }

      if (!response.ok) {
        const providerMessage = getNestedString(
          rawResponse as Record<string, unknown>,
          "error",
          "message",
        );
        const code = mapHttpStatusToCode(response.status);

        this.baseLogger.error("vertex_tryon_failed", {
          status: response.status,
          code,
          response: rawResponse,
        });

        throw new VertexTryOnError(
          code,
          providerMessage || "Error al ejecutar Vertex Virtual Try-On",
          response.status,
          rawResponse,
        );
      }

      const prediction = Array.isArray((rawResponse as { predictions?: unknown[] }).predictions)
        ? ((rawResponse as { predictions: VertexPrediction[] }).predictions[0] || {})
        : {};

      const outputImageBytesBase64 =
        getString(prediction.bytesBase64Encoded) ||
        getNestedString(prediction, "image", "bytesBase64Encoded") ||
        getNestedString(prediction, "outputImage", "bytesBase64Encoded");

      const mimeType =
        getString(prediction.mimeType) ||
        getNestedString(prediction, "image", "mimeType") ||
        getNestedString(prediction, "outputImage", "mimeType");

      const outputGcsUri =
        getString(prediction.gcsUri) ||
        getNestedString(prediction, "image", "gcsUri") ||
        getNestedString(prediction, "outputImage", "gcsUri");

      const providerJobId =
        getString(prediction.jobId) ||
        getNestedString(prediction, "metadata", "jobId");

      if (!outputImageBytesBase64 && !outputGcsUri) {
        throw new VertexTryOnError(
          "VERTEX_PARSE_ERROR",
          "Vertex Try-On no devolvio una imagen de salida utilizable",
          response.status,
          rawResponse,
        );
      }

      return {
        providerJobId,
        outputImageBytesBase64,
        mimeType,
        outputGcsUri,
        rawResponse,
      };
    } catch (error) {
      if (error instanceof VertexTryOnError) {
        throw error;
      }

      if (error instanceof DOMException && error.name === "AbortError") {
        throw new VertexTryOnError(
          "VERTEX_TIMEOUT",
          "La peticion a Vertex Try-On excedio el tiempo maximo permitido",
        );
      }

      throw new VertexTryOnError(
        "VERTEX_PROVIDER_ERROR",
        error instanceof Error
          ? error.message
          : "Error desconocido al ejecutar Vertex Try-On",
        undefined,
        error,
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}

export const vertexTryOnAdapter = new VertexTryOnAdapter();
export default vertexTryOnAdapter;
