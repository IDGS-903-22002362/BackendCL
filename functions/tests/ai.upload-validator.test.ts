import sharp from "sharp";
import aiUploadValidatorService from "../src/services/ai/storage/ai-upload-validator.service";

jest.mock(
  "file-type",
  () => ({
    fileTypeFromBuffer: jest.fn(),
  }),
  { virtual: true },
);

const { fileTypeFromBuffer } = jest.requireMock("file-type") as {
  fileTypeFromBuffer: jest.Mock;
};

describe("AI upload validator", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("acepta una imagen png valida con dimensiones minimas", async () => {
    fileTypeFromBuffer.mockResolvedValue({ mime: "image/png" });

    const buffer = await sharp({
      create: {
        width: 600,
        height: 600,
        channels: 3,
        background: { r: 255, g: 255, b: 255 },
      },
    })
      .png()
      .toBuffer();

    const result = await aiUploadValidatorService.validateImage(buffer);

    expect(result.mimeType).toBe("image/png");
    expect(result.width).toBe(600);
    expect(result.height).toBe(600);
  });

  it("rechaza un archivo corrupto o no soportado", async () => {
    fileTypeFromBuffer.mockResolvedValue(undefined);

    await expect(
      aiUploadValidatorService.validateImage(Buffer.from("not-an-image")),
    ).rejects.toThrow("Tipo de archivo no permitido");
  });
});
