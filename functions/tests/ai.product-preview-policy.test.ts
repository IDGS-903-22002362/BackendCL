jest.mock("../src/services/category.service", () => ({
  __esModule: true,
  default: {
    getCategoryById: jest.fn(),
  },
}));

jest.mock("../src/services/line.service", () => ({
  __esModule: true,
  default: {
    getLineById: jest.fn(),
  },
}));

import categoryService from "../src/services/category.service";
import lineService from "../src/services/line.service";
import productPreviewPolicyService from "../src/services/ai/jobs/product-preview-policy.service";
import {
  ProductPreviewClassificationSource,
  ProductPreviewMode,
  ProductPreviewType,
} from "../src/models/ai/ai.model";

const mockedCategoryService = categoryService as jest.Mocked<
  typeof categoryService
>;
const mockedLineService = lineService as jest.Mocked<typeof lineService>;

describe("AI product preview policy", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedLineService.getLineById.mockResolvedValue({
      id: "caballero",
      nombre: "Caballero",
      codigo: 1,
    } as never);
  });

  it("clasifica jersey como body_tryon", async () => {
    mockedCategoryService.getCategoryById.mockResolvedValue({
      id: "jersey",
      nombre: "Jersey Oficial",
    } as never);

    const result = await productPreviewPolicyService.resolvePolicy({
      id: "prod_1",
      categoriaId: "jersey",
      lineaId: "caballero",
      descripcion: "Jersey local 2026",
    } as never);

    expect(result).toMatchObject({
      previewMode: ProductPreviewMode.BODY_TRYON,
      productPreviewType: ProductPreviewType.APPAREL,
      classificationSource: ProductPreviewClassificationSource.CATEGORY_ID,
    });
  });

  it("clasifica gorra como accessory_mockup", async () => {
    mockedCategoryService.getCategoryById.mockResolvedValue({
      id: "gorra",
      nombre: "Gorra",
    } as never);
    mockedLineService.getLineById.mockResolvedValue({
      id: "souvenir",
      nombre: "Souvenir",
      codigo: 5,
    } as never);

    const result = await productPreviewPolicyService.resolvePolicy({
      id: "prod_2",
      categoriaId: "gorra",
      lineaId: "souvenir",
      descripcion: "Gorra oficial verde",
    } as never);

    expect(result).toMatchObject({
      previewMode: ProductPreviewMode.ACCESSORY_MOCKUP,
      productPreviewType: ProductPreviewType.ACCESSORY,
      classificationSource: ProductPreviewClassificationSource.CATEGORY_ID,
    });
  });

  it("clasifica balon como prop_mockup", async () => {
    mockedCategoryService.getCategoryById.mockResolvedValue({
      id: "balon",
      nombre: "Balón",
    } as never);
    mockedLineService.getLineById.mockResolvedValue({
      id: "souvenir",
      nombre: "Souvenir",
      codigo: 5,
    } as never);

    const result = await productPreviewPolicyService.resolvePolicy({
      id: "prod_3",
      categoriaId: "balon",
      lineaId: "souvenir",
      descripcion: "Balón oficial del club",
    } as never);

    expect(result).toMatchObject({
      previewMode: ProductPreviewMode.PROP_MOCKUP,
      productPreviewType: ProductPreviewType.PROP,
      classificationSource: ProductPreviewClassificationSource.CATEGORY_ID,
    });
  });

  it("deja categoria desconocida como unsupported", async () => {
    mockedCategoryService.getCategoryById.mockResolvedValue(null);
    mockedLineService.getLineById.mockResolvedValue(null);

    const result = await productPreviewPolicyService.resolvePolicy({
      id: "prod_4",
      categoriaId: "misterioso",
      lineaId: "misteriosa",
      descripcion: "Objeto especial",
    } as never);

    expect(result).toMatchObject({
      previewMode: ProductPreviewMode.UNSUPPORTED,
      productPreviewType: ProductPreviewType.UNKNOWN,
      classificationSource: ProductPreviewClassificationSource.UNCLASSIFIED,
    });
  });
});
