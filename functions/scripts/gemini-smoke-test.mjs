#!/usr/bin/env node
/**
 * Smoke tests reales de Gemini Developer API.
 * No forma parte de la suite unitaria.
 *
 * Uso:
 *   npm run test:gemini:smoke
 *
 * Requiere GEMINI_API_KEY. No usa Vertex ni ADC.
 * No imprime secretos ni prompts completos.
 */
import dotenv from "dotenv";
import { GoogleGenAI, ThinkingLevel, Modality } from "@google/genai";

dotenv.config({ path: ".env.local" });
dotenv.config();

const MODELS = {
  main: "gemini-3.7-flash",
  fast: "gemini-3.7-flash",
  summary: "gemini-3.5-flash-lite",
  image: "gemini-3.1-flash-image",
};

const results = [];

const record = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} | ${name} | ${detail}`);
};

const resolveClient = () => {
  const apiKey = process.env.GEMINI_API_KEY;
  const apiVersion = process.env.AI_GEMINI_API_VERSION || "v1beta";

  if (!apiKey) {
    throw new Error("GEMINI_API_KEY es requerido para smoke Gemini Developer API");
  }

  return {
    client: new GoogleGenAI({
      apiKey,
      apiVersion,
    }),
    mode: "gemini-api",
    apiVersion,
  };
};

const runTextCase = async (client, name, model, thinkingLevel) => {
  const started = Date.now();
  const response = await client.models.generateContent({
    model,
    contents:
      name === "summary"
        ? "Resume en una frase: El Club Leon es un equipo de futbol mexicano con sede en Leon, Guanajuato. Su tienda oficial vende jerseys, gorras y souvenirs."
        : "Responde solo con la palabra OK.",
    config: thinkingLevel
      ? {
          thinkingConfig: { thinkingLevel },
          maxOutputTokens: 256,
        }
      : { maxOutputTokens: 256 },
  });
  const text = (response.text || "").trim();
  if (!text) {
    throw new Error("respuesta vacia");
  }
  record(
    name,
    true,
    `provider=gemini-api model=${model} thinking=${thinkingLevel || "default"} durationMs=${Date.now() - started} chars=${text.length}`,
  );
};

const runImageCase = async (client, model) => {
  const started = Date.now();
  const response = await client.models.generateContent({
    model,
    contents: "Generate a simple product photo of a green soccer jersey on a white background.",
    config: {
      responseModalities: [Modality.IMAGE],
      imageConfig: {
        aspectRatio: "3:4",
        imageSize: "1K",
      },
    },
  });

  const parts = response.candidates?.[0]?.content?.parts || [];
  const imagePart = parts.find((part) => part.inlineData?.data);
  if (!imagePart?.inlineData?.data) {
    throw new Error("no devolvio imagen");
  }

  record(
    "image",
    true,
    `provider=gemini-api model=${model} mime=${imagePart.inlineData.mimeType || "unknown"} durationMs=${Date.now() - started} bytes=${imagePart.inlineData.data.length}`,
  );
};

const main = async () => {
  let clientInfo;
  try {
    clientInfo = resolveClient();
  } catch (error) {
    console.log(
      `SKIP | gemini-smoke | ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(0);
  }

  console.log(
    `SMOKE | provider=${clientInfo.mode} apiVersion=${clientInfo.apiVersion}`,
  );

  try {
    await runTextCase(
      clientInfo.client,
      "main",
      MODELS.main,
      ThinkingLevel.MEDIUM,
    );
  } catch (error) {
    record("main", false, error instanceof Error ? error.message : String(error));
  }

  try {
    await runTextCase(clientInfo.client, "fast", MODELS.fast, ThinkingLevel.LOW);
  } catch (error) {
    record("fast", false, error instanceof Error ? error.message : String(error));
  }

  try {
    await runTextCase(clientInfo.client, "summary", MODELS.summary);
  } catch (error) {
    record(
      "summary",
      false,
      error instanceof Error ? error.message : String(error),
    );
  }

  if (process.env.GEMINI_SMOKE_INCLUDE_IMAGE === "true") {
    try {
      await runImageCase(clientInfo.client, MODELS.image);
    } catch (error) {
      record("image", false, error instanceof Error ? error.message : String(error));
    }
  } else {
    console.log("SKIP | image | GEMINI_SMOKE_INCLUDE_IMAGE no esta activo");
  }

  const failed = results.filter((item) => !item.ok);
  if (failed.length > 0) {
    process.exit(1);
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
