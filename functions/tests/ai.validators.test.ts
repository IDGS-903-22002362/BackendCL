import { createAiSessionSchema } from "../src/middleware/validators/ai-session.validator";
import { sendAiMessageSchema } from "../src/middleware/validators/ai-chat.validator";
import { sendPublicAiMessageSchema } from "../src/middleware/validators/ai-public-chat.validator";
import { createTryOnJobSchema } from "../src/middleware/validators/ai-tryon.validator";

describe("AI validators", () => {
  it("acepta una sesion AI valida", () => {
    const result = createAiSessionSchema.parse({
      channel: "app",
      title: "Ayuda con jersey",
    });

    expect(result).toEqual({
      channel: "app",
      title: "Ayuda con jersey",
    });
  });

  it("rechaza mensajes AI con campos extra", () => {
    expect(() =>
      sendAiMessageSchema.parse({
        sessionId: "sess_1",
        message: "Quiero ver tenis en talla 27",
        extra: true,
      }),
    ).toThrow();
  });

  it("requiere consentimiento explicito para crear try-on job", () => {
    expect(() =>
      createTryOnJobSchema.parse({
        sessionId: "sess_1",
        productId: "prod_1",
        userImageAssetId: "asset_1",
        consentAccepted: false,
      }),
    ).toThrow();
  });

  it("requiere publicAccessToken en modo guest", () => {
    expect(() =>
      sendPublicAiMessageSchema.parse({
        sessionId: "guest_1",
        message: "hola",
      }),
    ).toThrow();
  });
});
