import FormData from "form-data";
import { promises as fs } from "fs";
import { parseMultipartImages } from "../src/middleware/multipart.middleware";

const runMultipartMiddleware = async (
  req: Record<string, unknown>,
): Promise<unknown> => {
  const middleware = parseMultipartImages({
    fieldName: "file",
    maxFiles: 1,
    maxFileSizeBytes: 10 * 1024 * 1024,
    allowedMimeTypes: ["image/jpeg", "image/png", "image/webp", "image/gif"],
  });

  return new Promise((resolve, reject) => {
    middleware(req as never, {} as never, (error?: unknown) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(req);
    });
  });
};

describe("parseMultipartImages", () => {
  const tempFiles: string[] = [];

  afterEach(async () => {
    await Promise.allSettled(tempFiles.map(async (filePath) => fs.unlink(filePath)));
    tempFiles.length = 0;
  });

  it("procesa multipart desde req.rawBody y preserva campos del formulario", async () => {
    const form = new FormData();
    form.append("sessionId", "session-123");
    form.append("file", Buffer.from("fake-image-buffer"), {
      filename: "evelyn.jpg",
      contentType: "image/jpeg",
    });

    const req: {
      headers: ReturnType<FormData["getHeaders"]>;
      rawBody: Buffer;
      body: Record<string, unknown>;
      files?: Express.Multer.File[];
    } = {
      headers: form.getHeaders(),
      rawBody: form.getBuffer(),
      body: {},
    };

    await runMultipartMiddleware(req);

    expect(req.body).toMatchObject({
      sessionId: "session-123",
    });
    expect(Array.isArray(req.files)).toBe(true);
    expect((req.files as Express.Multer.File[])[0]).toMatchObject({
      fieldname: "file",
      originalname: "evelyn.jpg",
      mimetype: "image/jpeg",
    });
    expect((req.files as Express.Multer.File[])[0].path).toBeTruthy();
    tempFiles.push((req.files as Express.Multer.File[])[0].path);
  });

  it.each([
    ["image/png", "preview.png"],
    ["image/webp", "preview.webp"],
    ["image/gif", "preview.gif"],
  ])("acepta archivos %s configurados", async (mimeType, filename) => {
    const form = new FormData();
    form.append("file", Buffer.from("fake-image-buffer"), {
      filename,
      contentType: mimeType,
    });

    const req: {
      headers: ReturnType<FormData["getHeaders"]>;
      rawBody: Buffer;
      body: Record<string, unknown>;
      files?: Express.Multer.File[];
    } = {
      headers: form.getHeaders(),
      rawBody: form.getBuffer(),
      body: {},
    };

    await runMultipartMiddleware(req);

    expect((req.files as Express.Multer.File[])[0].mimetype).toBe(mimeType);
    tempFiles.push((req.files as Express.Multer.File[])[0].path);
  });

  it("rechaza multipart sin boundary con un 400 controlado", async () => {
    const req: {
      headers: Record<string, string>;
      rawBody: Buffer;
      body: Record<string, unknown>;
    } = {
      headers: {
        "content-type": "multipart/form-data",
      },
      rawBody: Buffer.from("broken-multipart"),
      body: {},
    };

    await expect(runMultipartMiddleware(req)).rejects.toEqual(
      expect.objectContaining({
        statusCode: 400,
        message: "Solicitud multipart inválida: falta el boundary en Content-Type",
      }),
    );
  });

  it.each([
    ["image/svg+xml", "vector.svg"],
    ["image/heic", "portrait.heic"],
    ["application/pdf", "manual.pdf"],
  ])("rechaza archivos con mime type %s", async (mimeType, filename) => {
    const form = new FormData();
    form.append("file", Buffer.from("fake-image-buffer"), {
      filename,
      contentType: mimeType,
    });

    const req: {
      headers: ReturnType<FormData["getHeaders"]>;
      rawBody: Buffer;
      body: Record<string, unknown>;
    } = {
      headers: form.getHeaders(),
      rawBody: form.getBuffer(),
      body: {},
    };

    await expect(runMultipartMiddleware(req)).rejects.toEqual(
      expect.objectContaining({
        statusCode: 400,
        message: expect.stringContaining("Tipo de archivo no permitido"),
      }),
    );
  });

  it("rechaza archivos mayores al límite configurado", async () => {
    const form = new FormData();
    form.append("file", Buffer.alloc(11 * 1024 * 1024, 1), {
      filename: "big.png",
      contentType: "image/png",
    });

    const req: {
      headers: ReturnType<FormData["getHeaders"]>;
      rawBody: Buffer;
      body: Record<string, unknown>;
    } = {
      headers: form.getHeaders(),
      rawBody: form.getBuffer(),
      body: {},
    };

    await expect(runMultipartMiddleware(req)).rejects.toEqual(
      expect.objectContaining({
        statusCode: 400,
        message: expect.stringContaining("excede el límite"),
      }),
    );
  });
});
