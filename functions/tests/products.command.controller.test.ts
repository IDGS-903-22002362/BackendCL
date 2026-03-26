jest.mock("../src/services/product.service", () => ({
  __esModule: true,
  default: {
    getProductById: jest.fn(),
    updateProduct: jest.fn(),
  },
}));

jest.mock("../src/services/storage.service", () => ({
  __esModule: true,
  default: {
    uploadMultipleFilesFromPath: jest.fn(),
  },
}));

import os from "os";
import path from "path";
import { promises as fs } from "fs";
import { uploadImages } from "../src/controllers/products/products.command.controller";
import productService from "../src/services/product.service";
import storageService from "../src/services/storage.service";

const mockedProductService = productService as jest.Mocked<typeof productService>;
const mockedStorageService = storageService as jest.Mocked<typeof storageService>;

const createMockResponse = () => {
  const res: Record<string, jest.Mock> = {
    status: jest.fn(),
    json: jest.fn(),
  };

  res.status.mockReturnValue(res);
  return res;
};

describe("products.command.controller uploadImages", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it("sube imagenes desde archivos temporales y limpia los temporales", async () => {
    const tempFilePath = path.join(
      os.tmpdir(),
      `product-upload-${Date.now()}-photo.png`,
    );
    await fs.writeFile(tempFilePath, Buffer.from("fake-image"));

    mockedProductService.getProductById.mockResolvedValue({
      id: "prod_1",
      imagenes: ["https://storage.googleapis.com/bucket/existing.jpg"],
    } as never);
    mockedStorageService.uploadMultipleFilesFromPath.mockResolvedValue([
      "https://storage.googleapis.com/bucket/new-photo.png",
    ]);
    mockedProductService.updateProduct.mockResolvedValue({} as never);

    const req = {
      params: { id: "prod_1" },
      files: [
        {
          originalname: "photo.png",
          mimetype: "image/png",
          path: tempFilePath,
        },
      ],
    } as unknown as Parameters<typeof uploadImages>[0];
    const res = createMockResponse() as unknown as Parameters<typeof uploadImages>[1];

    await uploadImages(req, res);

    expect(mockedStorageService.uploadMultipleFilesFromPath).toHaveBeenCalledWith(
      [
        {
          filePath: tempFilePath,
          originalName: "photo.png",
          mimeType: "image/png",
        },
      ],
      "productos",
    );
    expect(mockedProductService.updateProduct).toHaveBeenCalledWith("prod_1", {
      imagenes: [
        "https://storage.googleapis.com/bucket/existing.jpg",
        "https://storage.googleapis.com/bucket/new-photo.png",
      ],
    });
    expect((res as any).status).toHaveBeenCalledWith(200);
    await expect(fs.access(tempFilePath)).rejects.toThrow();
  });

  it("responde 400 cuando no se enviaron archivos", async () => {
    const req = {
      params: { id: "prod_1" },
      files: [],
    } as unknown as Parameters<typeof uploadImages>[0];
    const res = createMockResponse() as unknown as Parameters<typeof uploadImages>[1];

    await uploadImages(req, res);

    expect(mockedStorageService.uploadMultipleFilesFromPath).not.toHaveBeenCalled();
    expect((res as any).status).toHaveBeenCalledWith(400);
    expect((res as any).json).toHaveBeenCalledWith({
      success: false,
      message: "No se enviaron archivos",
    });
  });

  it("responde 404 cuando el producto no existe y limpia temporales", async () => {
    const tempFilePath = path.join(
      os.tmpdir(),
      `product-upload-${Date.now()}-missing.webp`,
    );
    await fs.writeFile(tempFilePath, Buffer.from("fake-image"));

    mockedProductService.getProductById.mockResolvedValue(null as never);

    const req = {
      params: { id: "missing" },
      files: [
        {
          originalname: "photo.webp",
          mimetype: "image/webp",
          path: tempFilePath,
        },
      ],
    } as unknown as Parameters<typeof uploadImages>[0];
    const res = createMockResponse() as unknown as Parameters<typeof uploadImages>[1];

    await uploadImages(req, res);

    expect(mockedStorageService.uploadMultipleFilesFromPath).not.toHaveBeenCalled();
    expect((res as any).status).toHaveBeenCalledWith(404);
    await expect(fs.access(tempFilePath)).rejects.toThrow();
  });
});
