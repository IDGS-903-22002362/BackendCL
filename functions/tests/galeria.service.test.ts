const batchSet = jest.fn();
const batchUpdate = jest.fn();
const batchCommit = jest.fn();
const storageBucket = jest.fn();

const existingDocs = new Set<string>();

const mediaDocRef = {
  id: "media_1",
};

const galleryDocRef = {
  get: jest.fn(async () => ({ exists: existingDocs.has("gal_1") })),
  collection: jest.fn(() => ({
    doc: jest.fn(() => mediaDocRef),
  })),
};

const galleryCollection = {
  doc: jest.fn(() => galleryDocRef),
};

jest.mock("../src/config/app.firebase", () => ({
  firestoreApp: {
    collection: jest.fn(() => galleryCollection),
    batch: jest.fn(() => ({
      set: batchSet,
      update: batchUpdate,
      commit: batchCommit,
    })),
  },
  storageAppOficial: {
    bucket: storageBucket,
  },
}));

const nowDate = new Date("2026-06-15T18:00:00Z");
const nowTimestamp = {
  toDate: () => nowDate,
};
const arrayUnion = jest.fn((value: string) => ({ __op: "arrayUnion", value }));

jest.mock("../src/config/firebase.admin", () => ({
  admin: {
    firestore: {
      Timestamp: {
        now: jest.fn(() => nowTimestamp),
        fromDate: jest.fn(),
      },
      FieldValue: {
        arrayUnion,
        arrayRemove: jest.fn(),
      },
    },
  },
}));

import galleryService, { GalleryServiceError } from "../src/services/galeria.service";

describe("galeria service addMediaMetadata", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    existingDocs.clear();
  });

  it("guarda metadata y actualiza arrays legacy sin usar Storage", async () => {
    existingDocs.add("gal_1");

    const result = await galleryService.addMediaMetadata("gal_1", {
      tipo: "video",
      url: "https://storage.googleapis.com/app-oficial-leon.firebasestorage.app/galeria/gal_1/reel.mp4",
      storagePath: "galeria/gal_1/reel.mp4",
      contentType: "video/mp4",
      size: 1024,
      nombreOriginal: "reel.mp4",
      duration: 12,
    });

    expect(batchSet).toHaveBeenCalledWith(mediaDocRef, expect.objectContaining({
      id: "media_1",
      galeriaId: "gal_1",
      tipo: "video",
      estado: true,
      creadoEn: nowTimestamp,
      actualizadoEn: nowTimestamp,
    }));
    expect(batchUpdate).toHaveBeenCalledWith(galleryDocRef, {
      videos: { __op: "arrayUnion", value: result.url },
      updatedAt: nowTimestamp,
    });
    expect(batchCommit).toHaveBeenCalled();
    expect(storageBucket).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      id: "media_1",
      galeriaId: "gal_1",
      tipo: "video",
      creadoEn: nowDate,
      actualizadoEn: nowDate,
    });
  });

  it("lanza NOT_FOUND si la galeria no existe", async () => {
    await expect(
      galleryService.addMediaMetadata("gal_1", {
        tipo: "imagen",
        url: "https://storage.googleapis.com/app-oficial-leon.firebasestorage.app/galeria/gal_1/foto.jpg",
        storagePath: "galeria/gal_1/foto.jpg",
        contentType: "image/jpeg",
        size: 1024,
        nombreOriginal: "foto.jpg",
      }),
    ).rejects.toEqual(expect.objectContaining({
      code: "NOT_FOUND",
      message: "Galeria no encontrada",
    }));

    expect(batchSet).not.toHaveBeenCalled();
    expect(batchUpdate).not.toHaveBeenCalled();
    expect(batchCommit).not.toHaveBeenCalled();
  });

  it("usa el error de servicio esperado para galerias inexistentes", async () => {
    const error = new GalleryServiceError("NOT_FOUND", "Galeria no encontrada");

    expect(error.code).toBe("NOT_FOUND");
    expect(error.message).toBe("Galeria no encontrada");
  });
});

