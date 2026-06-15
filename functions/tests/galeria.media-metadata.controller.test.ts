jest.mock("../src/config/app.firebase", () => ({
  firestoreApp: {},
  storageAppOficial: {
    bucket: jest.fn(),
  },
}));

jest.mock("../src/config/firebase.admin", () => ({
  admin: {
    firestore: {
      Timestamp: {
        now: jest.fn(),
      },
    },
  },
}));

jest.mock("../src/services/galeria.service", () => {
  class GalleryServiceError extends Error {
    constructor(public readonly code: "NOT_FOUND", message: string) {
      super(message);
    }
  }

  return {
    __esModule: true,
    GalleryServiceError,
    default: {
      addMediaMetadata: jest.fn(),
    },
  };
});

import { addMediaMetadata } from "../src/controllers/galeria/galeria.command.controller";
import galleryService, { GalleryServiceError } from "../src/services/galeria.service";

const mockedGalleryService = galleryService as unknown as {
  addMediaMetadata: jest.Mock;
};

const createMockResponse = () => {
  const res: Record<string, jest.Mock> = {
    status: jest.fn(),
    json: jest.fn(),
  };

  res.status.mockReturnValue(res);
  return res;
};

const validImageBody = {
  tipo: "imagen",
  url: "https://storage.googleapis.com/app-oficial-leon.firebasestorage.app/galeria/gal_1/foto.jpg",
  storagePath: "galeria/gal_1/foto.jpg",
  contentType: "image/jpeg",
  size: 1024,
  nombreOriginal: "foto.jpg",
  width: 1200,
  height: 800,
};

describe("galeria media metadata controller", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("guarda metadata de imagen valida", async () => {
    mockedGalleryService.addMediaMetadata.mockResolvedValue({
      ...validImageBody,
      id: "media_1",
      galeriaId: "gal_1",
      estado: true,
      creadoEn: new Date("2026-06-15T18:00:00Z"),
      actualizadoEn: new Date("2026-06-15T18:00:00Z"),
    });

    const req = {
      params: { galeriaId: "gal_1" },
      body: validImageBody,
    } as unknown as Parameters<typeof addMediaMetadata>[0];
    const res = createMockResponse() as unknown as Parameters<typeof addMediaMetadata>[1];

    await addMediaMetadata(req, res);

    expect(mockedGalleryService.addMediaMetadata).toHaveBeenCalledWith("gal_1", validImageBody);
    expect((res as any).status).toHaveBeenCalledWith(201);
    expect((res as any).json).toHaveBeenCalledWith({
      success: true,
      message: "Metadata de archivo guardada correctamente",
      data: expect.objectContaining({
        id: "media_1",
        galeriaId: "gal_1",
        tipo: "imagen",
        creadoEn: "2026-06-15T18:00:00.000Z",
      }),
    });
  });

  it("guarda metadata de video valido", async () => {
    const body = {
      tipo: "video",
      url: "https://storage.googleapis.com/app-oficial-leon.firebasestorage.app/galeria/gal_1/reel.mp4",
      storagePath: "galeria/gal_1/reel.mp4",
      contentType: "video/mp4",
      size: 25 * 1024 * 1024,
      nombreOriginal: "reel.mp4",
      duration: 12,
    };
    mockedGalleryService.addMediaMetadata.mockResolvedValue({
      ...body,
      id: "media_2",
      galeriaId: "gal_1",
      estado: true,
      creadoEn: new Date("2026-06-15T18:00:00Z"),
      actualizadoEn: new Date("2026-06-15T18:00:00Z"),
    });

    const req = {
      params: { galeriaId: "gal_1" },
      body,
    } as unknown as Parameters<typeof addMediaMetadata>[0];
    const res = createMockResponse() as unknown as Parameters<typeof addMediaMetadata>[1];

    await addMediaMetadata(req, res);

    expect(mockedGalleryService.addMediaMetadata).toHaveBeenCalledWith("gal_1", body);
    expect((res as any).status).toHaveBeenCalledWith(201);
  });

  it.each([
    ["tipo invalido", { ...validImageBody, tipo: "audio" }],
    ["contentType incompatible", { ...validImageBody, contentType: "video/mp4" }],
    ["storagePath fuera de galeria", { ...validImageBody, storagePath: "productos/gal_1/foto.jpg" }],
    ["imagen mayor a 10MB", { ...validImageBody, size: 11 * 1024 * 1024 }],
    [
      "video mayor a 200MB",
      {
        ...validImageBody,
        tipo: "video",
        contentType: "video/mp4",
        storagePath: "galeria/gal_1/reel.mp4",
        size: 201 * 1024 * 1024,
      },
    ],
  ])("responde 400 cuando %s", async (_caseName, body) => {
    const req = {
      params: { galeriaId: "gal_1" },
      body,
    } as unknown as Parameters<typeof addMediaMetadata>[0];
    const res = createMockResponse() as unknown as Parameters<typeof addMediaMetadata>[1];

    await addMediaMetadata(req, res);

    expect(mockedGalleryService.addMediaMetadata).not.toHaveBeenCalled();
    expect((res as any).status).toHaveBeenCalledWith(400);
  });

  it("responde 404 cuando la galeria no existe", async () => {
    mockedGalleryService.addMediaMetadata.mockRejectedValue(
      new GalleryServiceError("NOT_FOUND", "Galeria no encontrada"),
    );

    const req = {
      params: { galeriaId: "missing" },
      body: {
        ...validImageBody,
        storagePath: "galeria/missing/foto.jpg",
      },
    } as unknown as Parameters<typeof addMediaMetadata>[0];
    const res = createMockResponse() as unknown as Parameters<typeof addMediaMetadata>[1];

    await addMediaMetadata(req, res);

    expect((res as any).status).toHaveBeenCalledWith(404);
    expect((res as any).json).toHaveBeenCalledWith({
      success: false,
      message: "Galeria no encontrada",
    });
  });
});

