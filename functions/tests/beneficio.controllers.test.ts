import { afterEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("../src/services/beneficio.service", () => ({
  __esModule: true,
  default: {
    getAllBeneficios: jest.fn(),
    getBeneficioById: jest.fn(),
    createBeneficio: jest.fn(),
    updateBeneficio: jest.fn(),
    appendBeneficioImagenes: jest.fn(),
    updateBeneficioMedia: jest.fn(),
    removeBeneficioImagen: jest.fn(),
    clearBeneficioMedia: jest.fn(),
    collectMediaUrls: jest.fn(),
    deleteBeneficio: jest.fn(),
    permanentlyDeleteBeneficio: jest.fn(),
    listReclamadosByMember: jest.fn(),
    claimBeneficioPoints: jest.fn(),
  },
}));

jest.mock("../src/services/storageApp.service", () => ({
  __esModule: true,
  default: {
    uploadFile: jest.fn(),
    deleteFile: jest.fn(),
  },
}));

import * as commandController from "../src/controllers/beneficios/beneficio.command.controller";
import * as queryController from "../src/controllers/beneficios/beneficio.query.controller";
import beneficioService from "../src/services/beneficio.service";
import storageAppService from "../src/services/storageApp.service";

const mockedBeneficioService = beneficioService as jest.Mocked<
  typeof beneficioService
>;
const mockedStorageAppService = storageAppService as jest.Mocked<
  typeof storageAppService
>;

const createMockResponse = () => {
  const res: Record<string, jest.Mock> = {
    status: jest.fn(),
    json: jest.fn(),
  };

  res.status.mockReturnValue(res);
  return res;
};

describe("beneficio controllers", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it("getAll responde con beneficios", async () => {
    mockedBeneficioService.getAllBeneficios.mockResolvedValue([
      {
        id: "benefit-1",
        titulo: "Descuento especial",
        descripcion: "Descripcion del beneficio",
        estatus: true,
        createdAt: new Date("2026-04-30T12:00:00Z"),
        updatedAt: new Date("2026-04-30T12:00:00Z"),
      },
    ] as never);

    const req = {} as unknown as Parameters<typeof queryController.getAll>[0];
    const res = createMockResponse() as unknown as Parameters<typeof queryController.getAll>[1];

    await queryController.getAll(req, res);

    expect(mockedBeneficioService.getAllBeneficios).toHaveBeenCalled();
    expect((res as any).status).toHaveBeenCalledWith(200);
    expect((res as any).json).toHaveBeenCalledWith({
      success: true,
      count: 1,
      data: expect.any(Array),
    });
  });

  it("create crea un beneficio", async () => {
    mockedBeneficioService.createBeneficio.mockResolvedValue({
      id: "benefit-1",
      titulo: "Descuento especial",
      descripcion: "Descripcion del beneficio",
      estatus: true,
      createdAt: new Date("2026-04-30T12:00:00Z"),
      updatedAt: new Date("2026-04-30T12:00:00Z"),
    } as never);

    const req = {
      body: {
        titulo: "Descuento especial",
        descripcion: "Descripcion del beneficio",
        estatus: true,
      },
    } as unknown as Parameters<typeof commandController.create>[0];
    const res = createMockResponse() as unknown as Parameters<typeof commandController.create>[1];

    await commandController.create(req, res);

    expect(mockedBeneficioService.createBeneficio).toHaveBeenCalledWith({
      titulo: "Descuento especial",
      descripcion: "Descripcion del beneficio",
      estatus: true,
    });
    expect((res as any).status).toHaveBeenCalledWith(201);
  });

  it("update actualiza un beneficio", async () => {
    mockedBeneficioService.updateBeneficio.mockResolvedValue({
      id: "benefit-1",
      titulo: "Descuento actualizado",
      descripcion: "Nueva descripcion",
      estatus: true,
      createdAt: new Date("2026-04-30T12:00:00Z"),
      updatedAt: new Date("2026-04-30T12:30:00Z"),
    } as never);

    const req = {
      params: { id: "benefit-1" },
      body: {
        titulo: "Descuento actualizado",
        descripcion: "Nueva descripcion",
      },
    } as unknown as Parameters<typeof commandController.update>[0];
    const res = createMockResponse() as unknown as Parameters<typeof commandController.update>[1];

    await commandController.update(req, res);

    expect(mockedBeneficioService.updateBeneficio).toHaveBeenCalledWith(
      "benefit-1",
      {
        titulo: "Descuento actualizado",
        descripcion: "Nueva descripcion",
      },
    );
    expect((res as any).status).toHaveBeenCalledWith(200);
  });

  it("uploadImage sube imagen y actualiza el beneficio", async () => {
    mockedBeneficioService.getBeneficioById.mockResolvedValue({
      id: "benefit-1",
      titulo: "Descuento especial",
      descripcion: "Descripcion del beneficio",
      estatus: true,
      createdAt: new Date("2026-04-30T12:00:00Z"),
      updatedAt: new Date("2026-04-30T12:00:00Z"),
    } as never);
    mockedStorageAppService.uploadFile.mockResolvedValue(
      "https://storage.googleapis.com/app-oficial-leon.firebasestorage.app/beneficios/image.png",
    );
    mockedBeneficioService.appendBeneficioImagenes.mockResolvedValue({
      id: "benefit-1",
      titulo: "Descuento especial",
      descripcion: "Descripcion del beneficio",
      imagenes: [
        "https://storage.googleapis.com/app-oficial-leon.firebasestorage.app/beneficios/image.png",
      ],
      mediaTipo: "imagen",
      estatus: true,
      createdAt: new Date("2026-04-30T12:00:00Z"),
      updatedAt: new Date("2026-04-30T12:05:00Z"),
    } as never);

    const req = {
      params: { id: "benefit-1" },
      files: [
        {
          buffer: Buffer.from("image"),
          originalname: "image.png",
          mimetype: "image/png",
        },
      ],
    } as unknown as Parameters<typeof commandController.uploadImage>[0];
    const res = createMockResponse() as unknown as Parameters<
      typeof commandController.uploadImage
    >[1];

    await commandController.uploadImage(req, res);

    expect(mockedStorageAppService.uploadFile).toHaveBeenCalledWith(
      Buffer.from("image"),
      "image.png",
      "beneficios",
      "image/png",
    );
    expect(mockedBeneficioService.appendBeneficioImagenes).toHaveBeenCalledWith(
      "benefit-1",
      [
        "https://storage.googleapis.com/app-oficial-leon.firebasestorage.app/beneficios/image.png",
      ],
    );
    expect((res as any).status).toHaveBeenCalledWith(200);
  });

  it("uploadVideo sube video y actualiza el beneficio", async () => {
    mockedBeneficioService.getBeneficioById.mockResolvedValue({
      id: "benefit-1",
      titulo: "Descuento especial",
      descripcion: "Descripcion del beneficio",
      estatus: true,
      createdAt: new Date("2026-04-30T12:00:00Z"),
      updatedAt: new Date("2026-04-30T12:00:00Z"),
    } as never);
    mockedStorageAppService.uploadFile.mockResolvedValue(
      "https://storage.googleapis.com/app-oficial-leon.firebasestorage.app/beneficios/video.mp4",
    );
    mockedBeneficioService.updateBeneficioMedia.mockResolvedValue({
      id: "benefit-1",
      titulo: "Descuento especial",
      descripcion: "Descripcion del beneficio",
      video:
        "https://storage.googleapis.com/app-oficial-leon.firebasestorage.app/beneficios/video.mp4",
      mediaTipo: "video",
      estatus: true,
      createdAt: new Date("2026-04-30T12:00:00Z"),
      updatedAt: new Date("2026-04-30T12:05:00Z"),
    } as never);

    const req = {
      params: { id: "benefit-1" },
      files: [
        {
          buffer: Buffer.from("video"),
          originalname: "video.mp4",
          mimetype: "video/mp4",
        },
      ],
    } as unknown as Parameters<typeof commandController.uploadVideo>[0];
    const res = createMockResponse() as unknown as Parameters<
      typeof commandController.uploadVideo
    >[1];

    await commandController.uploadVideo(req, res);

    expect(mockedStorageAppService.uploadFile).toHaveBeenCalledWith(
      Buffer.from("video"),
      "video.mp4",
      "beneficios",
      "video/mp4",
    );
    expect(mockedBeneficioService.updateBeneficioMedia).toHaveBeenCalledWith(
      "benefit-1",
      "video",
      "https://storage.googleapis.com/app-oficial-leon.firebasestorage.app/beneficios/video.mp4",
    );
    expect((res as any).status).toHaveBeenCalledWith(200);
  });

  it("removeMedia elimina la media del beneficio", async () => {
    mockedBeneficioService.getBeneficioById.mockResolvedValue({
      id: "benefit-1",
      titulo: "Descuento especial",
      descripcion: "Descripcion del beneficio",
      imagenes: [
        "https://storage.googleapis.com/app-oficial-leon.firebasestorage.app/beneficios/image.png",
      ],
      mediaTipo: "imagen",
      estatus: true,
      createdAt: new Date("2026-04-30T12:00:00Z"),
      updatedAt: new Date("2026-04-30T12:00:00Z"),
    } as never);
    mockedBeneficioService.collectMediaUrls.mockReturnValue([
      "https://storage.googleapis.com/app-oficial-leon.firebasestorage.app/beneficios/image.png",
    ]);
    mockedBeneficioService.clearBeneficioMedia.mockResolvedValue({
      id: "benefit-1",
      titulo: "Descuento especial",
      descripcion: "Descripcion del beneficio",
      estatus: true,
      createdAt: new Date("2026-04-30T12:00:00Z"),
      updatedAt: new Date("2026-04-30T12:05:00Z"),
    } as never);
    mockedStorageAppService.deleteFile.mockResolvedValue(undefined as never);

    const req = {
      params: { id: "benefit-1" },
    } as unknown as Parameters<typeof commandController.removeMedia>[0];
    const res = createMockResponse() as unknown as Parameters<
      typeof commandController.removeMedia
    >[1];

    await commandController.removeMedia(req, res);

    expect(mockedBeneficioService.clearBeneficioMedia).toHaveBeenCalledWith(
      "benefit-1",
    );
    expect((res as any).status).toHaveBeenCalledWith(200);
  });

  it("removeImage elimina una imagen del beneficio", async () => {
    mockedBeneficioService.getBeneficioById.mockResolvedValue({
      id: "benefit-1",
      titulo: "Descuento especial",
      descripcion: "Descripcion del beneficio",
      imagenes: [
        "https://storage.googleapis.com/app-oficial-leon.firebasestorage.app/beneficios/image.png",
      ],
      mediaTipo: "imagen",
      estatus: true,
      createdAt: new Date("2026-04-30T12:00:00Z"),
      updatedAt: new Date("2026-04-30T12:00:00Z"),
    } as never);
    mockedBeneficioService.removeBeneficioImagen.mockResolvedValue({
      id: "benefit-1",
      titulo: "Descuento especial",
      descripcion: "Descripcion del beneficio",
      estatus: true,
      createdAt: new Date("2026-04-30T12:00:00Z"),
      updatedAt: new Date("2026-04-30T12:05:00Z"),
    } as never);
    mockedStorageAppService.deleteFile.mockResolvedValue(undefined as never);

    const req = {
      params: { id: "benefit-1" },
      body: {
        url: "https://storage.googleapis.com/app-oficial-leon.firebasestorage.app/beneficios/image.png",
      },
    } as unknown as Parameters<typeof commandController.removeImage>[0];
    const res = createMockResponse() as unknown as Parameters<
      typeof commandController.removeImage
    >[1];

    await commandController.removeImage(req, res);

    expect(mockedBeneficioService.removeBeneficioImagen).toHaveBeenCalledWith(
      "benefit-1",
      "https://storage.googleapis.com/app-oficial-leon.firebasestorage.app/beneficios/image.png",
    );
    expect((res as any).status).toHaveBeenCalledWith(200);
  });

  it("remove desactiva un beneficio", async () => {
    mockedBeneficioService.deleteBeneficio.mockResolvedValue(undefined as never);

    const req = {
      params: { id: "benefit-1" },
    } as unknown as Parameters<typeof commandController.remove>[0];
    const res = createMockResponse() as unknown as Parameters<typeof commandController.remove>[1];

    await commandController.remove(req, res);

    expect(mockedBeneficioService.deleteBeneficio).toHaveBeenCalledWith(
      "benefit-1",
    );
    expect((res as any).status).toHaveBeenCalledWith(200);
  });

  it("destroyPermanently elimina el beneficio y su media", async () => {
    mockedBeneficioService.getBeneficioById.mockResolvedValue({
      id: "benefit-1",
      titulo: "Descuento especial",
      descripcion: "Descripcion del beneficio",
      imagenes: [
        "https://storage.googleapis.com/app-oficial-leon.firebasestorage.app/beneficios/image.png",
      ],
      mediaTipo: "imagen",
      estatus: false,
      createdAt: new Date("2026-04-30T12:00:00Z"),
      updatedAt: new Date("2026-04-30T12:00:00Z"),
    } as never);
    mockedBeneficioService.permanentlyDeleteBeneficio.mockResolvedValue([
      "https://storage.googleapis.com/app-oficial-leon.firebasestorage.app/beneficios/image.png",
    ]);
    mockedStorageAppService.deleteFile.mockResolvedValue(undefined as never);

    const req = {
      params: { id: "benefit-1" },
    } as unknown as Parameters<typeof commandController.destroyPermanently>[0];
    const res = createMockResponse() as unknown as Parameters<
      typeof commandController.destroyPermanently
    >[1];

    await commandController.destroyPermanently(req, res);

    expect(mockedBeneficioService.permanentlyDeleteBeneficio).toHaveBeenCalledWith(
      "benefit-1",
    );
    expect(mockedStorageAppService.deleteFile).toHaveBeenCalledWith(
      "https://storage.googleapis.com/app-oficial-leon.firebasestorage.app/beneficios/image.png",
    );
    expect((res as any).status).toHaveBeenCalledWith(200);
  });

  it("getMyReclamados responde con ids reclamados", async () => {
    mockedBeneficioService.listReclamadosByMember.mockResolvedValue([
      "benefit-1",
      "benefit-2",
    ] as never);

    const req = {
      user: { uid: "user-1" },
    } as unknown as Parameters<typeof queryController.getMyReclamados>[0];
    const res = createMockResponse() as unknown as Parameters<
      typeof queryController.getMyReclamados
    >[1];

    await queryController.getMyReclamados(req, res);

    expect(mockedBeneficioService.listReclamadosByMember).toHaveBeenCalledWith(
      "user-1",
    );
    expect((res as any).json).toHaveBeenCalledWith({
      success: true,
      data: {
        reclamados: ["benefit-1", "benefit-2"],
      },
    });
  });

  it("claimPoints otorga puntos del beneficio", async () => {
    mockedBeneficioService.claimBeneficioPoints.mockResolvedValue({
      alreadyClaimed: false,
      puntosAsignados: 50,
      puntosActuales: 150,
      beneficioId: "benefit-1",
    } as never);

    const req = {
      params: { id: "benefit-1" },
      user: { uid: "user-1" },
    } as unknown as Parameters<typeof commandController.claimPoints>[0];
    const res = createMockResponse() as unknown as Parameters<
      typeof commandController.claimPoints
    >[1];

    await commandController.claimPoints(req, res);

    expect(mockedBeneficioService.claimBeneficioPoints).toHaveBeenCalledWith(
      "benefit-1",
      "user-1",
    );
    expect((res as any).status).toHaveBeenCalledWith(200);
    expect((res as any).json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          puntosAsignados: 50,
          puntosActuales: 150,
        }),
      }),
    );
  });

  it("claimPoints responde alreadyClaimed sin otorgar puntos extra", async () => {
    mockedBeneficioService.claimBeneficioPoints.mockResolvedValue({
      alreadyClaimed: true,
      puntosAsignados: 0,
      puntosActuales: 150,
      beneficioId: "benefit-1",
    } as never);

    const req = {
      params: { id: "benefit-1" },
      user: { uid: "user-1" },
    } as unknown as Parameters<typeof commandController.claimPoints>[0];
    const res = createMockResponse() as unknown as Parameters<
      typeof commandController.claimPoints
    >[1];

    await commandController.claimPoints(req, res);

    expect((res as any).json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        message: "Ya reclamaste los puntos de este beneficio",
        data: expect.objectContaining({
          alreadyClaimed: true,
          puntosAsignados: 0,
        }),
      }),
    );
  });
});
