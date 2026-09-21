import { afterEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("../src/services/patrocinador.service", () => ({
  __esModule: true,
  default: {
    getAllPatrocinadores: jest.fn(),
    getPatrocinadorById: jest.fn(),
    createPatrocinador: jest.fn(),
    updatePatrocinador: jest.fn(),
    updatePatrocinadorImagen: jest.fn(),
    clearPatrocinadorImagen: jest.fn(),
    deletePatrocinador: jest.fn(),
    permanentlyDeletePatrocinador: jest.fn(),
    serializePatrocinadorForApi: jest.fn((item: unknown) => item),
  },
}));

jest.mock("../src/services/storageApp.service", () => ({
  __esModule: true,
  default: {
    uploadFile: jest.fn(),
    deleteFile: jest.fn(),
  },
}));

import * as commandController from "../src/controllers/patrocinadores/patrocinador.command.controller";
import * as queryController from "../src/controllers/patrocinadores/patrocinador.query.controller";
import patrocinadorService from "../src/services/patrocinador.service";
import storageAppService from "../src/services/storageApp.service";

const mockedPatrocinadorService = patrocinadorService as jest.Mocked<
  typeof patrocinadorService
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

const samplePatrocinador = {
  id: "sponsor-1",
  nombre: "Banco Local",
  imagenBlanca:
    "https://storage.googleapis.com/app-oficial-leon.firebasestorage.app/patrocinadores/logo-blanco.png",
  imagenNegra:
    "https://storage.googleapis.com/app-oficial-leon.firebasestorage.app/patrocinadores/logo-negro.png",
  estatus: true,
  createdAt: new Date("2026-09-04T12:00:00Z"),
  updatedAt: new Date("2026-09-04T12:00:00Z"),
};

describe("patrocinador controllers", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it("getAll responde con patrocinadores", async () => {
    mockedPatrocinadorService.getAllPatrocinadores.mockResolvedValue([
      samplePatrocinador,
    ] as never);

    const req = {} as unknown as Parameters<typeof queryController.getAll>[0];
    const res = createMockResponse() as unknown as Parameters<
      typeof queryController.getAll
    >[1];

    await queryController.getAll(req, res);

    expect(mockedPatrocinadorService.getAllPatrocinadores).toHaveBeenCalled();
    expect((res as any).status).toHaveBeenCalledWith(200);
    expect((res as any).json).toHaveBeenCalledWith({
      success: true,
      count: 1,
      data: expect.any(Array),
    });
  });

  it("create crea un patrocinador", async () => {
    mockedPatrocinadorService.createPatrocinador.mockResolvedValue(
      samplePatrocinador as never,
    );

    const req = {
      body: {
        nombre: "Banco Local",
        estatus: true,
      },
    } as unknown as Parameters<typeof commandController.create>[0];
    const res = createMockResponse() as unknown as Parameters<
      typeof commandController.create
    >[1];

    await commandController.create(req, res);

    expect(mockedPatrocinadorService.createPatrocinador).toHaveBeenCalledWith({
      nombre: "Banco Local",
      estatus: true,
    });
    expect((res as any).status).toHaveBeenCalledWith(201);
  });

  it("update actualiza un patrocinador", async () => {
    mockedPatrocinadorService.updatePatrocinador.mockResolvedValue({
      ...samplePatrocinador,
      nombre: "Banco Actualizado",
    } as never);

    const req = {
      params: { id: "sponsor-1" },
      body: {
        nombre: "Banco Actualizado",
      },
    } as unknown as Parameters<typeof commandController.update>[0];
    const res = createMockResponse() as unknown as Parameters<
      typeof commandController.update
    >[1];

    await commandController.update(req, res);

    expect(mockedPatrocinadorService.updatePatrocinador).toHaveBeenCalledWith(
      "sponsor-1",
      {
        nombre: "Banco Actualizado",
      },
    );
    expect((res as any).status).toHaveBeenCalledWith(200);
  });

  it("uploadImage sube imagen y reemplaza la anterior", async () => {
    mockedPatrocinadorService.getPatrocinadorById.mockResolvedValue(
      samplePatrocinador as never,
    );
    mockedStorageAppService.uploadFile.mockResolvedValue(
      "https://storage.googleapis.com/app-oficial-leon.firebasestorage.app/patrocinadores/nuevo.png",
    );
    mockedPatrocinadorService.updatePatrocinadorImagen.mockResolvedValue({
      patrocinador: {
        ...samplePatrocinador,
        imagenBlanca:
          "https://storage.googleapis.com/app-oficial-leon.firebasestorage.app/patrocinadores/nuevo.png",
      },
      previousImagen: samplePatrocinador.imagenBlanca,
    } as never);
    mockedStorageAppService.deleteFile.mockResolvedValue(undefined as never);

    const req = {
      params: { id: "sponsor-1", variante: "blanca" },
      files: [
        {
          buffer: Buffer.from("image"),
          originalname: "nuevo.png",
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
      "nuevo.png",
      "patrocinadores",
      "image/png",
    );
    expect(mockedPatrocinadorService.updatePatrocinadorImagen).toHaveBeenCalledWith(
      "sponsor-1",
      "https://storage.googleapis.com/app-oficial-leon.firebasestorage.app/patrocinadores/nuevo.png",
      "blanca",
    );
    expect(mockedStorageAppService.deleteFile).toHaveBeenCalledWith(
      samplePatrocinador.imagenBlanca,
    );
    expect((res as any).status).toHaveBeenCalledWith(200);
  });

  it("removeImage elimina la imagen del patrocinador", async () => {
    mockedPatrocinadorService.getPatrocinadorById.mockResolvedValue(
      samplePatrocinador as never,
    );
    mockedPatrocinadorService.clearPatrocinadorImagen.mockResolvedValue({
      patrocinador: { ...samplePatrocinador, imagenNegra: undefined },
      previousImagen: samplePatrocinador.imagenNegra,
    } as never);
    mockedStorageAppService.deleteFile.mockResolvedValue(undefined as never);

    const req = {
      params: { id: "sponsor-1", variante: "negra" },
    } as unknown as Parameters<typeof commandController.removeImage>[0];
    const res = createMockResponse() as unknown as Parameters<
      typeof commandController.removeImage
    >[1];

    await commandController.removeImage(req, res);

    expect(mockedPatrocinadorService.clearPatrocinadorImagen).toHaveBeenCalledWith(
      "sponsor-1",
      "negra",
    );
    expect(mockedStorageAppService.deleteFile).toHaveBeenCalledWith(
      samplePatrocinador.imagenNegra,
    );
    expect((res as any).status).toHaveBeenCalledWith(200);
  });

  it("remove desactiva un patrocinador", async () => {
    mockedPatrocinadorService.deletePatrocinador.mockResolvedValue(
      undefined as never,
    );

    const req = {
      params: { id: "sponsor-1" },
    } as unknown as Parameters<typeof commandController.remove>[0];
    const res = createMockResponse() as unknown as Parameters<
      typeof commandController.remove
    >[1];

    await commandController.remove(req, res);

    expect(mockedPatrocinadorService.deletePatrocinador).toHaveBeenCalledWith(
      "sponsor-1",
    );
    expect((res as any).status).toHaveBeenCalledWith(200);
  });

  it("destroyPermanently elimina el patrocinador y su imagen", async () => {
    mockedPatrocinadorService.getPatrocinadorById.mockResolvedValue({
      ...samplePatrocinador,
      estatus: false,
    } as never);
    mockedPatrocinadorService.permanentlyDeletePatrocinador.mockResolvedValue([
      samplePatrocinador.imagenBlanca,
      samplePatrocinador.imagenNegra,
    ]);
    mockedStorageAppService.deleteFile.mockResolvedValue(undefined as never);

    const req = {
      params: { id: "sponsor-1" },
    } as unknown as Parameters<
      typeof commandController.destroyPermanently
    >[0];
    const res = createMockResponse() as unknown as Parameters<
      typeof commandController.destroyPermanently
    >[1];

    await commandController.destroyPermanently(req, res);

    expect(
      mockedPatrocinadorService.permanentlyDeletePatrocinador,
    ).toHaveBeenCalledWith("sponsor-1");
    expect(mockedStorageAppService.deleteFile).toHaveBeenCalledWith(
      samplePatrocinador.imagenBlanca,
    );
    expect(mockedStorageAppService.deleteFile).toHaveBeenCalledWith(
      samplePatrocinador.imagenNegra,
    );
    expect((res as any).status).toHaveBeenCalledWith(200);
  });
});
